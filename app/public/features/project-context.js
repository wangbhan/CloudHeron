export function createProjectContext({state, api, modal, area, select, escape, toast}) {
  const endpoint = projectId => 'projects/' + encodeURIComponent(projectId) + '/context';

  async function versions(projectId) {
    try {
      return await api(endpoint(projectId));
    } catch (error) {
      if (error.status === 404) return [];
      throw error;
    }
  }

  function picker(id, revision) {
    const options = state.contextVersions || [];
    if (!options.length) return '';
    return select('项目设定版本', id, [
      ['', '不引用项目设定'],
      ...options.map(item => [
        String(item.revision), 'r' + item.revision + (item.style ? ' · ' + item.style.slice(0, 30) : '')
      ])
    ], String(revision || '')) + '<p class="note context-help">使用该版项目描述和视觉风格。参考文件在生成设置中选择。</p>';
  }

  async function open(projectId) {
    const project = state.projects.find(item => item.id === projectId);
    if (!project) return;
    const history = await versions(projectId);
    const current = history[0];
    const assets = state.assets.filter(asset => asset.project_id === projectId);
    const assetNames = new Map(assets.map(asset => [asset.id, asset.name + ' · v' + asset.version]));
    const controls = assets.length ? assets.map(asset =>
      '<label><input type="checkbox" name="context-assets" value="' + escape(asset.id) + '" ' +
      (current?.asset_ids.includes(asset.id) ? 'checked' : '') +
      '> ' + escape(assetNames.get(asset.id)) + '</label>'
    ).join('') : '<p class="note">上传到这个项目的资产会显示在这里。</p>';

    const versionsHtml = history.map(item =>
      '<details class="context-version"><summary>r' + item.revision + ' · ' +
      escape(new Date(item.created_at).toLocaleString('zh-CN')) + '</summary>' +
      '<dl><dt>项目描述</dt><dd>' + escape(item.description || '未填写') +
      '</dd><dt>视觉风格</dt><dd>' + escape(item.style || '未填写') +
      '</dd><dt>参考资产</dt><dd>' +
      (item.asset_ids.map(id => assetNames.has(id)
        ? '<a href="' + escape('/api/assets/' + encodeURIComponent(id) + '/media') + '" download>' + escape(assetNames.get(id)) + '</a>'
        : '资产已不可用').join('、') || '未收藏') + '</dd></dl></details>'
    ).join('');

    const fields = project.can_edit
      ? area('项目描述', 'context-description', current?.description || '', 'maxlength="4000"') +
        area('视觉风格', 'context-style', current?.style || '', 'maxlength="1000"') +
        '<fieldset class="skill-picker context-assets"><legend>参考资产版本（最多 8 个）</legend>' + controls + '</fieldset>'
      : '';

    modal('项目设定 · ' + project.name,
      fields + '<section class="context-history"><h3>版本历史</h3>' +
      (versionsHtml || '<p class="note">这个项目还没有设定版本。</p>') + '</section>',
      project.can_edit ? async (values, form) => {
        const assetIds = [...form.querySelectorAll('[name="context-assets"]:checked')].map(input => input.value);
        if (assetIds.length > 8) throw Error('最多收藏 8 个资产版本');
        const saved = await api(endpoint(projectId), 'POST', {
          base_revision: current?.revision || 0,
          description: values['context-description'],
          style: values['context-style'],
          asset_ids: assetIds
        });
        toast('项目设定已保存为 r' + saved.revision);
      } : null,
      project.can_edit ? '保存新版本' : '关闭'
    );
  }

  return {versions, picker, open};
}
