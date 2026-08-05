const UUID_TAG_ID = /^(?:tag[-_:])?[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const COMPACT_HASH_TAG_ID = /^(?:tag[-_:])?[0-9a-f]{24,64}$/i;

export function collectWorldBookTagMappingIssues(resources = [], selectedIds = []) {
  const selected = new Set((selectedIds || []).map(String));
  return (resources || [])
    .filter((resource) => resource?.kind === 'worldbook' && selected.has(String(resource.id || '')))
    .map((resource) => {
      const tags = new Map();
      const entries = Array.isArray(resource.payload?.entries) ? resource.payload.entries : [];
      entries.forEach((entry, index) => {
        const filter = entry?.characterFilter
          || entry?.character_filter
          || entry?.extensions?.character_filter;
        if (!filter || typeof filter !== 'object') return;
        const unresolved = Array.isArray(filter.unresolvedTagIds)
          ? filter.unresolvedTagIds
          : (filter.tags || []).filter(looksLikeExternalTagId);
        const entryTitle = String(entry.title || entry.name || entry.comment || `世界书条目 ${index + 1}`);
        unresolved.map(String).filter(Boolean).forEach((id) => {
          if (!tags.has(id)) tags.set(id, new Set());
          tags.get(id).add(entryTitle);
        });
      });
      return {
        resourceId: String(resource.id || ''),
        resourceTitle: String(resource.title || '未命名世界书'),
        tags: [...tags.entries()].map(([id, entryTitles]) => ({
          id,
          entryTitles: [...entryTitles]
        }))
      };
    })
    .filter((issue) => issue.resourceId && issue.tags.length);
}

export function extractWorldBookTagRegistryDocument(value = {}) {
  const records = new Map();
  const candidates = [
    value?.tag_registry,
    value?.tagRegistry,
    value?.settings?.tags,
    Array.isArray(value?.tags) ? value.tags : null
  ];
  candidates.forEach((candidate) => collectRegistryRecords(candidate, records));
  return { tags: [...records.entries()].map(([id, name]) => ({ id, name })) };
}

export function createWorldBookTagMappingController({
  apiRequest = async () => ({}),
  loadResourceLibrary = async () => {},
  invalidateInspection = () => {},
  persistDraft = () => {},
  renderBuilder = () => {},
  reportStatus = () => {},
  humanizeError = (error) => error?.message || String(error),
  documentObject = globalThis.document
} = {}) {
  let busy = false;

  function render({ resources = [], selectedIds = [] } = {}) {
    const issues = collectWorldBookTagMappingIssues(resources, selectedIds);
    if (!issues.length || !documentObject) return null;
    const uniqueTags = mergeIssueTags(issues);
    const section = element('section', 'story-tag-mapping');
    section.append(
      createHeading(issues, uniqueTags),
      createSourcePanel(issues),
      createManualPanel(issues, uniqueTags)
    );
    return section;
  }

  function createHeading(issues, uniqueTags) {
    const heading = element('div', 'story-tag-mapping-heading');
    const copy = element('div');
    copy.append(
      element('strong', '', 'Character Filter 标签待补全'),
      element(
        'p',
        '',
        `${issues.length} 本世界书包含 ${uniqueTags.length} 个仅在原酒馆配置中有效的 Tag ID。完成映射后会重新预检。`
      )
    );
    const badge = element('span', 'story-tag-mapping-badge', `${uniqueTags.length} 个未解析`);
    heading.append(copy, badge);
    return heading;
  }

  function createSourcePanel(issues) {
    const panel = element('div', 'story-tag-mapping-source');
    const file = element('input');
    file.type = 'file';
    file.accept = '.json,application/json';
    file.setAttribute('aria-label', '选择 SillyTavern settings.json');
    const button = element('button', '', '读取并自动配对');
    button.type = 'button';
    button.addEventListener('click', async () => {
      const selectedFile = file.files?.[0];
      if (!selectedFile) {
        reportStatus('请先选择 SillyTavern settings.json。', 'error');
        return;
      }
      if (Number(selectedFile.size || 0) > 5 * 1024 * 1024) {
        reportStatus('Sidecar 文件超过 5 MB，已拒绝读取。', 'error');
        return;
      }
      try {
        const parsed = JSON.parse(await selectedFile.text());
        const registryDocument = extractWorldBookTagRegistryDocument(parsed);
        if (!registryDocument.tags.length) throw new Error('未找到 tags / tag_registry');
        await applyMappings(issues, { registryDocument }, button);
      } catch (error) {
        reportStatus(`Sidecar 解析失败：${humanizeError(error)}`, 'error');
      }
    });
    const note = element(
      'small',
      '',
      '浏览器只提取 Tag ID 与名称；Provider、密钥和其他设置不会发送到本机服务。'
    );
    panel.append(file, button, note);
    return panel;
  }

  function createManualPanel(issues, uniqueTags) {
    const details = element('details', 'story-tag-mapping-manual');
    details.append(element('summary', '', '没有原 settings.json？人工填写标签名称'));
    const fields = element('div', 'story-tag-mapping-fields');
    uniqueTags.forEach((tag) => {
      const label = element('label');
      const meta = element('span');
      meta.append(
        element('code', '', tag.id),
        element('small', '', tag.entryTitles.join('、'))
      );
      const input = element('input');
      input.type = 'text';
      input.maxLength = 80;
      input.placeholder = '例如：武侠、女仆、主角组';
      input.dataset.tagId = tag.id;
      label.append(meta, input);
      fields.append(label);
    });
    const button = element('button', '', '保存人工映射');
    button.type = 'button';
    button.addEventListener('click', async () => {
      const mappings = [...fields.querySelectorAll('[data-tag-id]')]
        .map((input) => ({ id: input.dataset.tagId, name: input.value.trim() }))
        .filter((item) => item.id && item.name);
      if (!mappings.length) {
        reportStatus('请至少填写一个标签名称。', 'error');
        return;
      }
      await applyMappings(issues, { mappings }, button);
    });
    details.append(fields, button);
    return details;
  }

  async function applyMappings(issues, payload, button) {
    if (busy) return;
    busy = true;
    button.disabled = true;
    reportStatus('正在写入世界书标签映射并重新检查...', 'busy');
    try {
      const results = [];
      for (const issue of issues) {
        const ids = new Set(issue.tags.map((tag) => tag.id));
        const mappings = (payload.mappings || []).filter((item) => ids.has(item.id));
        if (!payload.registryDocument && !mappings.length) continue;
        results.push(await apiRequest(
          `/api/resource-library/resources/${encodeURIComponent(issue.resourceId)}/tag-registry`,
          { method: 'POST', body: { ...payload, mappings } }
        ));
      }
      const appliedCount = results.reduce(
        (sum, result) => sum + Number(result.report?.appliedMappings?.length || 0),
        0
      );
      const remainingCount = results.reduce(
        (sum, result) => sum + Number(result.report?.unresolvedAfter?.length || 0),
        0
      );
      if (!appliedCount) {
        reportStatus('所选 Sidecar/人工映射没有命中当前世界书的 Tag ID。', 'error');
        return;
      }
      await loadResourceLibrary();
      invalidateInspection();
      persistDraft();
      renderBuilder();
      reportStatus(
        `已写入 ${appliedCount} 个标签映射${remainingCount ? `，仍有 ${remainingCount} 个待补全` : '，兼容预检已刷新'}。`,
        remainingCount ? 'busy' : 'ok'
      );
    } catch (error) {
      reportStatus(`标签映射失败：${humanizeError(error)}`, 'error');
    } finally {
      busy = false;
      button.disabled = false;
    }
  }

  function element(tagName, className = '', text = '') {
    const node = documentObject.createElement(tagName);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function renderInto(container, options) {
    const node = render(options);
    if (node) container?.append(node);
  }
  return { render, renderInto };
}

function mergeIssueTags(issues) {
  const tags = new Map();
  issues.flatMap((issue) => issue.tags).forEach((tag) => {
    if (!tags.has(tag.id)) tags.set(tag.id, new Set());
    tag.entryTitles.forEach((title) => tags.get(tag.id).add(title));
  });
  return [...tags.entries()].map(([id, entryTitles]) => ({ id, entryTitles: [...entryTitles] }));
}

function collectRegistryRecords(value, target) {
  if (Array.isArray(value)) {
    value.forEach((item) => {
      const id = String(item?.id ?? item?.tag_id ?? item?.tagId ?? '').trim();
      const name = String(item?.name ?? item?.label ?? item?.tag_name ?? item?.tagName ?? '').trim();
      if (id && name) target.set(id, name);
    });
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([id, item]) => {
      const name = typeof item === 'object'
        ? String(item?.name ?? item?.label ?? item?.tag_name ?? item?.tagName ?? '').trim()
        : String(item ?? '').trim();
      if (id && name) target.set(String(id).trim(), name);
    });
  }
}

function looksLikeExternalTagId(value) {
  const text = String(value || '').trim();
  return UUID_TAG_ID.test(text) || COMPACT_HASH_TAG_ID.test(text);
}
