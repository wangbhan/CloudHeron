import base64
import json
import logging
import subprocess
import sys
from typing import Annotated
from fastapi import Header, Response

from pydantic import Field
from psycopg.types.json import Jsonb

from .db import now
from .domain import options
from .schemas import Contract, JobOut
from .security import fail, text, uid
from .service import job_view
from .provider import validate_references


class DocumentUpload(Contract):
    filename: str = Field(min_length=1, max_length=200)
    base64: str = Field(max_length=28 * 1024 * 1024)


class DocumentAnalyze(Contract):
    model_id: str
    params: dict = {}


class DocumentConfirm(Contract):
    job_id: str
    summary: str = Field(min_length=1, max_length=16000)
    asset_ids: list[str] = Field(default_factory=list, max_length=8)


def load_document(service, document_id, edit=False):
    row = service.db.one('SELECT * FROM documents WHERE id=%s', document_id)
    if not row:
        fail(404, '文档不存在')
    service.project(row['project_id'], edit)
    return row


def view(service, row):
    result = {key: value for key, value in row.items() if key != 'file'}
    result['job'] = job_view(service.db.one('SELECT * FROM jobs WHERE id=%s', row['job_id'])) if row['job_id'] else None
    return result


def attach_document(service, chat, cfg, document_id):
    if not document_id:
        return
    row = load_document(service, document_id)
    if row['chat_id'] != chat['id'] or row['status'] != 'confirmed':
        fail(400, '请先确认当前对话的文档解析结果')
    ids = list(dict.fromkeys(cfg['asset_ids'] + row['selected_asset_ids']))
    if len(ids) > 8:
        fail(400, '文档与对话合计最多选择 8 份参考')
    if cfg['agent'] != 'prompt':
        validate_references(cfg['kind'], [service.asset(aid) for aid in ids], service.model(cfg['model_id'])['spec'])
        cfg['asset_ids'] = ids
    cfg['document_id'] = row['id']
    cfg['document_context'] = {'filename': row['filename'], 'summary': row['summary']}


def register(api, Svc):
    @api.get('/chats/{chat_id}/documents', response_model=list[dict], tags=['文档'])
    def documents(chat_id: str, s: Svc):
        s.resource('chats', chat_id)
        return [view(s, row) for row in s.db.all('SELECT * FROM documents WHERE chat_id=%s ORDER BY created_at DESC', chat_id)]

    @api.get('/documents/{document_id}', response_model=dict, tags=['文档'])
    def document(document_id: str, s: Svc):
        return view(s, load_document(s, document_id))

    @api.post('/chats/{chat_id}/documents', response_model=dict, status_code=201, tags=['文档'])
    def upload(chat_id: str, b: DocumentUpload, s: Svc):
        chat = s.resource('chats', chat_id, True)
        try:
            data = base64.b64decode(b.base64, validate=True)
        except ValueError:
            fail(400, '文档 base64 有误')
        if len(data) > 20 * 1024 * 1024:
            fail(413, '文档最多 20 MB')
        try:
            proc = subprocess.run(
                [sys.executable, '-m', 'cloudheron.document_parser', b.filename],
                input=data, capture_output=True, timeout=45,
            )
            parsed = json.loads(proc.stdout)
        except (subprocess.TimeoutExpired, ValueError):
            fail(400, '文档解析超时或失败，请检查文件并拆分后重试')
        if not parsed.get('ok'):
            fail(400, parsed.get('error', '文档解析失败'))
        parsed = parsed['document']
        document_id = uid('doc')
        key = 'documents/' + document_id
        created = []
        try:
            s.context.storage.put(key, data, 'application/pdf' if b.filename.lower().endswith('.pdf') else 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
            created.append(key)
            with s.db.tx():
                images = []
                for image in parsed['images']:
                    asset = s.save_asset(base64.b64decode(image['data']), 'image', record={
                        'project_id': chat['project_id'], 'owner_id': s.user['id'],
                        'name': b.filename + ' · ' + image['label'], 'kind': 'image', 'visibility': 'private',
                        'metadata': {'source': 'document', 'document_id': document_id, 'label': image['label']},
                    })
                    created.append(asset['file'])
                    images.append({'asset_id': asset['id'], 'label': image['label']})
                s.db.insert('documents', {
                    'id': document_id, 'project_id': chat['project_id'], 'chat_id': chat_id,
                    'owner_id': s.user['id'], 'filename': text(b.filename, '文件名'),
                    'file': key, 'content': {'sections': parsed['sections'], 'images': images, 'warnings': parsed['warnings']},
                })
        except Exception:
            for item in created:
                try:
                    s.context.storage.delete(item)
                except Exception:
                    logging.getLogger(__name__).error('Document upload cleanup failed %s', document_id)
            raise
        return view(s, load_document(s, document_id))

    @api.post('/documents/{document_id}/analyze', response_model=JobOut, status_code=202, tags=['文档'])
    def analyze(document_id: str, b: DocumentAnalyze, response: Response, s: Svc, idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None):
        row = load_document(s, document_id, True)
        params = options('text', b.params)
        model = s.model(b.model_id)
        if 'text' not in model['spec']['capabilities']:
            fail(400, '请选择支持图片理解的文本模型')
        def build():
            s.db.one('SELECT id FROM documents WHERE id=%s FOR UPDATE', document_id)
            if s.db.one("SELECT id FROM jobs WHERE source_id=%s AND status IN ('queued','running')", document_id):
                fail(409, '文档正在分析，请等待当前任务')
            job = s.enqueue(row['project_id'], 'document_analysis', document_id, {
                'model_id': model['id'], 'params': params, 'document': row['content'],
            })
            s.db.run("UPDATE documents SET status='analyzing',job_id=%s,summary='',selected_asset_ids='[]' WHERE id=%s", job['id'], document_id)
            return job
        job,replayed=s.submit("document:"+document_id,idempotency_key,b.model_dump(),build)
        if replayed: response.headers["Idempotency-Replayed"]="true"
        return job

    @api.post('/documents/{document_id}/confirm', response_model=dict, tags=['文档'])
    def confirm(document_id: str, b: DocumentConfirm, s: Svc):
        with s.db.tx():
            s.db.one('SELECT id FROM documents WHERE id=%s FOR UPDATE', document_id)
            row = load_document(s, document_id, True)
            if row['status'] not in ('analyzed', 'confirmed') or b.job_id != row['job_id']:
                fail(409, '分析结果已变化，请重新打开后确认')
            allowed = {item['asset_id'] for item in row['content']['images']}
            if len(set(b.asset_ids)) != len(b.asset_ids) or not set(b.asset_ids) <= allowed:
                fail(400, '请从当前文档选择参考图')
            for aid in b.asset_ids:
                s.asset(aid)
            s.db.run("UPDATE documents SET status='confirmed',summary=%s,selected_asset_ids=%s WHERE id=%s",
                     text(b.summary, '文档摘要', 16000), Jsonb(b.asset_ids), document_id)
        return view(s, load_document(s, document_id))
