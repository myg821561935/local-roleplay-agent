import { escapeHtmlText } from './utils.js';
import { collapsePromptResourcesForDisplay } from './presetLibrary.js';
import {
  compatibilityActionLabel,
  getPackCompatibilityAudit,
  isPackStartBlocked,
  mergePackCompatibilityOverview
} from './packCompatibility.js';

export const FALLBACK_IMPORT_SOURCES = [
  { id: 'chub', name: 'Chub / CharacterHub', supports: ['characters', 'lorebooks'], searchable: true, downloadable: true },
  { id: 'aicharactercards', name: 'AICharacterCards', supports: ['characters'], searchable: true, downloadable: true },
  { id: 'risurealm', name: 'RisuRealm', supports: ['characters', 'presets', 'lorebooks'], searchable: true, downloadable: true },
  { id: 'charavault', name: 'CharaVault', supports: ['characters', 'lorebooks'], searchable: false, downloadable: false }
];

const RESOURCE_VIEWS = new Set(['library', 'online', 'composer', 'extensions']);

export function normalizeResourceView(view) {
  return RESOURCE_VIEWS.has(view) ? view : 'library';
}

export function resourceKindLabel(kind) {
  return { character: '角色卡', worldbook: '世界书', prompt: 'Prompt 模块', 'prompt-bundle': 'Prompt 预设' }[kind] || '素材';
}

export function filterResourceLibrary(resources = [], { kind = '', query = '' } = {}) {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  return (Array.isArray(resources) ? resources : []).filter((item) => {
    if (kind && item.kind !== kind && !(kind === 'prompt' && item.kind === 'prompt-bundle')) return false;
    if (!normalizedQuery) return true;
    return [item.title, item.summary, item.source?.author, item.source?.site, ...(item.tags || [])]
      .some((value) => String(value || '').toLowerCase().includes(normalizedQuery));
  });
}

export function createResourceWorkbenchController({
  state,
  els,
  apiRequest = async () => ({}),
  setStatus = () => {},
  humanizeApiError = (error) => error?.message || String(error),
  formatTime = String,
  formatTokenCount = String,
  createCharacterPortraitImage = () => null,
  getContentPackTitle = (_packId, fallback = '') => fallback,
  applyContentPack = async () => null,
  renderContentPackOptions = () => {},
  renderPluginRegistry = () => {},
  renderAdapterRegistry = () => {},
  getAssetCenterController = () => null,
  previewImportSourceItem = async () => {},
  onReviewPackCompatibility = async () => null,
  documentObject = globalThis.document,
  globalObject = globalThis,
  confirmAction = (message) => globalThis.confirm?.(message) === true
} = {}) {
  let importSources = FALLBACK_IMPORT_SOURCES;
  let sourceResultItems = [];

  function bindEvents() {
    els.sourceSearch?.addEventListener('click', () => searchImportSources());
    els.sourceQuery?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        searchImportSources();
      }
    });
    els.sourceResults?.addEventListener('click', handleSourceResultsClick);
    els.resourceViewButtons?.forEach((button) => {
      button.addEventListener('click', () => activateResourceView(button.dataset.resourceView));
    });
    els.refreshResourceLibrary?.addEventListener('click', () => loadResourceLibrary({ announce: true }));
    els.resourceKindFilter?.addEventListener('change', renderResourceLibrary);
    els.resourceQuery?.addEventListener('input', renderResourceLibrary);
    els.resourceLibraryList?.addEventListener('click', handleResourceLibraryClick);
    els.resourcePackForm?.addEventListener('submit', createResourcePack);
    els.resourcePackList?.addEventListener('click', handleResourcePackClick);
  }

  async function loadImportSources() {
    try {
      const payload = await apiRequest('/api/import-sources');
      importSources = Array.isArray(payload.sources) && payload.sources.length
        ? payload.sources
        : FALLBACK_IMPORT_SOURCES;
    } catch {
      importSources = FALLBACK_IMPORT_SOURCES;
    } finally {
      renderImportSourceOptions();
    }
  }

  function renderImportSourceOptions() {
    if (!els.sourceSelect) return;
    const selected = els.sourceSelect.value || 'chub';
    els.sourceSelect.innerHTML = '';
    importSources.forEach((source) => {
      const option = documentObject.createElement('option');
      option.value = source.id;
      option.textContent = source.name || source.id;
      els.sourceSelect.append(option);
    });
    els.sourceSelect.value = importSources.some((source) => source.id === selected)
      ? selected
      : (importSources[0]?.id || 'chub');
  }

  async function loadResourceLibrary({ announce = false } = {}) {
    if (announce) setStatus(els.resourceLibraryStatus, '正在刷新资源库...', 'busy');
    if (els.refreshResourceLibrary) els.refreshResourceLibrary.disabled = true;
    try {
      const [resources, packs, compatibilityOverview, adapters, contentPacks, plugins, assets] = await Promise.all([
        apiRequest('/api/resource-library/resources'),
        apiRequest('/api/resource-library/packs'),
        apiRequest('/api/resource-library/packs/compatibility-overview').catch((error) => ({
          spec: 'lra.pack-compatibility-overview/v1',
          packs: [],
          summary: { total: 0, attention: 0 },
          error: humanizeApiError(error)
        })),
        apiRequest('/api/resource-library/adapters'),
        apiRequest('/api/content-packs'),
        apiRequest('/api/plugins'),
        apiRequest('/api/assets')
      ]);
      state.resourceLibrary = resources.resources || [];
      state.resourcePackCompatibilityOverview = compatibilityOverview;
      state.resourcePacks = mergePackCompatibilityOverview(packs.packs, compatibilityOverview);
      state.resourceAdapters = adapters.adapters || [];
      state.contentPacks = mergePackCompatibilityOverview(contentPacks.contentPacks, compatibilityOverview);
      state.plugins = plugins.plugins || [];
      globalObject.__assets = assets.assets || globalObject.__assets;
      renderContentPackOptions();
      renderResourceWorkbench();
      getAssetCenterController()?.render();
      if (announce) setStatus(els.resourceLibraryStatus, `已载入 ${state.resourceLibrary.length} 份素材`, 'ok');
    } catch (error) {
      if (announce) setStatus(els.resourceLibraryStatus, `刷新失败：${humanizeApiError(error)}`, 'error');
    } finally {
      if (els.refreshResourceLibrary) els.refreshResourceLibrary.disabled = false;
    }
  }

  function activateResourceView(view) {
    const safeView = normalizeResourceView(view);
    els.resourceViewButtons?.forEach((button) => {
      const active = button.dataset.resourceView === safeView;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    els.resourceViews?.forEach((pane) => {
      const active = pane.dataset.resourcePane === safeView;
      pane.classList.toggle('active', active);
      pane.hidden = !active;
    });
    const flowStep = safeView === 'online' ? 'discover' : safeView === 'extensions' ? 'library' : safeView;
    setResourceFlowStep(flowStep);
  }

  function setResourceFlowStep(step) {
    els.resourceFlowSteps?.forEach((item) => {
      const active = item.dataset.resourceFlowStep === step;
      item.classList.toggle('active', active);
      if (active) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });
  }

  function renderResourceWorkbench() {
    const resources = Array.isArray(state.resourceLibrary) ? state.resourceLibrary : [];
    const displayResources = collapsePromptResourcesForDisplay(resources);
    const packs = Array.isArray(state.resourcePacks) ? state.resourcePacks : [];
    if (els.resourceCountAll) els.resourceCountAll.textContent = String(displayResources.length);
    if (els.resourceCountCharacter) {
      els.resourceCountCharacter.textContent = String(resources.filter((item) => item.kind === 'character').length);
    }
    if (els.resourceCountWorldbook) {
      els.resourceCountWorldbook.textContent = String(resources.filter((item) => item.kind === 'worldbook').length);
    }
    if (els.resourceCountPack) els.resourceCountPack.textContent = String(packs.length);
    if (els.resourceAdapterSummary) {
      const adapters = Array.isArray(state.resourceAdapters) ? state.resourceAdapters : [];
      const localPlugins = (state.plugins || []).filter((item) => item.origin === 'local' && item.enabled);
      els.resourceAdapterSummary.textContent = adapters.length
        ? `${adapters.length} 个格式适配器已就绪${localPlugins.length ? ` · ${localPlugins.length} 个本地扩展` : ''}`
        : '支持 Character Card V2 与 SillyTavern 世界书';
      els.resourceAdapterSummary.title = adapters.map((item) => item.label).join('、');
    }
    renderResourceLibrary();
    renderResourcePackBuilder();
    renderResourcePackList();
    renderPluginRegistry();
    renderAdapterRegistry();
  }

  function renderResourceLibrary() {
    if (!els.resourceLibraryList) return;
    const resources = filterResourceLibrary(collapsePromptResourcesForDisplay(state.resourceLibrary), {
      kind: els.resourceKindFilter?.value || '',
      query: els.resourceQuery?.value || ''
    });
    els.resourceLibraryList.innerHTML = '';
    if (!resources.length) {
      const empty = documentObject.createElement('div');
      empty.className = 'resource-empty-state';
      empty.innerHTML = '<strong>还没有匹配的素材</strong><span>从角色卡页导入文件，或到“在线采集”获取社区资源。</span>';
      els.resourceLibraryList.append(empty);
      return;
    }
    resources.forEach((resource) => els.resourceLibraryList.append(createResourceLibraryItem(resource)));
  }

  function createResourceLibraryItem(resource) {
    const item = documentObject.createElement('article');
    item.className = 'resource-library-item';
    const heading = documentObject.createElement('div');
    heading.className = 'resource-item-heading';
    const type = documentObject.createElement('span');
    type.className = `resource-kind resource-kind-${resource.kind}`;
    type.textContent = resourceKindLabel(resource.kind);
    const health = documentObject.createElement('span');
    const score = Number(resource.diagnostics?.score || 0);
    health.className = `resource-health ${score >= 85 ? 'is-good' : score >= 65 ? 'is-usable' : 'is-warning'}`;
    health.textContent = `${score}分`;
    heading.append(type, health);

    const title = documentObject.createElement('strong');
    title.className = 'resource-item-title';
    title.textContent = resource.title || '未命名素材';
    const summary = documentObject.createElement('p');
    summary.textContent = resource.summary || '未提供摘要';
    const identity = documentObject.createElement('div');
    identity.className = 'resource-item-identity';
    const portrait = createCharacterPortraitImage(resource.payload, 'resource-item-portrait', resource.title);
    const copy = documentObject.createElement('div');
    copy.append(title, summary);
    if (portrait) identity.append(portrait);
    identity.append(copy);
    const meta = documentObject.createElement('div');
    meta.className = 'resource-item-meta';
    meta.textContent = [
      resource.source?.site || '本地文件',
      resource.source?.author,
      resource.source?.version ? `v${resource.source.version}` : '',
      resource.format,
      formatTime(resource.updatedAt)
    ].filter(Boolean).join(' · ');

    const footer = documentObject.createElement('div');
    footer.className = 'resource-item-footer';
    const tags = documentObject.createElement('div');
    tags.className = 'resource-item-tags';
    (resource.tags || []).slice(0, 4).forEach((tag) => {
      const chip = documentObject.createElement('span');
      chip.textContent = tag;
      tags.append(chip);
    });
    const remove = documentObject.createElement('button');
    remove.type = 'button';
    remove.className = 'icon-text-button danger subtle';
    remove.dataset.resourceDelete = resource.id;
    remove.dataset.resourceIds = JSON.stringify(resource.resourceIds || [resource.id]);
    remove.dataset.resourceTitle = resource.title || '未命名素材';
    remove.textContent = '移除';
    remove.title = '从本地素材库移除';
    footer.append(tags, remove);
    item.append(heading, identity, meta, footer);
    return item;
  }

  async function handleResourceLibraryClick(event) {
    const button = event.target.closest('[data-resource-delete]');
    if (!button) return;
    const resourceIds = parseResourceIds(button.dataset.resourceIds, button.dataset.resourceDelete);
    const title = button.dataset.resourceTitle || '未命名素材';
    if (!resourceIds.length || !confirmAction(`从本地素材库移除“${title}”？已生成的剧本不会受影响。`)) return;
    button.disabled = true;
    try {
      if (resourceIds.length === 1) {
        await apiRequest(`/api/resource-library/resources/${encodeURIComponent(resourceIds[0])}`, { method: 'DELETE', body: {} });
      } else {
        await apiRequest('/api/resource-library/resources', { method: 'DELETE', body: { resourceIds } });
      }
      await loadResourceLibrary();
      setStatus(els.resourceLibraryStatus, `已移除：${title}`, 'ok');
    } catch (error) {
      setStatus(els.resourceLibraryStatus, `移除失败：${humanizeApiError(error)}`, 'error');
      button.disabled = false;
    }
  }

  function renderResourcePackBaseOptions() {
    if (!els.resourcePackBase) return;
    const selected = els.resourcePackBase.value || 'xuanhuan';
    const builtIn = (state.contentPacks || []).filter((pack) => pack.custom !== true);
    if (!builtIn.length) return;
    els.resourcePackBase.innerHTML = '';
    builtIn.forEach((pack) => {
      const option = documentObject.createElement('option');
      option.value = pack.id;
      option.textContent = pack.title || pack.id;
      els.resourcePackBase.append(option);
    });
    els.resourcePackBase.value = builtIn.some((pack) => pack.id === selected)
      ? selected
      : (builtIn[0]?.id || 'xuanhuan');
  }

  function renderResourcePackBuilder() {
    const resources = state.resourceLibrary || [];
    renderResourcePackBaseOptions();
    if (els.resourcePackCharacter) {
      const selected = els.resourcePackCharacter.value || '';
      els.resourcePackCharacter.innerHTML = '<option value="">沿用题材角色</option>';
      resources.filter((item) => item.kind === 'character').forEach((item) => {
        const option = documentObject.createElement('option');
        option.value = item.id;
        option.textContent = `${item.title} · ${item.source?.site || '本地'}`;
        els.resourcePackCharacter.append(option);
      });
      els.resourcePackCharacter.value = resources.some((item) => item.id === selected) ? selected : '';
    }
    renderResourcePicker(els.resourcePackWorldbooks, resources.filter((item) => item.kind === 'worldbook'), 'worldbook');
    renderResourcePicker(
      els.resourcePackPrompts,
      resources.filter((item) => item.kind === 'prompt' || item.kind === 'prompt-bundle'),
      'prompt'
    );
  }

  function renderResourcePicker(container, resources, kind) {
    if (!container) return;
    const selected = new Set(Array.from(container.querySelectorAll('input:checked')).map((input) => input.value));
    container.innerHTML = '';
    if (!resources.length) {
      const empty = documentObject.createElement('span');
      empty.className = 'resource-picker-empty';
      empty.textContent = kind === 'worldbook' ? '素材库中还没有世界书' : '素材库中还没有 Prompt 模块';
      container.append(empty);
      return;
    }
    resources.forEach((resource) => {
      const label = documentObject.createElement('label');
      label.className = 'resource-picker-option';
      const input = documentObject.createElement('input');
      input.type = 'checkbox';
      input.value = resource.id;
      input.checked = selected.has(resource.id);
      const text = documentObject.createElement('span');
      text.innerHTML = `<strong>${escapeHtmlText(resource.title)}</strong><small>${escapeHtmlText(resource.summary || resource.source?.site || '')}</small>`;
      label.append(input, text);
      container.append(label);
    });
  }

  async function createResourcePack(event) {
    event.preventDefault();
    const submit = els.resourcePackForm?.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    setStatus(els.resourcePackStatus, '正在组合剧本...', 'busy');
    try {
      const payload = await apiRequest('/api/resource-library/packs', {
        method: 'POST',
        body: {
          title: els.resourcePackTitle.value.trim(),
          description: els.resourcePackDescription.value.trim(),
          basePackId: els.resourcePackBase.value,
          characterResourceId: els.resourcePackCharacter.value,
          worldBookResourceIds: checkedResourceIds(els.resourcePackWorldbooks),
          promptResourceIds: checkedResourceIds(els.resourcePackPrompts),
          includeBaseContent: els.resourcePackIncludeBase.checked
        }
      });
      await loadResourceLibrary();
      if (els.contentPackSelect) {
        els.contentPackSelect.value = payload.pack.id;
        els.contentPackSelect.dataset.userSelected = 'true';
      }
      els.resourcePackTitle.value = '';
      els.resourcePackDescription.value = '';
      setStatus(els.resourcePackStatus, `已生成“${payload.pack.title}”，可在下方应用到会话`, 'ok');
    } catch (error) {
      setStatus(els.resourcePackStatus, `生成失败：${humanizeApiError(error)}`, 'error');
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  function checkedResourceIds(container) {
    return Array.from(container?.querySelectorAll('input:checked') || []).map((input) => input.value);
  }

  function renderResourcePackList() {
    if (!els.resourcePackList) return;
    els.resourcePackList.innerHTML = '';
    const packs = state.resourcePacks || [];
    if (!packs.length) {
      const empty = documentObject.createElement('div');
      empty.className = 'resource-empty-state compact';
      empty.innerHTML = '<strong>还没有自定义剧本</strong><span>选择题材基线与素材后在上方生成。</span>';
      els.resourcePackList.append(empty);
      return;
    }
    els.resourcePackList.append(createPackCompatibilityOverviewSummary());
    packs.forEach((pack) => {
      const item = documentObject.createElement('article');
      item.className = 'resource-pack-item';
      const body = documentObject.createElement('div');
      const audit = getPackCompatibilityAudit(pack);
      body.innerHTML = `
        <strong>${escapeHtmlText(pack.title || pack.id)}</strong>
        <span>${escapeHtmlText(pack.description || '')}</span>
        <small>v${escapeHtmlText(pack.version || '1.0.0')} · ${escapeHtmlText(pack.compatibility?.verdictLabel || '待检查')} · ${escapeHtmlText(getContentPackTitle(pack.basePackId, pack.basePackId || '自定义基线'))}</small>
        <small>${Number(pack.counts?.worldBook || 0)} 条世界书 · ${Number(pack.counts?.promptModules || 0)} 个 Prompt · ${escapeHtmlText(pack.characterName || '沿用角色')}</small>
        <small class="pack-compatibility-line is-${escapeHtmlText(audit.tone)}"><b>${escapeHtmlText(audit.label)}</b> · ${escapeHtmlText(audit.reason)}</small>
      `;
      const actions = documentObject.createElement('div');
      actions.className = 'resource-pack-actions';
      const apply = documentObject.createElement('button');
      apply.type = 'button';
      apply.className = 'primary-button compact';
      apply.dataset.resourcePackApply = pack.id;
      apply.textContent = '应用';
      apply.disabled = isPackStartBlocked(pack);
      if (apply.disabled) apply.title = audit.canStartNewStory
        ? '请先解决内容包依赖或引擎版本问题'
        : audit.reason;
      const compatibilityAction = compatibilityActionLabel(audit);
      if (compatibilityAction) {
        const review = documentObject.createElement('button');
        review.type = 'button';
        review.className = `ghost-button compact pack-compatibility-action is-${audit.tone}`;
        review.dataset.resourcePackCompatibility = pack.id;
        review.textContent = compatibilityAction;
        actions.append(review);
      }
      const exportButton = documentObject.createElement('button');
      exportButton.type = 'button';
      exportButton.className = 'ghost-button compact';
      exportButton.dataset.resourcePackExport = pack.id;
      exportButton.textContent = '导出';
      const remove = documentObject.createElement('button');
      remove.type = 'button';
      remove.className = 'ghost-button compact';
      remove.dataset.resourcePackDelete = pack.id;
      remove.textContent = '删除';
      actions.append(apply, exportButton, remove);
      item.append(body, actions);
      els.resourcePackList.append(item);
    });
  }

  async function handleResourcePackClick(event) {
    const compatibilityButton = event.target.closest('[data-resource-pack-compatibility]');
    if (compatibilityButton) {
      const pack = (state.resourcePacks || [])
        .find((item) => item.id === compatibilityButton.dataset.resourcePackCompatibility);
      if (!pack) return;
      compatibilityButton.disabled = true;
      try {
        await onReviewPackCompatibility(pack, {
          reportStatus: (message, tone) => setStatus(els.resourcePackStatus, message, tone)
        });
      } finally {
        compatibilityButton.disabled = false;
      }
      return;
    }
    const applyButton = event.target.closest('[data-resource-pack-apply]');
    if (applyButton) {
      const packId = applyButton.dataset.resourcePackApply;
      if (els.contentPackSelect) {
        els.contentPackSelect.value = packId;
        els.contentPackSelect.dataset.userSelected = 'true';
      }
      applyButton.disabled = true;
      const payload = await applyContentPack();
      applyButton.disabled = false;
      if (payload) setStatus(els.resourcePackStatus, `已应用：${payload.appliedPack?.title || packId}`, 'ok');
      return;
    }

    const exportButton = event.target.closest('[data-resource-pack-export]');
    if (exportButton) {
      const packId = exportButton.dataset.resourcePackExport;
      const pack = (state.resourcePacks || []).find((item) => item.id === packId);
      const link = documentObject.createElement('a');
      link.href = `/api/content-packs/${encodeURIComponent(packId)}/export`;
      link.download = `${packId}-${pack?.version || '1.0.0'}.json`;
      documentObject.body.append(link);
      link.click();
      link.remove();
      setStatus(els.resourcePackStatus, `已导出：${pack?.title || packId}`, 'ok');
      return;
    }

    const deleteButton = event.target.closest('[data-resource-pack-delete]');
    if (!deleteButton) return;
    const pack = (state.resourcePacks || []).find((item) => item.id === deleteButton.dataset.resourcePackDelete);
    if (!pack || !confirmAction(`删除自定义剧本“${pack.title}”？当前会话内容不会被清空。`)) return;
    deleteButton.disabled = true;
    try {
      await apiRequest(`/api/resource-library/packs/${encodeURIComponent(pack.id)}`, { method: 'DELETE', body: {} });
      await loadResourceLibrary();
      setStatus(els.resourcePackStatus, `已删除：${pack.title}`, 'ok');
    } catch (error) {
      setStatus(els.resourcePackStatus, `删除失败：${humanizeApiError(error)}`, 'error');
      deleteButton.disabled = false;
    }
  }

  function createPackCompatibilityOverviewSummary() {
    const overview = state.resourcePackCompatibilityOverview || {};
    const summary = overview.summary || {};
    const panel = documentObject.createElement('section');
    panel.className = `pack-compatibility-overview${overview.error ? ' is-error' : ''}`;
    const copy = documentObject.createElement('div');
    const title = documentObject.createElement('strong');
    title.textContent = '剧本兼容总览';
    const detail = documentObject.createElement('span');
    detail.textContent = overview.error
      ? `总览读取失败：${overview.error}。自定义剧本暂不允许新开故事。`
      : `${Number(summary.audited || 0)} 个已审核 · ${Number(summary.safeDerivative || 0)} 个安全派生 · ${Number(summary.attention || 0)} 个需要处理`;
    copy.append(title, detail);
    const contract = documentObject.createElement('small');
    contract.textContent = `酒馆兼容契约 v${Number(overview.contractVersion || 2)} · 检查不修改旧包或存档`;
    panel.append(copy, contract);
    return panel;
  }

  async function searchImportSources() {
    if (!els.sourceSelect || !els.sourceResults) return;
    const sourceId = els.sourceSelect.value || 'chub';
    const source = importSources.find((item) => item.id === sourceId);
    if (source && source.searchable === false) {
      sourceResultItems = [];
      renderSourceResults([], source.warning || `${source.name || source.id} 需要下载 PNG 后用本地导入。`);
      setStatus(els.sourceStatus, '需要手动下载', '');
      return;
    }

    const params = new URLSearchParams({
      source: sourceId,
      kind: els.sourceKind?.value || 'characters',
      q: els.sourceQuery?.value || ''
    });
    setStatus(els.sourceStatus, '正在搜索素材源...', 'busy');
    els.sourceSearch.disabled = true;
    try {
      const payload = await apiRequest(`/api/import-sources/search?${params.toString()}`);
      sourceResultItems = Array.isArray(payload.items) ? payload.items : [];
      renderSourceResults(sourceResultItems, payload.warning || '');
      setStatus(
        els.sourceStatus,
        sourceResultItems.length ? `找到 ${sourceResultItems.length} 个素材` : '未找到可导入素材',
        sourceResultItems.length ? 'ok' : ''
      );
    } catch (error) {
      sourceResultItems = [];
      renderSourceResults([], '');
      setStatus(els.sourceStatus, `搜索失败：${humanizeApiError(error)}`, 'error');
    } finally {
      els.sourceSearch.disabled = false;
    }
  }

  function renderSourceResults(items, warning = '') {
    if (!els.sourceResults) return;
    els.sourceResults.innerHTML = '';
    if (warning) {
      const notice = documentObject.createElement('div');
      notice.className = 'source-notice';
      notice.textContent = warning;
      els.sourceResults.append(notice);
    }
    if (!items.length) {
      const empty = documentObject.createElement('div');
      empty.className = 'compact-empty';
      empty.textContent = '暂无素材。';
      els.sourceResults.append(empty);
      return;
    }
    const fragment = documentObject.createDocumentFragment();
    items.forEach((item, index) => fragment.append(createSourceResultNode(item, index)));
    els.sourceResults.append(fragment);
  }

  function createSourceResultNode(item, index) {
    const card = documentObject.createElement('article');
    card.className = 'source-card';
    const body = documentObject.createElement('div');
    body.className = 'source-card-body';
    const title = documentObject.createElement('div');
    title.className = 'source-card-title';
    title.textContent = item.title || item.id || '未命名素材';
    const meta = documentObject.createElement('div');
    meta.className = 'source-card-meta';
    meta.textContent = formatSourceMeta(item);
    const desc = documentObject.createElement('p');
    desc.className = 'source-card-description';
    desc.textContent = item.description || '';
    const actions = documentObject.createElement('div');
    actions.className = 'source-card-actions';
    if (item.sourceUrl) {
      const link = documentObject.createElement('a');
      link.className = 'ghost-link';
      link.href = item.sourceUrl;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = '打开来源';
      actions.append(link);
    }
    const preview = documentObject.createElement('button');
    preview.type = 'button';
    preview.className = 'primary-button compact';
    preview.dataset.sourceDownloadIndex = String(index);
    preview.textContent = '预览';
    preview.disabled = item.downloadable === false;
    actions.append(preview);
    body.append(title, meta);
    if (desc.textContent) body.append(desc);
    body.append(actions);
    if (item.downloadUrl && item.type === 'character-card') {
      const avatar = documentObject.createElement('div');
      avatar.className = 'source-card-avatar';
      const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(item.downloadUrl)}`;
      avatar.style.backgroundImage = `url("${proxyUrl}")`;
      card.append(avatar);
    }
    card.append(body);
    return card;
  }

  function formatSourceMeta(item) {
    const parts = [
      sourceLabel(item.sourceId),
      item.type === 'lorebook' ? '世界书' : '角色卡',
      Number(item.tokenCount || 0) ? `${formatTokenCount(item.tokenCount)} tokens` : ''
    ];
    if (Array.isArray(item.tags) && item.tags.length) parts.push(item.tags.slice(0, 5).join(' / '));
    return parts.filter(Boolean).join(' · ');
  }

  function sourceLabel(sourceId) {
    return importSources.find((source) => source.id === sourceId)?.name || sourceId || '素材源';
  }

  function handleSourceResultsClick(event) {
    const button = event.target.closest('[data-source-download-index]');
    if (!button) return;
    const index = Number(button.dataset.sourceDownloadIndex);
    const item = sourceResultItems[index];
    if (item) previewImportSourceItem(item, button);
  }

  return {
    activateResourceView,
    bindEvents,
    getImportSources: () => [...importSources],
    loadImportSources,
    loadResourceLibrary,
    renderImportSourceOptions,
    renderResourceLibrary,
    renderResourcePackBuilder,
    renderResourceWorkbench,
    searchImportSources,
    setResourceFlowStep,
    sourceLabel
  };
}

function parseResourceIds(value, fallback = '') {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    // Fall through to the single resource id used by older markup.
  }
  return fallback ? [String(fallback)] : [];
}
