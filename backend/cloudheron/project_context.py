from datetime import datetime

from pydantic import Field, StrictInt

from .schemas import Contract
from .security import fail


class ContextDocument(Contract):
    description: str = Field(default='', max_length=4000)
    style: str = Field(default='', max_length=1000)
    asset_ids: list[str] = Field(default_factory=list, max_length=8)


class ContextWrite(ContextDocument):
    base_revision: StrictInt = Field(ge=0)


class ContextVersion(ContextDocument):
    revision: int
    created_at: datetime


def load_context(service, project_id, revision):
    if revision is None:
        return None
    row = service.db.one(
        'SELECT document FROM project_context_revisions WHERE project_id=%s AND revision=%s',
        project_id, revision,
    )
    if not row:
        fail(404, '项目设定版本不存在')
    return {'revision': revision, **row['document']}


def with_context(prompt, context):
    if not context:
        return prompt
    blocks = [
        title + '：' + context[key]
        for title, key in [('项目描述', 'description'), ('视觉风格', 'style')]
        if context.get(key)
    ]
    if not blocks:
        return prompt
    return '\n'.join(blocks) + '\n\n当前创作要求：\n' + prompt


def register(api, Svc):
    @api.get('/projects/{project_id}/context', response_model=list[ContextVersion], tags=['项目设定'])
    def list_context(project_id: str, s: Svc):
        s.project(project_id)
        rows = s.db.all(
            'SELECT revision, document, created_at FROM project_context_revisions '
            'WHERE project_id=%s ORDER BY revision DESC',
            project_id,
        )
        return [{**row['document'], 'revision': row['revision'], 'created_at': row['created_at']} for row in rows]

    @api.post('/projects/{project_id}/context', response_model=ContextVersion, status_code=201, tags=['项目设定'])
    def save_context(project_id: str, body: ContextWrite, s: Svc):
        document = body.model_dump(exclude={'base_revision'})
        document['description'] = document['description'].strip()
        document['style'] = document['style'].strip()
        document['asset_ids'] = list(dict.fromkeys(document['asset_ids']))
        with s.db.tx():
            s.db.run('SELECT id FROM projects WHERE id=%s FOR UPDATE', project_id)
            s.project(project_id, True)
            latest = s.db.one(
                'SELECT COALESCE(MAX(revision), 0) AS revision '
                'FROM project_context_revisions WHERE project_id=%s', project_id,
            )['revision']
            if latest != body.base_revision:
                fail(409, '项目设定已更新，请重新打开并检查最新版本')
            for asset_id in document['asset_ids']:
                asset = s.asset(asset_id)
                if asset['project_id'] != project_id:
                    fail(400, '设定只能收藏本项目的资产版本')
            revision = latest + 1
            s.db.insert('project_context_revisions', {
                'project_id': project_id, 'revision': revision, 'document': document,
            })
            row = s.db.one(
                'SELECT created_at FROM project_context_revisions WHERE project_id=%s AND revision=%s',
                project_id, revision,
            )
        return {**document, 'revision': revision, 'created_at': row['created_at']}
