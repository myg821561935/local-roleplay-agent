import { humanizeApiError, isPlainObject } from './utils.js';

export const FACT_TYPE_OPTIONS = Object.freeze([
  { value: 'uncategorized', label: '未分类' },
  { value: 'character', label: '人物' },
  { value: 'location', label: '地点' },
  { value: 'item', label: '物品' },
  { value: 'quest', label: '任务' },
  { value: 'relationship', label: '关系' },
  { value: 'event', label: '事件' },
  { value: 'flag', label: '标记' },
  { value: 'rule', label: '规则' }
]);

const FACT_TYPE_VALUES = new Set(FACT_TYPE_OPTIONS.map(({ value }) => value));

export function normalizeFactType(value) {
  const type = String(value ?? '').trim() || 'uncategorized';
  return FACT_TYPE_VALUES.has(type) ? type : 'uncategorized';
}

export function splitFactKeywords(value) {
  return String(value || '')
    .split(/[\n\r、,，]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normalizeFactKeywords(value) {
  if (typeof value === 'string') return splitFactKeywords(value);
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? '').trim()).filter(Boolean);
}

export function createFactTemplate() {
  return {
    title: '新事实',
    enabled: true,
    content: '',
    type: 'uncategorized',
    keywords: [],
    source: 'manual'
  };
}

export function normalizeUiFact(fact, index = 0) {
  const object = typeof fact === 'string' ? { content: fact } : (isPlainObject(fact) ? fact : {});
  const content = String(object.content ?? '').trim();
  return {
    id: String(object.id ?? '').trim(),
    title: String(object.title ?? '').trim() || content.slice(0, 40) || `事实 ${index + 1}`,
    content,
    type: normalizeFactType(object.type),
    keywords: normalizeFactKeywords(object.keywords),
    source: String(object.source ?? 'manual').trim() || 'manual',
    enabled: object.enabled !== false
  };
}

export function factSignature(fact) {
  return JSON.stringify({
    title: String(fact.title || '').trim(),
    content: String(fact.content || '').trim(),
    type: normalizeFactType(fact.type),
    source: String(fact.source || 'manual').trim() || 'manual',
    keywords: normalizeFactKeywords(fact.keywords),
    enabled: fact.enabled !== false
  });
}

export function isPersistedFactId(factId) {
  const value = String(factId || '').trim();
  return Boolean(value) && !value.startsWith('__index:');
}

export function createFactCardsController({
  state = {},
  els = {},
  apiRequest = async () => ({}),
  getCurrentSessionId = () => 'main',
  replaceSession = () => state.session,
  mergeSession = () => state.session,
  refreshInspector = () => {},
  applyPromotedWorldBook = () => {},
  setStatus = () => {},
  documentObject = globalThis.document
} = {}) {
  let eventsBound = false;

  function getMemoryFacts() {
    const memoryCards = state.session?.memory?.memoryCards;
    return Array.isArray(memoryCards) ? memoryCards : [];
  }

  function readFactCardFields(card) {
    const enabledInput = card.querySelector('.fact-enabled input');
    return {
      title: String(card.querySelector('.fact-title-input')?.value || '').trim(),
      content: String(card.querySelector('.fact-content')?.value || '').trim(),
      type: normalizeFactType(card.querySelector('.fact-type')?.value),
      source: String(card.querySelector('.fact-source')?.value || '').trim() || 'manual',
      keywords: splitFactKeywords(card.querySelector('.fact-keywords')?.value || ''),
      enabled: Boolean(enabledInput?.checked)
    };
  }

  function factSignatureFromCard(card) {
    return factSignature(readFactCardFields(card));
  }

  function isFactCardDirty(card) {
    return String(card.dataset.savedSignature || '') !== factSignatureFromCard(card);
  }

  function syncFactPromoteState(card) {
    const promote = card.querySelector('[data-promote-fact]');
    if (!promote) return;

    const factId = String(card.dataset.factId || '').trim();
    const needsSave = !isPersistedFactId(factId);
    const dirty = !needsSave && isFactCardDirty(card);
    promote.disabled = needsSave || dirty;
    promote.title = needsSave ? '请先保存事实后再提升' : (dirty ? '请先保存修改后再提升' : '');
  }

  function createFactNode(fact, index) {
    const normalized = normalizeUiFact(fact, index);
    const { title, content, type, source, enabled } = normalized;
    const keywords = normalized.keywords.join('、');
    const factId = normalized.id;
    const cardFactId = factId || `__index:${index}`;

    const card = documentObject.createElement('article');
    card.className = 'fact-card';
    card.dataset.factId = cardFactId;
    card.dataset.savedSignature = factSignature(normalized);

    const topline = documentObject.createElement('div');
    topline.className = 'fact-card-topline';

    const titleWrap = documentObject.createElement('label');
    titleWrap.className = 'fact-title';
    const titleLabel = documentObject.createElement('span');
    titleLabel.textContent = '标题';
    const titleInput = documentObject.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'fact-title-input';
    titleInput.value = title;
    titleInput.placeholder = '事实标题';
    titleWrap.append(titleLabel, titleInput);

    const enabledWrap = documentObject.createElement('label');
    enabledWrap.className = 'fact-enabled';
    const enabledInput = documentObject.createElement('input');
    enabledInput.type = 'checkbox';
    enabledInput.className = 'fact-enabled-input';
    enabledInput.checked = enabled;
    enabledInput.title = '是否启用';
    const enabledText = documentObject.createElement('span');
    enabledText.textContent = '启用';
    enabledWrap.append(enabledInput, enabledText);
    topline.append(titleWrap, enabledWrap);

    const grid = documentObject.createElement('div');
    grid.className = 'fact-grid';

    const contentWrap = documentObject.createElement('label');
    contentWrap.className = 'fact-field';
    const contentLabel = documentObject.createElement('span');
    contentLabel.textContent = '内容';
    const contentInput = documentObject.createElement('textarea');
    contentInput.className = 'fact-content';
    contentInput.rows = 4;
    contentInput.value = content;
    contentInput.placeholder = '输入事实内容';
    contentWrap.append(contentLabel, contentInput);

    const typeWrap = documentObject.createElement('label');
    typeWrap.className = 'fact-field';
    const typeLabel = documentObject.createElement('span');
    typeLabel.textContent = '类型';
    const typeInput = documentObject.createElement('select');
    typeInput.className = 'fact-type';
    FACT_TYPE_OPTIONS.forEach((option) => {
      const optionNode = documentObject.createElement('option');
      optionNode.value = option.value;
      optionNode.textContent = option.label;
      typeInput.append(optionNode);
    });
    typeInput.value = type;
    typeWrap.append(typeLabel, typeInput);

    const keywordWrap = documentObject.createElement('label');
    keywordWrap.className = 'fact-field';
    const keywordLabel = documentObject.createElement('span');
    keywordLabel.textContent = '关键词（逗号分隔）';
    const keywordInput = documentObject.createElement('input');
    keywordInput.type = 'text';
    keywordInput.className = 'fact-keywords';
    keywordInput.value = keywords;
    keywordInput.placeholder = '关键词1、关键词2';
    keywordWrap.append(keywordLabel, keywordInput);

    const sourceWrap = documentObject.createElement('label');
    sourceWrap.className = 'fact-field';
    const sourceLabel = documentObject.createElement('span');
    sourceLabel.textContent = '来源';
    const sourceInput = documentObject.createElement('input');
    sourceInput.type = 'text';
    sourceInput.className = 'fact-source';
    sourceInput.value = source;
    sourceInput.placeholder = 'manual';
    sourceWrap.append(sourceLabel, sourceInput);

    grid.append(contentWrap, typeWrap, keywordWrap, sourceWrap);

    const actions = documentObject.createElement('div');
    actions.className = 'fact-card-actions';

    const promote = documentObject.createElement('button');
    promote.type = 'button';
    promote.className = 'ghost-button compact';
    promote.dataset.promoteFact = cardFactId;
    promote.textContent = '提升为世界书';

    const remove = documentObject.createElement('button');
    remove.type = 'button';
    remove.className = 'danger-button compact';
    remove.dataset.deleteFact = cardFactId;
    remove.textContent = '删除';

    actions.append(promote, remove);
    card.append(topline, grid, actions);
    syncFactPromoteState(card);
    return card;
  }

  function renderFacts() {
    const facts = getMemoryFacts();
    els.factList.innerHTML = '';

    if (!facts.length) {
      const empty = documentObject.createElement('div');
      empty.className = 'compact-empty';
      empty.textContent = '暂无事实卡片。';
      els.factList.append(empty);
      return;
    }

    const fragment = documentObject.createDocumentFragment();
    facts.forEach((fact, index) => fragment.append(createFactNode(fact, index)));
    els.factList.append(fragment);
  }

  function addFactCard() {
    const nextFacts = [...getMemoryFacts(), createFactTemplate()];
    mergeSession({ memory: { ...(state.session?.memory || {}), memoryCards: nextFacts } });
    renderFacts();
    setStatus(els.factStatus, '已添加事实模板，请保存更新', 'ok');
  }

  function deleteFactCard(factId) {
    const facts = getMemoryFacts();
    let nextFacts;
    if (typeof factId === 'string' && factId.startsWith('__index:')) {
      const index = Number(factId.slice(8));
      if (Number.isInteger(index) && index >= 0) {
        nextFacts = facts.slice();
        nextFacts.splice(index, 1);
      }
    }
    if (!nextFacts) nextFacts = facts.filter((fact) => fact.id !== factId);

    mergeSession({ memory: { ...(state.session?.memory || {}), memoryCards: nextFacts } });
    renderFacts();
    setStatus(els.factStatus, '已删除事实，请保存', 'ok');
  }

  function collectFactsFromDom() {
    return Array.from(els.factList.querySelectorAll('.fact-card')).map((card) => {
      const factId = String(card.dataset.factId || '').trim();
      const fields = readFactCardFields(card);
      return {
        ...(isPersistedFactId(factId) ? { id: factId } : {}),
        ...fields
      };
    });
  }

  async function saveFacts() {
    setStatus(els.factStatus, '正在保存...', 'busy');
    els.saveFacts.disabled = true;
    try {
      const facts = collectFactsFromDom();
      const payload = await apiRequest('/api/memory/facts', {
        method: 'PUT',
        body: {
          sessionId: getCurrentSessionId(),
          facts
        }
      });
      replaceSession(payload.session, { fallback: state.session });
      refreshInspector();
      setStatus(els.factStatus, '事实已保存', 'ok');
    } catch (error) {
      setStatus(els.factStatus, `保存失败：${humanizeApiError(error)}`, 'error');
    } finally {
      els.saveFacts.disabled = false;
    }
  }

  async function promoteFact(factId) {
    if (!isPersistedFactId(factId)) {
      setStatus(els.factStatus, '请先保存事实后再提升', 'error');
      return;
    }
    setStatus(els.factStatus, '正在提升为世界书...', 'busy');
    try {
      const payload = await apiRequest(`/api/memory/facts/${encodeURIComponent(factId)}/promote`, {
        method: 'POST',
        body: { sessionId: getCurrentSessionId() }
      });
      applyPromotedWorldBook(payload.worldBook);
      setStatus(els.factStatus, '已提升为世界书', 'ok');
    } catch (error) {
      setStatus(els.factStatus, `提升失败：${humanizeApiError(error)}`, 'error');
    }
  }

  function syncChangedFactCard(event) {
    const card = event.target?.closest?.('.fact-card');
    if (card) syncFactPromoteState(card);
  }

  async function handleFactListClick(event) {
    const deleteButton = event.target?.closest?.('[data-delete-fact]');
    if (deleteButton) {
      deleteFactCard(deleteButton.dataset.deleteFact);
      return;
    }
    const promoteButton = event.target?.closest?.('[data-promote-fact]');
    if (!promoteButton) return;

    const card = promoteButton.closest('.fact-card');
    if (card && isFactCardDirty(card)) {
      syncFactPromoteState(card);
      setStatus(els.factStatus, '请先保存修改后再提升', 'error');
      return;
    }
    await promoteFact(promoteButton.dataset.promoteFact);
  }

  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;
    els.addFact?.addEventListener('click', addFactCard);
    els.saveFacts?.addEventListener('click', saveFacts);
    els.factList?.addEventListener('click', handleFactListClick);
    els.factList?.addEventListener('input', syncChangedFactCard);
    els.factList?.addEventListener('change', syncChangedFactCard);
  }

  return {
    addFactCard,
    bindEvents,
    collectFactsFromDom,
    deleteFactCard,
    getMemoryFacts,
    handleFactListClick,
    isFactCardDirty,
    promoteFact,
    renderFacts,
    saveFacts,
    syncFactPromoteState
  };
}
