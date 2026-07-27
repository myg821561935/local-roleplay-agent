export function createAssetLibraryController({
  state,
  els,
  apiRequest,
  getAssetCenterController,
  closeStoryLauncher,
  openStoryLauncher,
  renderStoryPackGrid,
  getCharacterPortraitUrl,
  getCompanionWorldBooks,
  invalidateCustomStoryInspection,
  persistCustomStoryDraft,
  openCustomStoryDialog,
  activateWorkMode,
  activateTab,
  activateResourceView,
  renderResourcePackBuilder,
  downloadJsonFile
}) {
  function openAssetCenter() {
    closeStoryLauncher();
    getAssetCenterController()?.open();
  }

  function openAssetImportPicker(kind = '') {
    if (!els.characterCardImport) return;
    const acceptedTypes = {
      character: '.png,.json,image/png,application/json',
      worldbook: '.json,.yaml,.yml,.txt,application/json,text/yaml,text/plain',
      prompt: '.json,.yaml,.yml,.txt,application/json,text/yaml,text/plain'
    };
    els.characterCardImport.dataset.assetImportKind = kind;
    els.characterCardImport.accept = acceptedTypes[kind]
      || '.json,.png,.yaml,.yml,.txt,application/json,image/png,text/yaml,text/plain';
    els.characterCardImport.click();
  }

  function useAssetFromCenter(item) {
    if (!item) return;
    if (item.kind === 'pack') {
      openStoryLauncher({ focusSearch: false });
      if (els.storyPackSearch) els.storyPackSearch.value = item.title || '';
      renderStoryPackGrid();
      return;
    }
    if (item.kind === 'prompt') {
      openAssetComposer(item);
      return;
    }

    if (item.kind === 'character') {
      state.customStoryDraft.characterResourceId = item.id;
      state.customStoryDraft.useCharacterPortraitAsBackground = Boolean(getCharacterPortraitUrl(item.payload));
      if (!state.customStoryDraft.titleCustomized) {
        state.customStoryDraft.title = `${item.title || '新角色'} · 新卷`;
      }
      const companions = getCompanionWorldBooks(item.raw, state.resourceLibrary)
        .map((resource) => resource.id);
      state.customStoryDraft.worldBookResourceIds = Array.from(new Set([
        ...state.customStoryDraft.worldBookResourceIds,
        ...companions
      ]));
    } else if (item.kind === 'worldbook') {
      state.customStoryDraft.worldBookResourceIds = Array.from(new Set([
        ...state.customStoryDraft.worldBookResourceIds,
        item.id
      ]));
      if (!state.customStoryDraft.titleCustomized) {
        state.customStoryDraft.title = `${item.title || '新世界'} · 新卷`;
      }
    }
    invalidateCustomStoryInspection();
    persistCustomStoryDraft();
    openCustomStoryDialog();
  }

  function openAssetComposer(item = null) {
    activateWorkMode('settings');
    activateTab('sources');
    activateResourceView('composer');
    renderResourcePackBuilder();
    if (!item) return;
    if (item.kind === 'character' && els.resourcePackCharacter) {
      els.resourcePackCharacter.value = item.id;
    }
    const picker = item.kind === 'worldbook'
      ? els.resourcePackWorldbooks
      : item.kind === 'prompt'
        ? els.resourcePackPrompts
        : null;
    const checkbox = picker?.querySelector(`input[value="${CSS.escape(item.id)}"]`);
    if (checkbox) checkbox.checked = true;
  }

  async function saveAssetMetadata(item, updates) {
    if (!item?.id || item.kind === 'pack') return;
    await apiRequest(`/api/resource-library/resources/${encodeURIComponent(item.id)}`, {
      method: 'PATCH',
      body: updates
    });
  }

  async function saveAssetContent(item, updates) {
    if (!item?.id || !['worldbook', 'prompt'].includes(item.kind)) return;
    await apiRequest(`/api/resource-library/resources/${encodeURIComponent(item.id)}/content`, {
      method: 'PATCH',
      body: updates
    });
  }

  async function reevaluateAssetFromCenter(item) {
    if (!item?.id || item.kind === 'pack') return;
    await apiRequest(`/api/resource-library/resources/${encodeURIComponent(item.id)}/reevaluate`, {
      method: 'POST',
      body: {}
    });
  }

  async function deleteAssetFromCenter(item) {
    if (!item?.id) return;
    const path = item.kind === 'pack'
      ? `/api/resource-library/packs/${encodeURIComponent(item.id)}`
      : `/api/resource-library/resources/${encodeURIComponent(item.id)}`;
    await apiRequest(path, { method: 'DELETE', body: {} });
  }

  async function saveAssetBatchMetadata(items, updates) {
    const resourceIds = items.filter((item) => item.kind !== 'pack').map((item) => item.id);
    if (!resourceIds.length) return;
    await apiRequest('/api/resource-library/resources', {
      method: 'PATCH',
      body: { resourceIds, ...updates }
    });
  }

  async function exportAssetsFromCenter(items) {
    const resourceIds = items.filter((item) => item.kind !== 'pack').map((item) => item.id);
    if (!resourceIds.length) return;
    const { bundle } = await apiRequest('/api/resource-library/resources/export', {
      method: 'POST',
      body: { resourceIds }
    });
    downloadJsonFile(bundle, `roleplay-assets-${new Date().toISOString().slice(0, 10)}.json`);
  }

  async function deleteAssetsFromCenter(items) {
    const resourceIds = items.filter((item) => item.kind !== 'pack').map((item) => item.id);
    if (!resourceIds.length) return;
    await apiRequest('/api/resource-library/resources', {
      method: 'DELETE',
      body: { resourceIds }
    });
  }

  return {
    deleteAssetFromCenter,
    deleteAssetsFromCenter,
    exportAssetsFromCenter,
    openAssetCenter,
    openAssetComposer,
    openAssetImportPicker,
    reevaluateAssetFromCenter,
    saveAssetBatchMetadata,
    saveAssetContent,
    saveAssetMetadata,
    useAssetFromCenter
  };
}
