import { openWorldbookEntryEditor } from './inspector.js';

const KIND_LABELS = {
  character: '角色卡',
  worldbook: '世界书',
  prompt: '预设 / Prompt',
  pack: '内容包'
};

const VIEW_STORAGE_KEY = 'localRoleplayAssetCenterView';

export function createAssetCenterController({
  root,
  getResources = () => [],
  getPacks = () => [],
  onRefresh,
  onImport,
  onUseAsset,
  onOpenComposer,
  onReevaluateAsset,
  onSaveMetadata,
  onSaveContent,
  onDeleteAsset,
  onBatchMetadata,
  onExportAssets,
  onBatchDelete
} = {}) {
  if (!root) return createNoopController();

  const ui = {
    close: root.querySelector('#close-asset-center'),
    refresh: root.querySelector('#asset-center-refresh'),
    importMenu: root.querySelector('#asset-center-import'),
    importButtons: Array.from(root.querySelectorAll('[data-asset-import-kind]')),
    compose: root.querySelector('#asset-center-compose'),
    query: root.querySelector('#asset-center-query'),
    sort: root.querySelector('#asset-center-sort'),
    source: root.querySelector('#asset-center-source'),
    organize: root.querySelector('#asset-center-organize'),
    categories: root.querySelector('#asset-center-categories'),
    grid: root.querySelector('#asset-center-grid'),
    detail: root.querySelector('#asset-center-detail'),
    resultCount: root.querySelector('#asset-center-result-count'),
    status: root.querySelector('#asset-center-status'),
    batchBar: root.querySelector('#asset-center-batch-bar'),
    batchCount: root.querySelector('#asset-batch-count'),
    batchTags: root.querySelector('#asset-batch-tags'),
    batchCollections: root.querySelector('#asset-batch-collections'),
    batchApply: root.querySelector('#asset-batch-apply'),
    batchExport: root.querySelector('#asset-batch-export'),
    batchDelete: root.querySelector('#asset-batch-delete'),
    batchClear: root.querySelector('#asset-batch-clear'),
    viewButtons: Array.from(root.querySelectorAll('[data-asset-view]')),
    metricAll: root.querySelector('#asset-metric-all'),
    metricCharacters: root.querySelector('#asset-metric-characters'),
    metricWorldbooks: root.querySelector('#asset-metric-worldbooks'),
    metricPrompts: root.querySelector('#asset-metric-prompts')
  };

  const localState = {
    kind: 'all',
    query: '',
    source: '',
    sort: 'updated',
    view: localStorage.getItem(VIEW_STORAGE_KEY) === 'list' ? 'list' : 'grid',
    selectedKey: '',
    organizeMode: false,
    selectedKeys: new Set()
  };

  function bindEvents() {
    ui.close?.addEventListener('click', close);
    ui.refresh?.addEventListener('click', refresh);
    ui.importButtons.forEach((button) => {
      button.addEventListener('click', () => {
        onImport?.(button.dataset.assetImportKind || '');
        ui.importMenu?.removeAttribute('open');
      });
    });
    ui.compose?.addEventListener('click', () => {
      close();
      onOpenComposer?.();
    });
    ui.query?.addEventListener('input', () => {
      localState.query = ui.query.value;
      render();
    });
    ui.sort?.addEventListener('change', () => {
      localState.sort = ui.sort.value;
      render();
    });
    ui.source?.addEventListener('change', () => {
      localState.source = ui.source.value;
      render();
    });
    ui.organize?.addEventListener('click', toggleOrganizeMode);
    ui.batchApply?.addEventListener('click', applyBatchMetadata);
    ui.batchExport?.addEventListener('click', exportSelectedAssets);
    ui.batchDelete?.addEventListener('click', deleteSelectedAssets);
    ui.batchClear?.addEventListener('click', clearBatchSelection);
    ui.categories?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-asset-kind]');
      if (!button) return;
      localState.kind = button.dataset.assetKind || 'all';
      render();
    });
    ui.grid?.addEventListener('click', (event) => {
      const card = event.target.closest('[data-asset-key]');
      if (!card) return;
      if (localState.organizeMode) {
        const item = getCatalog().find((entry) => entry.key === card.dataset.assetKey);
        if (!item || item.kind === 'pack') {
          setStatus('内容包请在剧本书架中单独管理；这里批量整理角色卡、世界书与预设。');
          return;
        }
        toggleBatchSelection(item.key);
        return;
      }
      localState.selectedKey = card.dataset.assetKey || '';
      render();
    });
    ui.detail?.addEventListener('click', handleDetailClick);
    ui.viewButtons.forEach((button) => {
      button.addEventListener('click', () => setView(button.dataset.assetView));
    });
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close();
    });
  }

  async function open() {
    root.classList.remove('is-hidden');
    root.setAttribute('aria-hidden', 'false');
    document.body.classList.add('asset-center-open');
    render();
    await refresh({ announce: false });
    window.setTimeout(() => ui.query?.focus(), 0);
  }

  function close() {
    root.classList.add('is-hidden');
    root.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('asset-center-open');
  }

  async function refresh({ announce = true } = {}) {
    if (ui.refresh) ui.refresh.disabled = true;
    setStatus(announce ? '正在刷新素材索引...' : '正在同步素材...');
    try {
      await onRefresh?.();
      render();
      setStatus(`已同步 ${getCatalog().length} 份叙事资产`, 'ok');
    } catch (error) {
      setStatus(`刷新失败：${error.message}`, 'error');
    } finally {
      if (ui.refresh) ui.refresh.disabled = false;
    }
  }

  function render() {
    const catalog = getCatalog();
    const availableResourceKeys = new Set(catalog.filter((item) => item.kind !== 'pack').map((item) => item.key));
    localState.selectedKeys = new Set([...localState.selectedKeys].filter((key) => availableResourceKeys.has(key)));
    renderMetrics(catalog);
    renderSources(catalog);
    renderCategories(catalog);
    renderViewState();

    const filtered = filterAssetCatalog(catalog, localState);
    if (!filtered.some((item) => item.key === localState.selectedKey)) {
      localState.selectedKey = filtered[0]?.key || '';
    }
    renderGrid(filtered);
    renderDetail(filtered.find((item) => item.key === localState.selectedKey));
    renderBatchState();
    if (ui.resultCount) ui.resultCount.textContent = `${filtered.length} 项`;
  }

  function getCatalog() {
    return buildAssetCatalog(getResources(), getPacks());
  }

  function renderMetrics(catalog) {
    const count = (kind) => catalog.filter((item) => item.kind === kind).length;
    if (ui.metricAll) ui.metricAll.textContent = catalog.length;
    if (ui.metricCharacters) ui.metricCharacters.textContent = count('character');
    if (ui.metricWorldbooks) ui.metricWorldbooks.textContent = count('worldbook');
    if (ui.metricPrompts) ui.metricPrompts.textContent = count('prompt');
  }

  function renderSources(catalog) {
    if (!ui.source) return;
    const current = localState.source;
    const sources = Array.from(new Set(catalog.map((item) => item.sourceLabel).filter(Boolean))).sort(localeSort);
    ui.source.innerHTML = '';
    ui.source.append(createOption('', '全部来源'));
    sources.forEach((source) => ui.source.append(createOption(source, source)));
    localState.source = sources.includes(current) ? current : '';
    ui.source.value = localState.source;
  }

  function renderCategories(catalog) {
    if (!ui.categories) return;
    ui.categories.querySelectorAll('[data-asset-kind]').forEach((button) => {
      const kind = button.dataset.assetKind || 'all';
      const count = kind === 'all' ? catalog.length : catalog.filter((item) => item.kind === kind).length;
      button.classList.toggle('active', kind === localState.kind);
      button.setAttribute('aria-pressed', String(kind === localState.kind));
      const badge = button.querySelector('[data-asset-kind-count]');
      if (badge) badge.textContent = count;
    });
  }

  function renderViewState() {
    ui.viewButtons.forEach((button) => {
      const active = button.dataset.assetView === localState.view;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    ui.grid?.classList.toggle('is-list-view', localState.view === 'list');
  }

  function renderGrid(items) {
    if (!ui.grid) return;
    ui.grid.innerHTML = '';
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'asset-center-empty';
      empty.innerHTML = '<strong>没有匹配的素材</strong><span>调整筛选条件，或导入新的角色卡、世界书与预设。</span>';
      ui.grid.append(empty);
      return;
    }
    items.forEach((item) => ui.grid.append(createAssetCard(item, item.key === localState.selectedKey, {
      organizeMode: localState.organizeMode,
      batchSelected: localState.selectedKeys.has(item.key)
    })));
  }

  function renderDetail(item) {
    if (!ui.detail) return;
    ui.detail.innerHTML = '';
    if (!item) {
      ui.detail.innerHTML = '<div class="asset-detail-empty"><strong>选择一项素材</strong><span>这里会显示评定、来源、Token 与内容结构。</span></div>';
      return;
    }

    const header = document.createElement('header');
    header.className = 'asset-detail-header';
    const kind = document.createElement('span');
    kind.className = `asset-kind-badge asset-kind-${item.kind}`;
    kind.textContent = KIND_LABELS[item.kind] || '素材';
    const title = document.createElement('h3');
    title.textContent = item.title;
    const summary = document.createElement('p');
    summary.textContent = item.summary || '未提供摘要';
    header.append(kind, title, summary);

    const visual = createDetailVisual(item);
    const metrics = createMetricsPanel(item);
    const source = createSourcePanel(item);
    const characterProfile = item.kind === 'character' ? createCharacterProfilePanel(item) : null;
    const contentManager = item.kind === 'worldbook'
      ? createWorldbookManagementPanel(item)
      : item.kind === 'prompt'
        ? createPromptManagementPanel(item)
        : null;
    const versions = item.versionCount > 1 ? createVersionPanel(item, getCatalog()) : null;
    const evaluation = createEvaluationPanel(item);
    const preview = createPreviewPanel(item);
    const editor = item.kind === 'pack' ? null : createMetadataEditor(item);
    const actions = createDetailActions(item);
    [header, visual, metrics, characterProfile, contentManager, source, versions, evaluation, preview, editor, actions]
      .filter(Boolean)
      .forEach((node) => ui.detail.append(node));
  }

  async function handleDetailClick(event) {
    const versionKey = event.target.closest('[data-asset-version-key]')?.dataset.assetVersionKey;
    if (versionKey) {
      localState.selectedKey = versionKey;
      render();
      return;
    }
    const catalog = getCatalog();
    const item = catalog.find((entry) => entry.key === localState.selectedKey);
    if (!item) return;
    const action = event.target.closest('[data-asset-action]')?.dataset.assetAction;
    if (!action) return;

    if (action === 'use') {
      close();
      onUseAsset?.(item);
      return;
    }
    if (action === 'compose') {
      close();
      onOpenComposer?.(item);
      return;
    }
    if (action === 'favorite' && item.kind !== 'pack') {
      await saveMetadata(item, { favorite: !item.favorite });
      return;
    }
    if (action === 'reevaluate' && item.kind !== 'pack') {
      try {
        setStatus(`正在重新评估：${item.title}`);
        await onReevaluateAsset?.(item);
        await refresh({ announce: false });
        setStatus('已补全可提炼字段并更新兼容评定', 'ok');
      } catch (error) {
        setStatus(`重新评估失败：${error.message}`, 'error');
      }
      return;
    }
    if (action === 'worldbook-add' && item.kind === 'worldbook') {
      openWorldbookEntryEditor(createWorldbookEntryTemplate(), (updated) => {
        if (!updated) return;
        void saveContent(item, {
          entries: [...(item.payload?.entries || []), updated]
        }, '已新增世界书条目');
      });
      return;
    }
    if (action === 'worldbook-edit' && item.kind === 'worldbook') {
      const index = Number(event.target.closest('[data-asset-index]')?.dataset.assetIndex);
      const entries = [...(item.payload?.entries || [])];
      if (!Number.isInteger(index) || !entries[index]) return;
      openWorldbookEntryEditor(entries[index], (updated) => {
        if (!updated) return;
        entries[index] = updated;
        void saveContent(item, { entries }, '世界书条目已保存');
      });
      return;
    }
    if (action === 'worldbook-delete' && item.kind === 'worldbook') {
      const index = Number(event.target.closest('[data-asset-index]')?.dataset.assetIndex);
      const entries = [...(item.payload?.entries || [])];
      if (!Number.isInteger(index) || !entries[index]) return;
      if (!window.confirm(`删除世界书条目“${entries[index].title || '未命名条目'}”？`)) return;
      entries.splice(index, 1);
      await saveContent(item, { entries }, '世界书条目已删除');
      return;
    }
    if (action === 'prompt-edit' && item.kind === 'prompt') {
      openPromptResourceEditor(item, (updated) => {
        if (!updated) return;
        void saveContent(item, updated, '预设模块已保存', updated.title);
      });
      return;
    }
    if (action === 'save' && item.kind !== 'pack') {
      const title = ui.detail.querySelector('[data-asset-field="title"]')?.value || item.title;
      const summary = ui.detail.querySelector('[data-asset-field="summary"]')?.value || '';
      const tags = splitLabels(ui.detail.querySelector('[data-asset-field="tags"]')?.value || '');
      const collections = splitLabels(ui.detail.querySelector('[data-asset-field="collections"]')?.value || '');
      await saveMetadata(item, { title, summary, tags, collections, favorite: item.favorite });
      return;
    }
    if (action === 'delete') {
      if (!window.confirm(`从素材库移除“${item.title}”？已经生成的故事不会受影响。`)) return;
      try {
        await onDeleteAsset?.(item);
        localState.selectedKey = '';
        await refresh({ announce: false });
        setStatus(`已移除：${item.title}`, 'ok');
      } catch (error) {
        setStatus(`移除失败：${error.message}`, 'error');
      }
    }
  }

  function toggleOrganizeMode() {
    localState.organizeMode = !localState.organizeMode;
    if (!localState.organizeMode) localState.selectedKeys.clear();
    render();
    setStatus(localState.organizeMode
      ? '整理模式已开启：选择角色卡、世界书或预设后，可批量归档与导出。'
      : '已退出整理模式。');
  }

  function toggleBatchSelection(key) {
    if (localState.selectedKeys.has(key)) localState.selectedKeys.delete(key);
    else localState.selectedKeys.add(key);
    render();
  }

  function clearBatchSelection() {
    localState.selectedKeys.clear();
    if (ui.batchTags) ui.batchTags.value = '';
    if (ui.batchCollections) ui.batchCollections.value = '';
    render();
  }

  function getSelectedResources() {
    return getCatalog().filter((item) => item.kind !== 'pack' && localState.selectedKeys.has(item.key));
  }

  function renderBatchState() {
    const selected = getSelectedResources();
    root.classList.toggle('is-organizing', localState.organizeMode);
    ui.organize?.classList.toggle('active', localState.organizeMode);
    ui.organize?.setAttribute('aria-pressed', String(localState.organizeMode));
    ui.batchBar?.classList.toggle('is-hidden', !localState.organizeMode);
    if (ui.batchCount) ui.batchCount.textContent = selected.length;
    [ui.batchApply, ui.batchExport, ui.batchDelete, ui.batchClear].forEach((button) => {
      if (button) button.disabled = selected.length === 0;
    });
  }

  async function applyBatchMetadata() {
    const selected = getSelectedResources();
    if (!selected.length) return;
    const tags = splitLabels(ui.batchTags?.value || '');
    const collections = splitLabels(ui.batchCollections?.value || '');
    if (!tags.length && !collections.length) {
      setStatus('请至少填写一个标签或集合。', 'error');
      return;
    }
    try {
      setBatchBusy(true);
      setStatus(`正在整理 ${selected.length} 份素材...`);
      await onBatchMetadata?.(selected, {
        ...(tags.length ? { tags } : {}),
        ...(collections.length ? { collections } : {}),
        mode: 'merge'
      });
      await refresh({ announce: false });
      setStatus(`已整理 ${selected.length} 份素材`, 'ok');
    } catch (error) {
      setStatus(`批量整理失败：${error.message}`, 'error');
    } finally {
      setBatchBusy(false);
    }
  }

  async function exportSelectedAssets() {
    const selected = getSelectedResources();
    if (!selected.length) return;
    try {
      setBatchBusy(true);
      setStatus(`正在打包 ${selected.length} 份素材...`);
      await onExportAssets?.(selected);
      setStatus(`已导出 ${selected.length} 份素材`, 'ok');
    } catch (error) {
      setStatus(`导出失败：${error.message}`, 'error');
    } finally {
      setBatchBusy(false);
    }
  }

  async function deleteSelectedAssets() {
    const selected = getSelectedResources();
    if (!selected.length) return;
    if (!window.confirm(`从素材库移除选中的 ${selected.length} 份素材？已经生成的故事不会受影响。`)) return;
    try {
      setBatchBusy(true);
      await onBatchDelete?.(selected);
      localState.selectedKeys.clear();
      await refresh({ announce: false });
      setStatus(`已移除 ${selected.length} 份素材`, 'ok');
    } catch (error) {
      setStatus(`批量移除失败：${error.message}`, 'error');
    } finally {
      setBatchBusy(false);
    }
  }

  function setBatchBusy(busy) {
    if (!busy) {
      renderBatchState();
      return;
    }
    [ui.batchApply, ui.batchExport, ui.batchDelete, ui.batchClear].forEach((button) => {
      if (button) button.disabled = true;
    });
  }

  async function saveMetadata(item, updates) {
    try {
      setStatus(`正在保存：${item.title}`);
      await onSaveMetadata?.(item, updates);
      await refresh({ announce: false });
      setStatus('素材资料已保存', 'ok');
    } catch (error) {
      setStatus(`保存失败：${error.message}`, 'error');
    }
  }

  async function saveContent(item, payload, message, title = item.title) {
    try {
      setStatus(`正在保存：${item.title}`);
      await onSaveContent?.(item, { payload, title });
      await refresh({ announce: false });
      setStatus(message || '素材内容已保存', 'ok');
    } catch (error) {
      setStatus(`保存失败：${error.message}`, 'error');
    }
  }

  function setView(view) {
    localState.view = view === 'list' ? 'list' : 'grid';
    localStorage.setItem(VIEW_STORAGE_KEY, localState.view);
    renderViewState();
  }

  function setStatus(message, tone = '') {
    if (!ui.status) return;
    ui.status.textContent = message || '';
    ui.status.dataset.tone = tone;
  }

  return { bindEvents, open, close, render, refresh };
}

export function buildAssetCatalog(resources = [], packs = []) {
  const normalizedResources = (Array.isArray(resources) ? resources : []).map((resource) => normalizeCatalogResource(resource));
  const normalizedPacks = (Array.isArray(packs) ? packs : []).map((pack) => normalizeCatalogPack(pack));
  const catalog = [...normalizedResources, ...normalizedPacks];
  const versionFamilies = new Map();
  catalog.filter((item) => item.kind !== 'pack').forEach((item) => {
    const familyKey = `${item.kind}:${normalizeAssetTitle(item.title)}`;
    item.versionFamilyKey = familyKey;
    if (!versionFamilies.has(familyKey)) versionFamilies.set(familyKey, []);
    versionFamilies.get(familyKey).push(item);
  });
  const importBatches = new Map();
  normalizedResources.forEach((item) => {
    const batchId = String(item.source?.importBatchId || '');
    if (!batchId) return;
    if (!importBatches.has(batchId)) importBatches.set(batchId, []);
    importBatches.get(batchId).push(item);
  });
  catalog.forEach((item) => {
    item.versionCount = versionFamilies.get(item.versionFamilyKey)?.length || 1;
    const batch = importBatches.get(String(item.source?.importBatchId || '')) || [];
    item.companionWorldbookCount = item.kind === 'character'
      ? batch.filter((entry) => entry.kind === 'worldbook').length
      : 0;
  });
  return catalog;
}

export function filterAssetCatalog(catalog = [], filters = {}) {
  const kind = String(filters.kind || 'all');
  const needle = String(filters.query || '').trim().toLowerCase();
  const source = String(filters.source || '');
  const filtered = catalog.filter((item) => {
    if (kind !== 'all' && item.kind !== kind) return false;
    if (source && item.sourceLabel !== source) return false;
    if (!needle) return true;
    return [item.title, item.summary, item.sourceLabel, item.author, ...(item.tags || []), ...(item.collections || [])]
      .some((value) => String(value || '').toLowerCase().includes(needle));
  });

  return filtered.sort((left, right) => {
    if (left.favorite !== right.favorite) return left.favorite ? -1 : 1;
    if (filters.sort === 'title') return localeSort(left.title, right.title);
    if (filters.sort === 'score') return right.score - left.score || localeSort(left.title, right.title);
    if (filters.sort === 'tokens') return right.estimatedTokens - left.estimatedTokens || localeSort(left.title, right.title);
    if (filters.sort === 'versions') return right.versionCount - left.versionCount || localeSort(left.title, right.title);
    return String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''));
  });
}

function normalizeCatalogResource(resource = {}) {
  const diagnostics = resource.diagnostics || {};
  return {
    key: `resource:${resource.id}`,
    id: resource.id,
    kind: resource.kind || 'prompt',
    title: resource.title || '未命名素材',
    summary: resource.summary || '',
    tags: Array.isArray(resource.tags) ? resource.tags : [],
    collections: Array.isArray(resource.collections) ? resource.collections : [],
    favorite: resource.favorite === true,
    format: resource.format || '',
    score: Number(diagnostics.score || 0),
    estimatedTokens: Number(diagnostics.estimatedTokens || 0),
    diagnostics,
    payload: resource.payload || {},
    source: resource.source || {},
    sourceLabel: resource.source?.community || resource.source?.site || '本地素材',
    author: resource.source?.author || '',
    updatedAt: resource.updatedAt || resource.createdAt || '',
    raw: resource
  };
}

function normalizeCatalogPack(pack = {}) {
  const worldBookCount = Number(pack.worldBookCount ?? pack.stats?.worldBookCount ?? pack.resourceManifest?.composition?.totalEntries ?? 0);
  const characterCount = Number(pack.characterCount ?? pack.stats?.characterCount ?? (pack.characterCard ? 1 : 0));
  return {
    key: `pack:${pack.id}`,
    id: pack.id,
    kind: 'pack',
    title: pack.title || pack.manifest?.title || '未命名内容包',
    summary: pack.description || pack.manifest?.description || '',
    tags: Array.isArray(pack.tags) ? pack.tags : [],
    collections: [],
    favorite: false,
    format: 'content-pack',
    score: Number(pack.compatibility?.score || (pack.compatibility?.compatible === false ? 45 : 90)),
    estimatedTokens: Number(pack.estimatedTokens || 0),
    diagnostics: {
      score: Number(pack.compatibility?.score || (pack.compatibility?.compatible === false ? 45 : 90)),
      grade: pack.compatibility?.compatible === false ? '需修复' : '可用',
      warnings: pack.compatibility?.warnings || [],
      stats: { entryCount: worldBookCount, characterCount }
    },
    payload: pack,
    source: { site: pack.custom ? '本地剧本' : '系统内容包', version: pack.manifest?.version || pack.version || '' },
    sourceLabel: pack.custom ? '本地剧本' : '系统内容包',
    author: pack.manifest?.author || '',
    updatedAt: pack.updatedAt || pack.createdAt || '',
    raw: pack
  };
}

function createAssetCard(item, selected, { organizeMode = false, batchSelected = false } = {}) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = `asset-center-card asset-kind-${item.kind}${selected && !organizeMode ? ' is-selected' : ''}${batchSelected ? ' is-batch-selected' : ''}${organizeMode && item.kind === 'pack' ? ' is-batch-disabled' : ''}`;
  card.dataset.assetKey = item.key;
  card.setAttribute('aria-pressed', String(organizeMode ? batchSelected : selected));
  card.setAttribute('aria-label', organizeMode
    ? `${batchSelected ? '取消选择' : '选择'} ${item.title}`
    : `查看 ${item.title}`);

  const cover = document.createElement('div');
  cover.className = 'asset-card-cover';
  const portrait = getPortraitUrl(item);
  if (portrait) {
    const image = document.createElement('img');
    image.src = portrait;
    image.alt = '';
    image.loading = 'lazy';
    cover.append(image);
  } else {
    const monogram = document.createElement('span');
    monogram.textContent = item.kind === 'worldbook' ? '书' : item.kind === 'prompt' ? '令' : item.kind === 'pack' ? '卷' : String(item.title || '角').slice(0, 1);
    cover.append(monogram);
  }
  const coverBadge = document.createElement('span');
  coverBadge.className = 'asset-card-kind';
  coverBadge.textContent = KIND_LABELS[item.kind] || '素材';
  cover.append(coverBadge);
  if (item.favorite) {
    const favorite = document.createElement('span');
    favorite.className = 'asset-card-favorite';
    favorite.textContent = '★';
    favorite.title = '已收藏';
    cover.append(favorite);
  }
  if (organizeMode && item.kind !== 'pack') {
    const check = document.createElement('span');
    check.className = 'asset-card-check';
    check.textContent = batchSelected ? '✓' : '';
    check.setAttribute('aria-hidden', 'true');
    cover.append(check);
  }

  const body = document.createElement('div');
  body.className = 'asset-card-body';
  const heading = document.createElement('div');
  heading.className = 'asset-card-heading';
  const title = document.createElement('strong');
  title.textContent = item.title;
  const score = document.createElement('span');
  score.className = scoreClass(item.score);
  score.textContent = `${item.score}分`;
  heading.append(title, score);
  const summary = document.createElement('p');
  summary.textContent = item.summary || '未提供摘要';
  const metrics = document.createElement('div');
  metrics.className = 'asset-card-metrics';
  getMetricLabels(item).forEach((label) => {
    const metric = document.createElement('span');
    metric.textContent = label;
    metrics.append(metric);
  });
  const meta = document.createElement('small');
  meta.textContent = [item.sourceLabel, item.author, item.format].filter(Boolean).join(' · ');
  if (item.versionCount > 1) {
    const versionBadge = document.createElement('span');
    versionBadge.className = 'asset-card-version';
    versionBadge.textContent = `${item.versionCount} 个同名版本`;
    metrics.append(versionBadge);
  }
  body.append(heading, summary, metrics, meta);
  card.append(cover, body);
  return card;
}

function createDetailVisual(item) {
  const portrait = getPortraitUrl(item);
  if (!portrait) return null;
  const figure = document.createElement('figure');
  figure.className = 'asset-detail-visual';
  const image = document.createElement('img');
  image.src = portrait;
  image.alt = `${item.title} 角色立绘`;
  figure.append(image);
  return figure;
}

function createMetricsPanel(item) {
  const section = createDetailSection('结构摘要');
  const grid = document.createElement('div');
  grid.className = 'asset-detail-metrics';
  const stats = getMetricEntries(item);
  stats.forEach(([label, value]) => {
    const cell = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = value;
    const span = document.createElement('span');
    span.textContent = label;
    cell.append(strong, span);
    grid.append(cell);
  });
  section.append(grid);
  return section;
}

function createSourcePanel(item) {
  const section = createDetailSection('来源与版本');
  const list = document.createElement('dl');
  list.className = 'asset-detail-list';
  const rows = [
    ['来源', item.sourceLabel],
    ['作者', item.author || '未记录'],
    ['格式', item.format || '未记录'],
    ['版本', item.source?.version || item.payload?.manifest?.version || '未记录'],
    ['更新时间', formatDate(item.updatedAt)]
  ];
  rows.forEach(([label, value]) => {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    list.append(dt, dd);
  });
  section.append(list);
  const payload = item.payload || {};
  const generatedFields = Array.isArray(payload.extensions?.local_roleplay_agent?.enrichment?.generatedFields)
    ? payload.extensions.local_roleplay_agent.enrichment.generatedFields
    : [];
  if (generatedFields.length) {
    const labels = {
      personality: '人格核心',
      scenario: '当前场景',
      postHistoryInstructions: '行为约束',
      exampleDialog: '示例对话'
    };
    const note = document.createElement('p');
    note.className = 'asset-enrichment-note';
    note.textContent = `系统提炼：${generatedFields.map((field) => labels[field] || field).join('、')}。仅补空缺，原始字段未覆盖。`;
    section.append(note);
  }
  return section;
}

function createWorldbookManagementPanel(item) {
  const section = createDetailSection('世界书管理');
  section.classList.add('asset-worldbook-manager');
  const toolbar = document.createElement('div');
  toolbar.className = 'asset-content-manager-toolbar';
  const summary = document.createElement('span');
  const entries = Array.isArray(item.payload?.entries) ? item.payload.entries : [];
  summary.textContent = `${entries.length} 条设定，可在馆藏中独立维护`;
  const add = createActionButton('新增条目', 'worldbook-add', 'asset-secondary-button');
  toolbar.append(summary, add);
  section.append(toolbar);

  const list = document.createElement('div');
  list.className = 'asset-worldbook-entry-list';
  if (!entries.length) {
    list.innerHTML = '<div class="asset-content-manager-empty">这本世界书还没有条目。</div>';
  } else {
    entries.forEach((entry, index) => {
      const row = document.createElement('article');
      row.className = 'asset-worldbook-entry';
      const copy = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = entry.title || `未命名条目 ${index + 1}`;
      const meta = document.createElement('small');
      meta.textContent = [
        entry.constant ? '常驻' : (entry.matchMode || '关键词'),
        `深度 ${entry.depth ?? 4}`,
        entry.enabled === false ? '已停用' : '已启用'
      ].join(' · ');
      const preview = document.createElement('p');
      preview.textContent = truncate(entry.content, 150) || '暂无内容';
      copy.append(title, meta, preview);
      const actions = document.createElement('div');
      actions.className = 'asset-worldbook-entry-actions';
      const edit = createActionButton('编辑', 'worldbook-edit', 'asset-secondary-button');
      const remove = createActionButton('删除', 'worldbook-delete', 'asset-text-danger');
      edit.dataset.assetIndex = String(index);
      remove.dataset.assetIndex = String(index);
      actions.append(edit, remove);
      row.append(copy, actions);
      list.append(row);
    });
  }
  section.append(list);
  return section;
}

function createPromptManagementPanel(item) {
  const section = createDetailSection('预设管理');
  section.classList.add('asset-prompt-manager');
  const payload = item.payload || {};
  const grid = document.createElement('dl');
  grid.className = 'asset-prompt-summary';
  [
    ['角色', payload.role || 'system'],
    ['位置', payload.position || '默认'],
    ['深度', payload.depth ?? '默认'],
    ['状态', payload.enabled === false ? '已停用' : '已启用']
  ].forEach(([label, value]) => {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = String(value);
    grid.append(dt, dd);
  });
  const edit = createActionButton('编辑预设模块', 'prompt-edit', 'asset-secondary-button');
  section.append(grid, edit);
  return section;
}

function createWorldbookEntryTemplate() {
  return {
    id: crypto.randomUUID(),
    type: 'world-book',
    title: '',
    keywords: [],
    secondaryKeywords: [],
    matchMode: 'keyword',
    regex: [],
    logic: 'any',
    content: '',
    priority: 50,
    depth: 4,
    insertionOrder: 0,
    constant: false,
    caseSensitive: false,
    position: 'after_character',
    scope: 'prompt',
    enabled: true,
    source: 'asset-center'
  };
}

function openPromptResourceEditor(item, onDone) {
  const payload = item.payload || {};
  const overlay = document.createElement('div');
  overlay.className = 'wb-editor-overlay';
  const dialog = document.createElement('div');
  dialog.className = 'wb-editor-dialog asset-prompt-editor-dialog';
  dialog.innerHTML = `
    <div class="wb-editor-heading">
      <div><h4>编辑预设模块</h4><p>仅保存声明式 Prompt 字段，不执行随资源附带的脚本。</p></div>
    </div>
    <div class="wb-editor-body asset-prompt-editor-body"></div>
    <div class="wb-editor-actions"></div>
  `;
  const body = dialog.querySelector('.asset-prompt-editor-body');
  const fields = [
    ['title', '标题', 'text'],
    ['role', '消息角色', 'select'],
    ['position', '插入位置', 'select'],
    ['depth', '插入深度', 'number'],
    ['content', 'Prompt 内容', 'textarea']
  ];
  const inputs = {};
  fields.forEach(([key, labelText, type]) => {
    const label = document.createElement('label');
    label.className = 'wb-editor-field is-simple';
    const span = document.createElement('span');
    span.textContent = labelText;
    let input;
    if (type === 'textarea') {
      input = document.createElement('textarea');
      input.rows = 12;
    } else if (type === 'select') {
      input = document.createElement('select');
      const values = key === 'role'
        ? [['system', '系统'], ['user', '用户'], ['assistant', '角色']]
        : [['', '默认'], ['relative', '相对位置'], ['in_chat', '对话内']];
      values.forEach(([value, text]) => input.append(createOption(value, text)));
    } else {
      input = document.createElement('input');
      input.type = type;
    }
    input.className = 'form-input';
    input.value = payload[key] ?? (key === 'role' ? 'system' : key === 'depth' ? 0 : '');
    label.append(span, input);
    body.append(label);
    inputs[key] = input;
  });
  const enabledLabel = document.createElement('label');
  enabledLabel.className = 'wb-editor-checkbox is-simple';
  const enabled = document.createElement('input');
  enabled.type = 'checkbox';
  enabled.checked = payload.enabled !== false;
  enabledLabel.append(enabled, document.createTextNode('启用此模块'));
  body.append(enabledLabel);

  const actions = dialog.querySelector('.wb-editor-actions');
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'ghost-button compact';
  cancel.textContent = '取消';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'primary-button compact';
  save.textContent = '保存预设';
  cancel.addEventListener('click', () => {
    overlay.remove();
    onDone(null);
  });
  save.addEventListener('click', () => {
    const content = inputs.content.value.trim();
    if (!content) {
      inputs.content.focus();
      return;
    }
    const updated = {
      ...payload,
      title: inputs.title.value.trim() || item.title,
      role: inputs.role.value,
      position: inputs.position.value,
      depth: Number(inputs.depth.value || 0),
      content,
      enabled: enabled.checked
    };
    if (!updated.position) delete updated.position;
    overlay.remove();
    onDone(updated);
  });
  actions.append(cancel, save);
  overlay.append(dialog);
  document.body.append(overlay);
  queueMicrotask(() => inputs.title.focus());
}

function createCharacterProfilePanel(item) {
  const section = createDetailSection('角色档案');
  section.classList.add('asset-character-profile');
  const list = document.createElement('dl');
  list.className = 'asset-character-profile-grid';
  const payload = item.payload || {};
  const rows = [
    ['身份定位', firstText(payload.role, payload.description, '未记录')],
    ['人格核心', firstText(payload.personality, '未记录')],
    ['当前场景', firstText(payload.scenario, '未记录')],
    ['开场数量', String(payload.alternateGreetings?.length || (payload.firstMessage ? 1 : 0))],
    ['随卡世界书', `${item.companionWorldbookCount || 0} 份`],
    ['卡片规范', firstText(payload.sourceSpec, item.format, '未记录')]
  ];
  rows.forEach(([label, value]) => {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = truncate(value, 180);
    list.append(dt, dd);
  });
  section.append(list);
  return section;
}

function createVersionPanel(item, catalog) {
  const section = createDetailSection(`同名版本 · ${item.versionCount}`);
  section.classList.add('asset-version-panel');
  const list = document.createElement('div');
  list.className = 'asset-version-list';
  catalog
    .filter((entry) => entry.versionFamilyKey === item.versionFamilyKey)
    .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))
    .forEach((entry) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.dataset.assetVersionKey = entry.key;
      row.disabled = entry.key === item.key;
      const copy = document.createElement('span');
      const title = document.createElement('strong');
      title.textContent = entry.source?.version || entry.payload?.characterVersion || '未标版本';
      const meta = document.createElement('small');
      meta.textContent = `${entry.sourceLabel} · ${formatDate(entry.updatedAt)}`;
      copy.append(title, meta);
      const state = document.createElement('b');
      state.textContent = entry.key === item.key ? '当前' : '查看';
      row.append(copy, state);
      list.append(row);
    });
  section.append(list);
  return section;
}

function createEvaluationPanel(item) {
  const diagnostics = item.diagnostics || {};
  const section = createDetailSection('导入评定');
  const score = document.createElement('div');
  score.className = 'asset-evaluation-score';
  const scoreValue = document.createElement('strong');
  scoreValue.textContent = Number(diagnostics.score || item.score || 0);
  const scoreGrade = document.createElement('span');
  scoreGrade.textContent = diagnostics.grade || '未评定';
  score.append(scoreValue, scoreGrade);
  section.append(score);

  const dimensions = Array.isArray(diagnostics.dimensions) ? diagnostics.dimensions : [];
  if (dimensions.length) {
    const list = document.createElement('div');
    list.className = 'asset-evaluation-dimensions';
    dimensions.slice(0, 5).forEach((dimension) => {
      const row = document.createElement('div');
      const label = document.createElement('span');
      label.textContent = dimension.label || dimension.id;
      const meter = document.createElement('i');
      meter.style.setProperty('--asset-score', `${Math.max(0, Math.min(100, Number(dimension.score || 0)))}%`);
      const value = document.createElement('b');
      value.textContent = Number(dimension.score || 0);
      row.append(label, meter, value);
      list.append(row);
    });
    section.append(list);
  }

  const warnings = Array.isArray(diagnostics.warnings) ? diagnostics.warnings : [];
  if (warnings.length) {
    const warningList = document.createElement('ul');
    warningList.className = 'asset-warning-list';
    warnings.slice(0, 4).forEach((warning) => {
      const row = document.createElement('li');
      row.textContent = warning.message || String(warning);
      warningList.append(row);
    });
    section.append(warningList);
  }
  return section;
}

function createPreviewPanel(item) {
  const section = createDetailSection('内容预览');
  const content = document.createElement('div');
  content.className = 'asset-content-preview';
  if (item.kind === 'character') {
    appendPreviewBlock(content, '身份', item.payload.role || item.payload.description);
    appendPreviewBlock(content, '性格', item.payload.personality);
    appendPreviewBlock(content, '开局', item.payload.scenario || item.payload.firstMessage);
  } else if (item.kind === 'worldbook') {
    const entries = Array.isArray(item.payload.entries) ? item.payload.entries : [];
    entries.slice(0, 8).forEach((entry) => appendPreviewBlock(content, entry.title || '未命名条目', entry.content));
    if (entries.length > 8) appendPreviewBlock(content, '更多条目', `另有 ${entries.length - 8} 条设定未展开。`);
  } else if (item.kind === 'prompt') {
    appendPreviewBlock(content, item.payload.title || item.title, item.payload.content || item.payload.systemPrompt);
  } else {
    appendPreviewBlock(content, '剧本说明', item.summary);
    appendPreviewBlock(content, '依赖', formatDependencies(item.payload.manifest?.dependencies));
  }
  section.append(content);
  return section;
}

function createMetadataEditor(item) {
  const section = createDetailSection('馆藏资料');
  section.classList.add('asset-metadata-editor');
  section.append(
    createField('标题', 'title', item.title),
    createField('摘要', 'summary', item.summary, 'textarea'),
    createField('标签', 'tags', (item.tags || []).join('、'), 'input', '用逗号或顿号分隔'),
    createField('集合', 'collections', (item.collections || []).join('、'), 'input', '例如：仙侠主线、待整理')
  );
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'asset-secondary-button';
  button.dataset.assetAction = 'save';
  button.textContent = '保存馆藏资料';
  section.append(button);
  return section;
}

function createDetailActions(item) {
  const footer = document.createElement('footer');
  footer.className = 'asset-detail-actions';
  if (item.kind !== 'pack') {
    footer.append(createActionButton(item.favorite ? '取消收藏' : '收藏', 'favorite', 'asset-secondary-button'));
    footer.append(createActionButton('重新评估', 'reevaluate', 'asset-secondary-button'));
  }
  footer.append(createActionButton(item.kind === 'prompt' ? '打开剧本工坊' : item.kind === 'pack' ? '在书架查看' : '用于新剧本', 'use', 'asset-primary-button'));
  footer.append(createActionButton('高级拼装', 'compose', 'asset-secondary-button'));
  footer.append(createActionButton('移除', 'delete', 'asset-danger-button'));
  return footer;
}

function createDetailSection(title) {
  const section = document.createElement('section');
  section.className = 'asset-detail-section';
  const heading = document.createElement('h4');
  heading.textContent = title;
  section.append(heading);
  return section;
}

function createField(label, field, value, type = 'input', placeholder = '') {
  const wrapper = document.createElement('label');
  wrapper.className = 'asset-metadata-field';
  const span = document.createElement('span');
  span.textContent = label;
  const control = type === 'textarea' ? document.createElement('textarea') : document.createElement('input');
  control.dataset.assetField = field;
  control.value = value || '';
  control.placeholder = placeholder;
  if (type === 'textarea') control.rows = 3;
  wrapper.append(span, control);
  return wrapper;
}

function createActionButton(label, action, className) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.dataset.assetAction = action;
  button.textContent = label;
  return button;
}

function appendPreviewBlock(container, label, value) {
  if (!String(value || '').trim()) return;
  const article = document.createElement('article');
  const strong = document.createElement('strong');
  strong.textContent = label;
  const paragraph = document.createElement('p');
  paragraph.textContent = truncate(String(value), 420);
  article.append(strong, paragraph);
  container.append(article);
}

function getMetricEntries(item) {
  const stats = item.diagnostics?.stats || {};
  if (item.kind === 'worldbook') {
    return [
      ['条目', String(stats.entryCount ?? item.payload.entries?.length ?? 0)],
      ['常驻', String(stats.constantCount ?? 0)],
      ['触发项', String(stats.triggerableCount ?? 0)],
      ['Token', formatTokenCount(item.estimatedTokens)]
    ];
  }
  if (item.kind === 'character') {
    return [
      ['评分', String(item.score)],
      ['标签', String(item.tags.length)],
      ['开场', String(item.payload.alternateGreetings?.length || (item.payload.firstMessage ? 1 : 0))],
      ['Token', formatTokenCount(item.estimatedTokens)]
    ];
  }
  if (item.kind === 'pack') {
    return [
      ['世界书', String(stats.entryCount || 0)],
      ['角色', String(stats.characterCount || 0)],
      ['版本', item.source?.version || item.payload.manifest?.version || '1.0.0'],
      ['状态', item.diagnostics?.grade || '可用']
    ];
  }
  return [
    ['评分', String(item.score)],
    ['Token', formatTokenCount(item.estimatedTokens)],
    ['标签', String(item.tags.length)],
    ['状态', item.diagnostics?.grade || '可用']
  ];
}

function getMetricLabels(item) {
  return getMetricEntries(item).slice(0, 3).map(([label, value]) => `${value} ${label}`);
}

function getPortraitUrl(item) {
  if (item.kind !== 'character') return '';
  return item.payload?.portrait?.url || item.payload?.avatar || item.payload?.image || '';
}

function scoreClass(score) {
  if (score >= 85) return 'asset-score is-good';
  if (score >= 65) return 'asset-score is-usable';
  return 'asset-score is-warning';
}

function splitLabels(value) {
  return Array.from(new Set(String(value || '').split(/[,，、\n]/).map((item) => item.trim()).filter(Boolean))).slice(0, 40);
}

function normalizeAssetTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/(?:ver(?:sion)?|v)\s*\d+(?:\.\d+)*/gi, '')
    .replace(/[\s·・:：._\-—]+/g, '')
    .trim();
}

function firstText(...values) {
  return String(values.find((value) => String(value || '').trim()) || '').trim();
}

function createOption(value, label) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  return option;
}

function formatTokenCount(value) {
  const number = Number(value || 0);
  if (number >= 100000) return `${Math.round(number / 1000)}k`;
  if (number >= 1000) return `${(number / 1000).toFixed(number >= 10000 ? 0 : 1)}k`;
  return String(number);
}

function formatDate(value) {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) return '未记录';
  return date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function formatDependencies(dependencies) {
  if (!Array.isArray(dependencies) || !dependencies.length) return '无外部依赖';
  return dependencies.map((item) => `${item.kind || '资源'}:${item.id || '未命名'} ${item.range || ''}`.trim()).join('；');
}

function localeSort(left, right) {
  return String(left || '').localeCompare(String(right || ''), 'zh-CN');
}

function truncate(value, limit) {
  const text = String(value || '').trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function createNoopController() {
  return { bindEvents() {}, open() {}, close() {}, render() {}, refresh() {} };
}
