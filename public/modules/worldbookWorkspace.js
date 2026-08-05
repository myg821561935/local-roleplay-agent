export function parseWorldBookDraft(text, fallback = []) {
  const source = String(text ?? '').trim();
  if (!source) return Array.isArray(fallback) ? [...fallback] : null;
  try {
    const parsed = JSON.parse(source);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function parseWorldBookImportPayload(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && Array.isArray(data.entries)) return data.entries;
  return null;
}

export function createWorldbookWorkspaceController({
  state = {},
  els = {},
  apiRequest = async () => ({}),
  getCurrentSessionId = () => 'main',
  setStatus = () => {},
  humanizeApiError = (error) => error?.message || String(error),
  prettyJson = (value) => JSON.stringify(value, null, 2),
  createEntryTemplate = () => ({}),
  worldbookController = {},
  confirmAction = () => false,
  downloadJsonFile = () => {},
  documentObject = globalThis.document,
  now = () => new Date()
} = {}) {
  let eventsBound = false;
  let savePending = false;
  let editorInitialized = false;
  let editorDirty = false;
  let editorSessionId = '';

  function setWorldbookDraft(entries, { dirty = true } = {}) {
    if (!Array.isArray(entries)) return false;
    if (els.worldbookEditor) els.worldbookEditor.value = prettyJson(entries);
    editorInitialized = true;
    editorDirty = dirty;
    editorSessionId = getCurrentSessionId();
    return true;
  }

  function renderWorldbookEditor({ force = false } = {}) {
    const sessionId = getCurrentSessionId();
    const sessionChanged = editorSessionId !== sessionId;
    if (!force && editorInitialized && editorDirty && !sessionChanged) return false;
    const worldBook = Array.isArray(state.config?.worldBook) ? state.config.worldBook : [];
    setWorldbookDraft(worldBook, { dirty: false });
    return true;
  }

  function readDraft() {
    const fallback = Array.isArray(state.config?.worldBook) ? state.config.worldBook : [];
    return parseWorldBookDraft(els.worldbookEditor?.value, fallback);
  }

  function replaceWorldBook(entries, { dirty = true } = {}) {
    if (!state.config || typeof state.config !== 'object') state.config = {};
    state.config.worldBook = entries;
    setWorldbookDraft(entries, { dirty });
    renderWorldbookEntries();
  }

  function renderWorldbookEntries(...args) {
    return worldbookController.renderWorldbookEntries?.(...args);
  }

  async function saveWorldBook() {
    if (savePending) return null;
    savePending = true;
    setStatus(els.worldbookStatus, '正在保存...', 'busy');
    if (els.saveWorldbook) els.saveWorldbook.disabled = true;
    try {
      const worldBook = readDraft();
      if (!Array.isArray(worldBook)) throw new Error('世界书 JSON 必须是有效数组');
      const payload = await apiRequest('/api/world-book', {
        method: 'PUT',
        body: {
          sessionId: getCurrentSessionId(),
          worldBook
        }
      });
      const saved = Array.isArray(payload.worldBook) ? payload.worldBook : worldBook;
      replaceWorldBook(saved, { dirty: false });
      setStatus(els.worldbookStatus, '世界书已保存', 'ok');
      return saved;
    } catch (error) {
      setStatus(els.worldbookStatus, `保存失败：${humanizeApiError(error)}`, 'error');
      return null;
    } finally {
      savePending = false;
      if (els.saveWorldbook) els.saveWorldbook.disabled = false;
    }
  }

  function addWorldBookEntry() {
    const current = readDraft();
    if (!Array.isArray(current)) {
      setStatus(els.worldbookStatus, '当前世界书 JSON 不是有效数组，无法新增', 'error');
      return false;
    }
    const entries = [...current];
    worldbookController.openWorldbookEntryEditor?.(createEntryTemplate(), (created) => {
      if (created === null) return;
      entries.push(created);
      replaceWorldBook(entries);
      setStatus(els.worldbookStatus, '已添加条目（请点击「保存世界书」持久化）', 'ok');
    });
    return true;
  }

  function renderWorldbookTriggerResult(triggered, query) {
    if (!els.worldbookTriggerResult) return;
    const cards = Array.isArray(triggered) ? triggered : [];
    if (typeof els.worldbookTriggerResult.replaceChildren === 'function') {
      els.worldbookTriggerResult.replaceChildren();
    } else {
      els.worldbookTriggerResult.textContent = '';
    }
    if (!cards.length) {
      const empty = documentObject.createElement('div');
      empty.className = 'empty-state';
      empty.style.padding = '10px';
      empty.textContent = '未触发任何条目';
      els.worldbookTriggerResult.append(empty);
      return;
    }
    const head = documentObject.createElement('div');
    head.style.cssText = 'padding: 6px 0; font-size: 12px; color: var(--subtle);';
    head.textContent = `查询：「${query}」 → 触发 ${cards.length} 个条目`;
    els.worldbookTriggerResult.append(head);
    cards.forEach((cardValue, index) => {
      const card = cardValue && typeof cardValue === 'object' ? cardValue : {};
      const row = documentObject.createElement('div');
      row.className = 'worldbook-trigger-row';
      if (card.constant) row.classList.add('constant');
      const left = documentObject.createElement('div');
      left.style.cssText = 'flex: 1;';
      const title = documentObject.createElement('div');
      title.style.cssText = 'font-weight: 600; color: var(--gold, #f5d58d);';
      title.textContent = `${index + 1}. ${card.title || '未命名'}`;
      left.append(title);
      if (card.content) {
        const content = documentObject.createElement('div');
        content.style.cssText = 'font-size: 12px; color: var(--subtle); margin-top: 2px;';
        const text = String(card.content);
        content.textContent = text.slice(0, 80) + (text.length > 80 ? '…' : '');
        left.append(content);
      }
      row.append(left);
      const meta = documentObject.createElement('div');
      meta.style.cssText = 'text-align: right; font-size: 11px; color: var(--subtle);';
      const parts = [card.matchMode || 'keyword'];
      if (card.constant) parts.push('常驻');
      parts.push(`优先级 ${card.priority ?? 50}`);
      meta.textContent = parts.join(' · ');
      row.append(meta);
      els.worldbookTriggerResult.append(row);
    });
  }

  async function testWorldbookTrigger() {
    const query = String(els.worldbookTriggerInput?.value || '').trim();
    if (!query) {
      setStatus(els.worldbookStatus, '请输入测试文本', 'error');
      return null;
    }
    const worldBook = readDraft();
    if (!Array.isArray(worldBook)) {
      setStatus(els.worldbookStatus, '当前世界书 JSON 不是有效数组，无法测试', 'error');
      return null;
    }
    if (!worldBook.length) {
      setStatus(els.worldbookStatus, '世界书为空', 'error');
      return null;
    }
    try {
      const payload = await apiRequest('/api/world-book/trigger-test', {
        method: 'POST',
        body: { query, worldBook }
      });
      const triggered = Array.isArray(payload.triggered) ? payload.triggered : [];
      renderWorldbookTriggerResult(triggered, query);
      const total = Number.isFinite(Number(payload.total)) ? Number(payload.total) : triggered.length;
      setStatus(els.worldbookStatus, `触发 ${total} 个条目`, 'ok');
      return triggered;
    } catch (error) {
      setStatus(els.worldbookStatus, `测试失败：${humanizeApiError(error)}`, 'error');
      return null;
    }
  }

  function clearWorldbookTrigger() {
    if (els.worldbookTriggerInput) els.worldbookTriggerInput.value = '';
    if (els.worldbookTriggerResult) {
      if (typeof els.worldbookTriggerResult.replaceChildren === 'function') {
        els.worldbookTriggerResult.replaceChildren();
      } else {
        els.worldbookTriggerResult.textContent = '';
      }
    }
  }

  function exportWorldbook() {
    const worldBook = readDraft();
    if (!Array.isArray(worldBook)) {
      setStatus(els.worldbookStatus, '当前世界书 JSON 不是有效数组，无法导出', 'error');
      return false;
    }
    if (!worldBook.length) {
      setStatus(els.worldbookStatus, '世界书为空，无法导出', 'error');
      return false;
    }
    const date = now().toISOString().slice(0, 10);
    downloadJsonFile(worldBook, `worldbook-${date}.json`);
    setStatus(els.worldbookStatus, `已导出 ${worldBook.length} 个条目`, 'ok');
    return true;
  }

  async function importWorldbookFromFile(event) {
    const input = event?.target;
    const file = input?.files?.[0];
    if (!file) return null;
    try {
      const data = JSON.parse(await file.text());
      const imported = parseWorldBookImportPayload(data);
      if (!imported) throw new Error('文件格式不正确，应为世界书条目数组');
      const replace = confirmAction('点击「确定」替换当前世界书，点击「取消」追加到当前世界书末尾');
      let merged;
      if (replace) {
        merged = [...imported];
      } else {
        const current = readDraft();
        if (!Array.isArray(current)) throw new Error('当前世界书 JSON 不是有效数组，无法追加');
        merged = [...current, ...imported];
      }
      replaceWorldBook(merged);
      setStatus(
        els.worldbookStatus,
        `已${replace ? '替换' : '追加'} ${imported.length} 个条目（请点击「保存世界书」持久化）`,
        'ok'
      );
      return merged;
    } catch (error) {
      setStatus(els.worldbookStatus, `导入失败：${humanizeApiError(error)}`, 'error');
      return null;
    } finally {
      input.value = '';
    }
  }

  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;
    els.worldbookEditor?.addEventListener('input', () => {
      editorInitialized = true;
      editorDirty = true;
      editorSessionId = getCurrentSessionId();
    });
    els.saveWorldbook?.addEventListener('click', () => {
      void saveWorldBook();
    });
    els.addWorldbookEntry?.addEventListener('click', addWorldBookEntry);
    els.worldbookSearch?.addEventListener('input', renderWorldbookEntries);
    els.worldbookTypeFilter?.addEventListener('change', renderWorldbookEntries);
    els.exportWorldbook?.addEventListener('click', exportWorldbook);
    els.importWorldbook?.addEventListener('click', () => els.worldbookImportFile?.click());
    els.worldbookImportFile?.addEventListener('change', importWorldbookFromFile);
    els.worldbookTriggerTest?.addEventListener('click', () => {
      void testWorldbookTrigger();
    });
    els.worldbookTriggerClear?.addEventListener('click', clearWorldbookTrigger);
  }

  return {
    addWorldBookEntry,
    bindEvents,
    clearWorldbookTrigger,
    exportWorldbook,
    importWorldbookFromFile,
    renderWorldbookEditor,
    renderWorldbookEntries,
    renderWorldbookTriggerResult,
    saveWorldBook,
    setWorldbookDraft,
    testWorldbookTrigger
  };
}
