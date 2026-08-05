const EMPTY_PERSONA = Object.freeze({
  enabled: false,
  name: '',
  description: '',
  background: '',
  personality: ''
});

export function readPersonaDraft(els = {}) {
  return {
    enabled: els.personaEnabled?.checked === true,
    name: String(els.personaName?.value || '').trim(),
    description: String(els.personaDescription?.value || '').trim(),
    background: String(els.personaBackground?.value || '').trim(),
    personality: String(els.personaPersonality?.value || '').trim()
  };
}

export function createPersonaWorkspaceController({
  state = {},
  els = {},
  apiRequest = async () => ({}),
  getCurrentSessionId = () => 'main',
  setStatus = () => {},
  humanizeApiError = (error) => error?.message || String(error)
} = {}) {
  let eventsBound = false;
  let operationPending = false;
  let editorInitialized = false;
  let editorDirty = false;
  let editorSessionId = '';
  let draftRevision = 0;

  function ensureConfig() {
    if (!state.config || typeof state.config !== 'object') state.config = {};
    return state.config;
  }

  function setPersonaDraft(persona, { dirty = false } = {}) {
    const source = persona && typeof persona === 'object' && !Array.isArray(persona)
      ? persona
      : EMPTY_PERSONA;
    if (els.personaEnabled) els.personaEnabled.checked = source.enabled === true;
    if (els.personaName) els.personaName.value = String(source.name || '');
    if (els.personaDescription) els.personaDescription.value = String(source.description || '');
    if (els.personaBackground) els.personaBackground.value = String(source.background || '');
    if (els.personaPersonality) els.personaPersonality.value = String(source.personality || '');
    editorInitialized = true;
    editorDirty = dirty;
    editorSessionId = getCurrentSessionId();
    return source;
  }

  function renderPersona({ force = false } = {}) {
    const sessionId = getCurrentSessionId();
    const sessionChanged = editorSessionId !== sessionId;
    if (!force && editorInitialized && editorDirty && !sessionChanged) return false;
    setPersonaDraft(state.config?.persona || EMPTY_PERSONA);
    return true;
  }

  function markDraftDirty() {
    editorInitialized = true;
    editorDirty = true;
    editorSessionId = getCurrentSessionId();
    draftRevision += 1;
  }

  async function savePersona() {
    if (operationPending) return null;
    const sessionId = getCurrentSessionId();
    const revision = draftRevision;
    const persona = readPersonaDraft(els);
    operationPending = true;
    if (els.savePersona) els.savePersona.disabled = true;
    setStatus(els.personaStatus, '正在保存...', 'busy');
    try {
      const payload = await apiRequest('/api/persona', {
        method: 'PUT',
        body: { sessionId, persona }
      });
      if (!payload?.persona || typeof payload.persona !== 'object' || Array.isArray(payload.persona)) {
        throw new Error('INVALID_PERSONA_RESPONSE');
      }
      if (getCurrentSessionId() !== sessionId) {
        setStatus(els.personaStatus, '原会话人设已保存，当前会话未变更', 'ok');
        return payload.persona;
      }

      ensureConfig().persona = payload.persona;
      if (draftRevision === revision) {
        setPersonaDraft(payload.persona);
        setStatus(els.personaStatus, '人设已保存', 'ok');
      } else {
        setStatus(els.personaStatus, '已保存，当前编辑还有未保存修改', 'ok');
      }
      return payload.persona;
    } catch (error) {
      setStatus(els.personaStatus, `保存失败：${humanizeApiError(error)}`, 'error');
      return null;
    } finally {
      operationPending = false;
      if (els.savePersona) els.savePersona.disabled = false;
    }
  }

  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;
    els.personaEnabled?.addEventListener('change', markDraftDirty);
    for (const element of [
      els.personaName,
      els.personaDescription,
      els.personaBackground,
      els.personaPersonality
    ]) {
      element?.addEventListener('input', markDraftDirty);
    }
    els.savePersona?.addEventListener('click', () => {
      void savePersona();
    });
  }

  return {
    bindEvents,
    renderPersona,
    savePersona,
    setPersonaDraft
  };
}
