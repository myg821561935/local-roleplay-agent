export function createAuthorNoteWorkspaceController({
  state = {},
  els = {},
  getCurrentSessionId = () => 'main',
  saveSettingsPatch = async () => ({}),
  setStatus = () => {},
  humanizeApiError = (error) => error?.message || String(error)
} = {}) {
  let eventsBound = false;
  let editorInitialized = false;
  let editorDirty = false;
  let editorSessionId = '';
  let draftRevision = 0;
  const savedNotes = new Map();
  const pendingSaves = new Map();

  function currentSessionId() {
    return String(getCurrentSessionId() || 'main');
  }

  function readAuthorNoteDraft() {
    return String(els.authorNoteInput?.value || '');
  }

  function updateAuthorNoteButton() {
    if (!els.toggleAuthorNote) return;
    els.toggleAuthorNote.classList.toggle('active', Boolean(readAuthorNoteDraft().trim()));
  }

  function syncPanelState() {
    const expanded = Boolean(els.authorNotePanel)
      && !els.authorNotePanel.classList.contains('collapsed');
    els.toggleAuthorNote?.setAttribute('aria-expanded', String(expanded));
    els.authorNotePanel?.setAttribute('aria-hidden', String(!expanded));
    return expanded;
  }

  function setAuthorNoteDraft(note, {
    dirty = false,
    sessionId = currentSessionId(),
    recordSaved = !dirty
  } = {}) {
    const normalizedNote = String(note || '');
    if (els.authorNoteInput) els.authorNoteInput.value = normalizedNote;
    editorInitialized = true;
    editorDirty = dirty;
    editorSessionId = sessionId;
    if (recordSaved) savedNotes.set(sessionId, normalizedNote);
    updateAuthorNoteButton();
    return normalizedNote;
  }

  function renderAuthorNoteSettings({ force = false } = {}) {
    const sessionId = currentSessionId();
    const sessionChanged = editorSessionId !== sessionId;
    if (!force && editorInitialized && editorDirty && !sessionChanged) {
      updateAuthorNoteButton();
      syncPanelState();
      return false;
    }

    setAuthorNoteDraft(state.session?.settings?.authorNote || '', { sessionId });
    syncPanelState();
    return true;
  }

  function markDraftDirty() {
    editorInitialized = true;
    editorDirty = true;
    editorSessionId = currentSessionId();
    draftRevision += 1;
    updateAuthorNoteButton();
  }

  function toggleAuthorNotePanel() {
    if (!els.authorNotePanel) return false;
    const collapsed = els.authorNotePanel.classList.toggle('collapsed');
    syncPanelState();
    if (!collapsed) els.authorNoteInput?.focus();
    return !collapsed;
  }

  function hasPendingSaveForSession(sessionId) {
    return [...pendingSaves.values()].some((pending) => pending.sessionId === sessionId);
  }

  function saveAuthorNote() {
    const sessionId = currentSessionId();
    const note = readAuthorNoteDraft();
    const saveKey = JSON.stringify([sessionId, note]);
    const duplicate = pendingSaves.get(saveKey);
    if (duplicate) return duplicate.promise;

    if (!hasPendingSaveForSession(sessionId) && savedNotes.get(sessionId) === note) {
      editorDirty = false;
      return Promise.resolve(null);
    }

    const revision = draftRevision;
    updateAuthorNoteButton();
    setStatus(els.appStatus, '正在保存作者注释...', 'busy');

    const pending = { sessionId, note, promise: null };
    pending.promise = (async () => {
      try {
        const session = await saveSettingsPatch({ authorNote: note });
        savedNotes.set(sessionId, note);
        if (currentSessionId() !== sessionId) {
          setStatus(els.appStatus, '原会话作者注释已保存，当前会话未变更', 'ok');
          return session;
        }

        if (
          editorSessionId === sessionId
          && draftRevision === revision
          && readAuthorNoteDraft() === note
        ) {
          editorDirty = false;
          setStatus(els.appStatus, note.trim() ? '作者注释已保存' : '作者注释已清空', 'ok');
        } else {
          setStatus(els.appStatus, '已保存，当前作者注释还有未保存修改', 'ok');
        }
        return session;
      } catch (error) {
        const prefix = currentSessionId() === sessionId
          ? '作者注释保存失败'
          : '原会话作者注释保存失败';
        setStatus(els.appStatus, `${prefix}：${humanizeApiError(error)}`, 'error');
        return null;
      } finally {
        if (pendingSaves.get(saveKey) === pending) pendingSaves.delete(saveKey);
      }
    })();
    pendingSaves.set(saveKey, pending);
    return pending.promise;
  }

  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;
    els.authorNoteInput?.addEventListener('input', markDraftDirty);
    els.authorNoteInput?.addEventListener('blur', () => {
      void saveAuthorNote();
    });
    els.authorNoteInput?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey)) return;
      event.preventDefault();
      void saveAuthorNote();
    });
  }

  return {
    bindEvents,
    renderAuthorNoteSettings,
    saveAuthorNote,
    setAuthorNoteDraft,
    toggleAuthorNotePanel,
    updateAuthorNoteButton
  };
}
