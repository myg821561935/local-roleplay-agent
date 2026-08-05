import { PROMPT_PRESETS, WORLDBOOK_PRESETS } from './presetCatalog.js';
import {
  buildResourcePresetCatalog,
  getResourceSelectionId,
  renderResourceOptionGroup,
  RESOURCE_PRESET_KEYS
} from './resourcePresetCatalog.js';

export function parsePromptDraft(text) {
  try {
    const parsed = JSON.parse(String(text ?? '').trim() || '[]');
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function clonePreset(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createPresetWorkspaceController({
  state = {},
  els = {},
  apiRequest = async () => ({}),
  getCurrentSessionId = () => 'main',
  setStatus = () => {},
  humanizeApiError = (error) => error?.message || String(error),
  prettyJson = (value) => JSON.stringify(value, null, 2),
  setWorldbookDraft = () => false,
  getResources = () => [],
  confirmAction = () => false,
  promptAction = () => null,
  documentObject = globalThis.document
} = {}) {
  let eventsBound = false;
  let operationPending = false;
  let promptEditorInitialized = false;
  let promptEditorDirty = false;
  let promptEditorSessionId = '';

  function ensureConfig() {
    if (!state.config || typeof state.config !== 'object') state.config = {};
    return state.config;
  }

  function setPromptDraft(promptModules, { dirty = true } = {}) {
    if (!Array.isArray(promptModules)) return false;
    if (els.promptEditor) els.promptEditor.value = prettyJson(promptModules);
    promptEditorInitialized = true;
    promptEditorDirty = dirty;
    promptEditorSessionId = getCurrentSessionId();
    return true;
  }

  function renderPromptEditor({ force = false } = {}) {
    const sessionId = getCurrentSessionId();
    const sessionChanged = promptEditorSessionId !== sessionId;
    if (!force && promptEditorInitialized && promptEditorDirty && !sessionChanged) return false;
    const promptModules = Array.isArray(state.config?.promptModules) ? state.config.promptModules : [];
    setPromptDraft(promptModules, { dirty: false });
    return true;
  }

  function renderPromptPresetFavorites() {
    renderResourcePresetOptions();
    const select = els.promptPresetFavorites;
    if (!select || !documentObject?.createElement) return;
    const presets = Array.isArray(state.config?.promptPresets) ? state.config.promptPresets : [];
    const current = select.value;
    select.replaceChildren();

    const placeholder = documentObject.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '-- 我的预设 --';
    select.append(placeholder);

    for (const preset of presets) {
      const option = documentObject.createElement('option');
      option.value = String(preset?.id || '');
      option.textContent = String(preset?.name || '未命名预设');
      select.append(option);
    }
    select.value = presets.some((preset) => preset?.id === current) ? current : '';
  }

  function renderResourcePresetOptions() {
    const catalog = buildResourcePresetCatalog(getResources());
    renderResourceOptionGroup({
      select: els.promptPresetSelect,
      documentObject,
      groupId: RESOURCE_PRESET_KEYS.promptGroupId,
      groupLabel: '已导入 Prompt / Regex',
      preservePrefix: RESOURCE_PRESET_KEYS.promptPrefix,
      options: catalog.promptBundles.map((bundle) => ({
        value: `${RESOURCE_PRESET_KEYS.promptPrefix}${bundle.id}`,
        label: `${bundle.title}（${bundle.moduleCount} 模块）`
      }))
    });
    renderResourceOptionGroup({
      select: els.worldbookPresetSelect,
      documentObject,
      groupId: RESOURCE_PRESET_KEYS.worldbookGroupId,
      groupLabel: '已导入世界书',
      preservePrefix: RESOURCE_PRESET_KEYS.worldbookPrefix,
      options: catalog.worldBooks.map((resource) => ({
        value: `${RESOURCE_PRESET_KEYS.worldbookPrefix}${resource.id}`,
        label: `${resource.title || '未命名世界书'}（${resource.payload.entries.length} 条）`
      }))
    });
  }

  function resolveImportedPromptPreset(value) {
    const batchId = getResourceSelectionId(value, RESOURCE_PRESET_KEYS.promptPrefix);
    const bundle = buildResourcePresetCatalog(getResources()).promptBundles.find((item) => item.id === batchId);
    return bundle ? {
      title: bundle.title,
      promptModules: bundle.promptModules
    } : null;
  }

  function resolveImportedWorldbookPreset(value) {
    const resourceId = getResourceSelectionId(value, RESOURCE_PRESET_KEYS.worldbookPrefix);
    const resource = buildResourcePresetCatalog(getResources()).worldBooks.find((item) => item.id === resourceId);
    return resource ? {
      title: resource.title || '未命名世界书',
      entries: resource.payload?.entries || []
    } : null;
  }

  function setOperationDisabled(disabled) {
    for (const element of [
      els.savePrompt,
      els.savePromptPreset,
      els.applySavedPromptPreset,
      els.deletePromptPreset,
      els.applyPromptPreset,
      els.applyWorldbookPreset
    ]) {
      if (element) element.disabled = disabled;
    }
  }

  async function runOperation(operation) {
    if (operationPending) return null;
    operationPending = true;
    setOperationDisabled(true);
    try {
      return await operation();
    } finally {
      operationPending = false;
      setOperationDisabled(false);
    }
  }

  async function savePromptPresetFavorite() {
    if (operationPending) return null;
    const name = promptAction('预设名称：', '');
    if (name == null) return null;
    const promptModules = parsePromptDraft(els.promptEditor?.value);
    if (!promptModules) {
      setStatus(els.promptStatus, '当前 Prompt 内容必须是有效的 JSON 数组，无法保存为预设', 'error');
      return null;
    }

    return runOperation(async () => {
      setStatus(els.promptStatus, '正在保存预设...', 'busy');
      try {
        const payload = await apiRequest('/api/prompt-presets', {
          method: 'POST',
          body: { name: String(name).trim() || undefined, promptModules }
        });
        if (!Array.isArray(payload?.promptPresets) || !payload?.preset?.id) {
          throw new Error('INVALID_PROMPT_PRESET_RESPONSE');
        }
        ensureConfig().promptPresets = payload.promptPresets;
        renderPromptPresetFavorites();
        if (els.promptPresetFavorites) els.promptPresetFavorites.value = payload.preset.id;
        setStatus(els.promptStatus, '已存为预设', 'ok');
        return payload.preset;
      } catch (error) {
        setStatus(els.promptStatus, `保存失败：${humanizeApiError(error)}`, 'error');
        return null;
      }
    });
  }

  async function applySavedPromptPreset() {
    if (operationPending) return null;
    const presetId = els.promptPresetFavorites?.value;
    if (!presetId) {
      setStatus(els.promptStatus, '请先选择一个预设', 'error');
      return null;
    }
    if (!confirmAction('应用预设将覆盖当前的 Prompt 模块，确认继续？')) return null;

    return runOperation(async () => {
      setStatus(els.promptStatus, '正在应用预设...', 'busy');
      try {
        const payload = await apiRequest('/api/prompt-presets/apply', {
          method: 'POST',
          body: {
            id: presetId,
            sessionId: getCurrentSessionId()
          }
        });
        if (!Array.isArray(payload?.promptModules)) throw new Error('INVALID_PROMPT_MODULES_RESPONSE');
        ensureConfig().promptModules = payload.promptModules;
        if (Array.isArray(payload.promptPresets)) state.config.promptPresets = payload.promptPresets;
        setPromptDraft(payload.promptModules, { dirty: false });
        setStatus(els.promptStatus, '已应用预设，请在新对话中生效', 'ok');
        return payload.promptModules;
      } catch (error) {
        setStatus(els.promptStatus, `应用失败：${humanizeApiError(error)}`, 'error');
        return null;
      }
    });
  }

  async function deletePromptPresetFavorite() {
    if (operationPending) return null;
    const presetId = els.promptPresetFavorites?.value;
    if (!presetId) {
      setStatus(els.promptStatus, '请先选择一个预设', 'error');
      return null;
    }
    if (!confirmAction('确认删除该预设？')) return null;

    return runOperation(async () => {
      setStatus(els.promptStatus, '正在删除预设...', 'busy');
      try {
        const payload = await apiRequest('/api/prompt-presets', {
          method: 'DELETE',
          body: { id: presetId }
        });
        if (!Array.isArray(payload?.promptPresets)) throw new Error('INVALID_PROMPT_PRESET_RESPONSE');
        ensureConfig().promptPresets = payload.promptPresets;
        renderPromptPresetFavorites();
        setStatus(els.promptStatus, '已删除预设', 'ok');
        return payload.promptPresets;
      } catch (error) {
        setStatus(els.promptStatus, `删除失败：${humanizeApiError(error)}`, 'error');
        return null;
      }
    });
  }

  function applyPromptPreset() {
    if (operationPending) return false;
    const selectedValue = els.promptPresetSelect?.value;
    const imported = resolveImportedPromptPreset(selectedValue);
    const preset = imported?.promptModules || PROMPT_PRESETS[selectedValue];
    if (!preset) return false;
    setPromptDraft(clonePreset(preset));
    setStatus(
      els.promptStatus,
      imported ? `已加载资源库预设：${imported.title}，请点击保存生效` : '已加载预设，请点击保存生效',
      'ok'
    );
    return true;
  }

  function applyWorldbookPreset() {
    if (operationPending) return false;
    const selectedValue = els.worldbookPresetSelect?.value;
    const imported = resolveImportedWorldbookPreset(selectedValue);
    const preset = imported?.entries || WORLDBOOK_PRESETS[selectedValue];
    if (!preset) return false;
    setWorldbookDraft(clonePreset(preset));
    setStatus(
      els.worldbookStatus,
      imported ? `已加载资源库世界书：${imported.title}，请点击保存生效` : '已加载预设，请点击保存生效',
      'ok'
    );
    return true;
  }

  async function savePromptModules() {
    if (operationPending) return null;
    const promptModules = parsePromptDraft(els.promptEditor?.value);
    if (!promptModules) {
      setStatus(els.promptStatus, 'Prompt JSON 必须是有效数组', 'error');
      return null;
    }

    return runOperation(async () => {
      setStatus(els.promptStatus, '正在保存...', 'busy');
      try {
        const payload = await apiRequest('/api/prompt-modules', {
          method: 'PUT',
          body: {
            sessionId: getCurrentSessionId(),
            promptModules
          }
        });
        if (!Array.isArray(payload?.promptModules)) throw new Error('INVALID_PROMPT_MODULES_RESPONSE');
        ensureConfig().promptModules = payload.promptModules;
        setPromptDraft(payload.promptModules, { dirty: false });
        setStatus(els.promptStatus, 'Prompt 已保存', 'ok');
        return payload.promptModules;
      } catch (error) {
        setStatus(els.promptStatus, `保存失败：${humanizeApiError(error)}`, 'error');
        return null;
      }
    });
  }

  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;
    els.promptEditor?.addEventListener('input', () => {
      promptEditorInitialized = true;
      promptEditorDirty = true;
      promptEditorSessionId = getCurrentSessionId();
    });
    els.applySavedPromptPreset?.addEventListener('click', () => {
      void applySavedPromptPreset();
    });
    els.savePromptPreset?.addEventListener('click', () => {
      void savePromptPresetFavorite();
    });
    els.deletePromptPreset?.addEventListener('click', () => {
      void deletePromptPresetFavorite();
    });
    els.savePrompt?.addEventListener('click', () => {
      void savePromptModules();
    });
    els.applyPromptPreset?.addEventListener('click', applyPromptPreset);
    els.applyWorldbookPreset?.addEventListener('click', applyWorldbookPreset);
  }

  return {
    applyPromptPreset,
    applySavedPromptPreset,
    applyWorldbookPreset,
    bindEvents,
    deletePromptPresetFavorite,
    renderPromptEditor,
    renderPromptPresetFavorites,
    renderResourcePresetOptions,
    savePromptModules,
    savePromptPresetFavorite,
    setPromptDraft
  };
}
