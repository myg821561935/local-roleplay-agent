import { renderSafeMarkdown } from './markdown.js';

const MASKED_SECRET = '********';

const state = {
  config: {
    providers: { activeProviderId: '', providers: [] },
    promptModules: [],
    worldBook: [],
    characterCard: {}
  },
  session: {
    id: 'main',
    messages: [],
    memory: {}
  }
};

const els = {
  appStatus: document.querySelector('#app-status'),
  providerId: document.querySelector('#provider-id'),
  providerBaseUrl: document.querySelector('#provider-base-url'),
  providerApiKey: document.querySelector('#provider-api-key'),
  providerModel: document.querySelector('#provider-model'),
  providerTemperature: document.querySelector('#provider-temperature'),
  providerMaxTokens: document.querySelector('#provider-max-tokens'),
  providerHeaders: document.querySelector('#provider-headers'),
  saveProvider: document.querySelector('#save-provider'),
  providerStatus: document.querySelector('#provider-status'),
  messages: document.querySelector('#messages'),
  chatForm: document.querySelector('#chat-form'),
  chatInput: document.querySelector('#chat-input'),
  refreshState: document.querySelector('#refresh-state'),
  memoryView: document.querySelector('#memory-view'),
  factList: document.querySelector('#fact-list'),
  factStatus: document.querySelector('#fact-status'),
  addFact: document.querySelector('#add-fact'),
  saveFacts: document.querySelector('#save-facts'),
  worldbookEditor: document.querySelector('#worldbook-editor'),
  saveWorldbook: document.querySelector('#save-worldbook'),
  addWorldbookEntry: document.querySelector('#add-worldbook-entry'),
  worldbookStatus: document.querySelector('#worldbook-status'),
  characterCardEditor: document.querySelector('#character-card-editor'),
  characterCardImport: document.querySelector('#character-card-import'),
  saveCharacterCard: document.querySelector('#save-character-card'),
  resetCharacterCard: document.querySelector('#reset-character-card'),
  characterCardStatus: document.querySelector('#character-card-status'),
  promptEditor: document.querySelector('#prompt-editor'),
  savePrompt: document.querySelector('#save-prompt'),
  promptStatus: document.querySelector('#prompt-status'),
  sessionStatus: document.querySelector('#session-status'),
  themeSelect: document.querySelector('#theme-select'),
  stageActions: document.querySelector('.stage-actions'),
  tabButtons: Array.from(document.querySelectorAll('[data-tab]')),
  tabPanes: Array.from(document.querySelectorAll('[data-pane]'))
};

document.addEventListener('DOMContentLoaded', () => {
  applyTheme(loadTheme());
  bindEvents();
  loadState();
});

function bindEvents() {
  document.querySelector('#provider-form').addEventListener('submit', (event) => {
    event.preventDefault();
    saveProvider();
  });

  els.chatForm.addEventListener('submit', (event) => {
    event.preventDefault();
    sendMessage();
  });

  els.refreshState.addEventListener('click', () => loadState());
  els.themeSelect.addEventListener('change', () => applyTheme(els.themeSelect.value));
  els.addFact.addEventListener('click', () => addFactCard());
  els.saveFacts.addEventListener('click', () => saveFacts());
  els.saveWorldbook.addEventListener('click', () => saveWorldBook());
  els.addWorldbookEntry.addEventListener('click', () => addWorldBookEntry());
  els.saveCharacterCard.addEventListener('click', () => saveCharacterCard());
  els.resetCharacterCard.addEventListener('click', () => resetCharacterCardTemplate());
  els.characterCardImport.addEventListener('change', () => importCharacterCardFile());
  els.savePrompt.addEventListener('click', () => savePromptModules());

  els.messages.addEventListener('click', (event) => {
    const recommendation = event.target.closest('[data-recommended-action]');
    if (recommendation) {
      useRecommendedAction(recommendation.dataset.recommendedAction);
      return;
    }

    const edit = event.target.closest('[data-edit-message]');
    if (edit) {
      editMessage(edit.dataset.editMessage);
      return;
    }

    const regenerate = event.target.closest('[data-regenerate-message]');
    if (regenerate) regenerateMessage(regenerate.dataset.regenerateMessage);
  });

  els.stageActions.addEventListener('click', (event) => {
    const tabShortcut = event.target.closest('[data-tab-shortcut]');
    if (tabShortcut) {
      activateTab(tabShortcut.dataset.tabShortcut);
      return;
    }

    const actionTemplate = event.target.closest('[data-action-template]');
    if (actionTemplate) {
      els.chatInput.value = actionTemplate.dataset.actionTemplate;
      els.chatInput.focus();
      return;
    }

    if (event.target.closest('[data-scroll-bottom]')) {
      els.messages.scrollTop = els.messages.scrollHeight;
    }
  });

  els.tabButtons.forEach((button) => {
    button.addEventListener('click', () => activateTab(button.dataset.tab));
  });

  els.factList.addEventListener('click', (event) => {
    const deleteButton = event.target.closest('[data-delete-fact]');
    if (deleteButton) {
      deleteFactCard(deleteButton.dataset.deleteFact);
      return;
    }
    const promoteButton = event.target.closest('[data-promote-fact]');
    if (promoteButton) {
      const card = promoteButton.closest('.fact-card');
      if (card && isFactCardDirty(card)) {
        syncFactPromoteState(card);
        setStatus(els.factStatus, '请先保存修改后再提升', 'error');
        return;
      }
      promoteFact(promoteButton.dataset.promoteFact);
    }
  });

  els.factList.addEventListener('input', syncChangedFactCard);
  els.factList.addEventListener('change', syncChangedFactCard);
}

async function loadState() {
  setStatus(els.appStatus, '正在载入本地状态...', 'busy');
  try {
    const payload = await apiRequest('/api/state');
    state.config = payload.config || state.config;
    state.session = payload.session || state.session;
    renderAll();
    setStatus(els.appStatus, '状态已同步', 'ok');
  } catch (error) {
    setStatus(els.appStatus, `载入失败：${error.message}`, 'error');
  }
}

function renderAll() {
  renderProviderForm();
  renderMessages();
  renderInspector();
}

function renderProviderForm() {
  const providersConfig = state.config.providers || { activeProviderId: '', providers: [] };
  const providers = Array.isArray(providersConfig.providers) ? providersConfig.providers : [];
  const activeId = providersConfig.activeProviderId || providers[0]?.id || '';
  const provider = providers.find((item) => item.id === activeId) || providers[0] || {};

  els.providerId.value = provider.id || activeId || 'local';
  els.providerBaseUrl.value = provider.baseUrl || '';
  els.providerApiKey.value = provider.apiKey ? MASKED_SECRET : '';
  els.providerModel.value = provider.model || '';
  els.providerTemperature.value = normalizedNumber(provider.temperature, 0.9);
  els.providerMaxTokens.value = normalizedNumber(provider.maxTokens, 2000);
  els.providerHeaders.value = prettyJson(provider.headers || {});

  if (provider.id) {
    setStatus(els.providerStatus, `当前：${provider.id}`, 'ok');
  } else {
    setStatus(els.providerStatus, '未配置 provider', '');
  }
}

function renderMessages() {
  const messages = Array.isArray(state.session?.messages) ? state.session.messages : [];
  els.messages.innerHTML = '';

  if (!messages.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '会话为空。';
    els.messages.append(empty);
  } else {
    const fragment = document.createDocumentFragment();
    messages.forEach((message) => fragment.append(createMessageNode(message)));
    els.messages.append(fragment);
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  const sessionId = state.session?.id || 'main';
  const count = messages.length;
  setStatus(els.sessionStatus, `${sessionId} · ${count} 条消息`, '');
}

function createMessageNode(message) {
  const article = document.createElement('article');
  const role = message.role === 'user' ? 'user' : 'assistant';
  article.className = `message ${role}`;

  const meta = document.createElement('div');
  meta.className = 'message-meta';

  const roleText = document.createElement('span');
  roleText.className = 'message-role';
  roleText.textContent = role === 'user' ? '用户' : 'Agent';

  const time = document.createElement('time');
  time.textContent = formatTime(message.createdAt);
  if (message.createdAt) time.dateTime = message.createdAt;

  if (role === 'assistant' && Array.isArray(message.swipes) && message.swipes.length > 1) {
    const swipes = document.createElement('span');
    swipes.className = 'swipe-count';
    swipes.textContent = `Swipe ${Number(message.activeSwipeIndex || 0) + 1}/${message.swipes.length}`;
    meta.append(roleText, swipes, time);
  } else {
    meta.append(roleText, time);
  }

  const content = document.createElement('div');
  content.className = 'message-content';
  content.innerHTML = renderSafeMarkdown(message.content || '');

  article.append(meta, content);
  article.append(createMessageTools(message, role));
  const actions = createRecommendedActionsNode(message.recommendedActions);
  if (actions) article.append(actions);
  return article;
}

function createMessageTools(message, role) {
  const wrap = document.createElement('div');
  wrap.className = 'message-tools';

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'tool-button';
  edit.dataset.editMessage = message.id;
  edit.textContent = '编辑';
  wrap.append(edit);

  if (role === 'assistant') {
    const regenerate = document.createElement('button');
    regenerate.type = 'button';
    regenerate.className = 'tool-button';
    regenerate.dataset.regenerateMessage = message.id;
    regenerate.textContent = '重生成';
    wrap.append(regenerate);
  }

  return wrap;
}

function createRecommendedActionsNode(actions) {
  if (!Array.isArray(actions) || !actions.length) return null;
  const wrap = document.createElement('div');
  wrap.className = 'recommended-actions';

  const label = document.createElement('span');
  label.className = 'recommended-actions-label';
  label.textContent = '推荐下一步';
  wrap.append(label);

  actions.forEach((action) => {
    const text = String(action || '').trim();
    if (!text) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'recommendation-button';
    button.dataset.recommendedAction = text;
    button.textContent = text;
    wrap.append(button);
  });

  return wrap.childElementCount > 1 ? wrap : null;
}

function useRecommendedAction(action) {
  const text = String(action || '').trim();
  if (!text || els.chatInput.disabled) return;
  els.chatInput.value = text;
  sendMessage();
}

async function editMessage(messageId) {
  const message = findMessage(messageId);
  if (!message) return;
  const content = window.prompt('编辑消息', message.content || '');
  if (content === null) return;
  setStatus(els.sessionStatus, '正在编辑并重生成...', 'busy');
  try {
    const payload = await apiRequest(`/api/messages/${encodeURIComponent(messageId)}`, {
      method: 'PATCH',
      body: {
        sessionId: state.session?.id || 'main',
        content
      }
    });
    state.session = payload.session || state.session;
    renderMessages();
    renderInspector();
    setStatus(els.appStatus, '消息已编辑', 'ok');
  } catch (error) {
    setStatus(els.sessionStatus, `编辑失败：${humanizeApiError(error)}`, 'error');
  }
}

async function regenerateMessage(messageId) {
  setStatus(els.sessionStatus, '正在重生成...', 'busy');
  try {
    const payload = await apiRequest(`/api/messages/${encodeURIComponent(messageId)}/regenerate`, {
      method: 'POST',
      body: { sessionId: state.session?.id || 'main' }
    });
    state.session = payload.session || state.session;
    renderMessages();
    renderInspector();
    setStatus(els.appStatus, '已生成新的 Swipe', 'ok');
  } catch (error) {
    setStatus(els.sessionStatus, `重生成失败：${humanizeApiError(error)}`, 'error');
  }
}

function findMessage(messageId) {
  return (Array.isArray(state.session?.messages) ? state.session.messages : [])
    .find((message) => message.id === messageId);
}

function renderInspector() {
  els.memoryView.textContent = prettyJson(state.session?.memory || {});
  renderFacts();
  els.worldbookEditor.value = prettyJson(state.config.worldBook || []);
  els.characterCardEditor.value = prettyJson(state.config.characterCard || createCharacterCardTemplate());
  els.promptEditor.value = prettyJson(state.config.promptModules || []);
}

function renderFacts() {
  const facts = getMemoryFacts();
  els.factList.innerHTML = '';

  if (!facts.length) {
    const empty = document.createElement('div');
    empty.className = 'compact-empty';
    empty.textContent = '暂无事实卡片。';
    els.factList.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  facts.forEach((fact, index) => fragment.append(createFactNode(fact, index)));
  els.factList.append(fragment);
}

function createFactNode(fact, index) {
  const normalized = normalizeUiFact(fact, index);
  const { title, content, type, source, enabled } = normalized;
  const keywords = normalized.keywords.join('、');
  const factId = normalized.id;
  const cardFactId = factId || `__index:${index}`;

  const card = document.createElement('article');
  card.className = 'fact-card';
  card.dataset.factId = cardFactId;
  card.dataset.savedSignature = factSignature(normalized);

  const topline = document.createElement('div');
  topline.className = 'fact-card-topline';

  const titleWrap = document.createElement('label');
  titleWrap.className = 'fact-title';
  const titleLabel = document.createElement('span');
  titleLabel.textContent = '标题';
  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'fact-title-input';
  titleInput.value = title;
  titleInput.placeholder = '事实标题';
  titleWrap.append(titleLabel, titleInput);

  const enabledWrap = document.createElement('label');
  enabledWrap.className = 'fact-enabled';
  const enabledInput = document.createElement('input');
  enabledInput.type = 'checkbox';
  enabledInput.className = 'fact-enabled-input';
  enabledInput.checked = enabled;
  enabledInput.title = '是否启用';
  const enabledText = document.createElement('span');
  enabledText.textContent = '启用';
  enabledWrap.append(enabledInput, enabledText);
  topline.append(titleWrap, enabledWrap);

  const grid = document.createElement('div');
  grid.className = 'fact-grid';

  const contentWrap = document.createElement('label');
  contentWrap.className = 'fact-field';
  const contentLabel = document.createElement('span');
  contentLabel.textContent = '内容';
  const contentInput = document.createElement('textarea');
  contentInput.className = 'fact-content';
  contentInput.rows = 4;
  contentInput.value = content;
  contentInput.placeholder = '输入事实内容';
  contentWrap.append(contentLabel, contentInput);

  const typeWrap = document.createElement('label');
  typeWrap.className = 'fact-field';
  const typeLabel = document.createElement('span');
  typeLabel.textContent = '类型';
  const typeInput = document.createElement('input');
  typeInput.type = 'text';
  typeInput.className = 'fact-type';
  typeInput.value = type;
  typeInput.placeholder = 'uncategorized';
  typeWrap.append(typeLabel, typeInput);

  const keywordWrap = document.createElement('label');
  keywordWrap.className = 'fact-field';
  const keywordLabel = document.createElement('span');
  keywordLabel.textContent = '关键词（逗号分隔）';
  const keywordInput = document.createElement('input');
  keywordInput.type = 'text';
  keywordInput.className = 'fact-keywords';
  keywordInput.value = keywords;
  keywordInput.placeholder = '关键词1、关键词2';
  keywordWrap.append(keywordLabel, keywordInput);

  const sourceWrap = document.createElement('label');
  sourceWrap.className = 'fact-field';
  const sourceLabel = document.createElement('span');
  sourceLabel.textContent = '来源';
  const sourceInput = document.createElement('input');
  sourceInput.type = 'text';
  sourceInput.className = 'fact-source';
  sourceInput.value = source;
  sourceInput.placeholder = 'manual';
  sourceWrap.append(sourceLabel, sourceInput);

  grid.append(contentWrap, typeWrap, keywordWrap, sourceWrap);

  const actions = document.createElement('div');
  actions.className = 'fact-card-actions';

  const promote = document.createElement('button');
  promote.type = 'button';
  promote.className = 'ghost-button compact';
  promote.dataset.promoteFact = cardFactId;
  promote.textContent = '提升为世界书';

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'danger-button compact';
  remove.dataset.deleteFact = cardFactId;
  remove.textContent = '删除';

  actions.append(promote, remove);
  card.append(topline, grid, actions);
  syncFactPromoteState(card);
  return card;
}

function getMemoryFacts() {
  const memoryCards = state.session?.memory?.memoryCards;
  return Array.isArray(memoryCards) ? memoryCards : [];
}

function addFactCard() {
  const facts = getMemoryFacts();
  facts.push(createFactTemplate());
  state.session = {
    ...state.session,
    memory: {
      ...state.session?.memory,
      memoryCards: facts
    }
  };
  renderFacts();
  setStatus(els.factStatus, '已添加事实模板，请保存更新', 'ok');
}

function deleteFactCard(factId) {
  const facts = getMemoryFacts();
  if (typeof factId === 'string' && factId.startsWith('__index:')) {
    const index = Number(factId.slice(8));
    if (Number.isInteger(index) && index >= 0) {
      const nextFacts = facts.slice();
      nextFacts.splice(index, 1);
      state.session = {
        ...state.session,
        memory: {
          ...state.session?.memory,
          memoryCards: nextFacts
        }
      };
      renderFacts();
      setStatus(els.factStatus, '已删除事实，请保存', 'ok');
      return;
    }
  }

  const nextFacts = facts.filter((fact) => fact.id !== factId);
  state.session = {
    ...state.session,
    memory: {
      ...state.session?.memory,
      memoryCards: nextFacts
    }
  };
  renderFacts();
  setStatus(els.factStatus, '已删除事实，请保存', 'ok');
}

async function saveFacts() {
  setStatus(els.factStatus, '正在保存...', 'busy');
  els.saveFacts.disabled = true;
  try {
    const facts = collectFactsFromDom();
    const payload = await apiRequest('/api/memory/facts', {
      method: 'PUT',
      body: {
        sessionId: state.session?.id || 'main',
        facts
      }
    });
    state.session = payload.session || state.session;
    renderInspector();
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
      body: { sessionId: state.session?.id || 'main' }
    });
    state.config.worldBook = payload.worldBook || state.config.worldBook;
    renderInspector();
    setStatus(els.factStatus, '已提升为世界书', 'ok');
  } catch (error) {
    setStatus(els.factStatus, `提升失败：${humanizeApiError(error)}`, 'error');
  }
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

function createFactTemplate() {
  return {
    title: '新事实',
    enabled: true,
    content: '',
    type: 'uncategorized',
    keywords: [],
    source: 'manual'
  };
}

function normalizeUiFact(fact, index = 0) {
  const object = typeof fact === 'string' ? { content: fact } : (isPlainObject(fact) ? fact : {});
  const content = String(object.content ?? '').trim();
  return {
    id: String(object.id ?? '').trim(),
    title: String(object.title ?? '').trim() || content.slice(0, 40) || `事实 ${index + 1}`,
    content,
    type: String(object.type ?? 'uncategorized').trim() || 'uncategorized',
    keywords: normalizeKeywordList(object.keywords),
    source: String(object.source ?? 'manual').trim() || 'manual',
    enabled: object.enabled !== false
  };
}

function normalizeKeywordList(value) {
  if (typeof value === 'string') return splitKeywords(value);
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? '').trim()).filter(Boolean);
}

function readFactCardFields(card) {
  const enabledInput = card.querySelector('.fact-enabled input');
  return {
    title: String(card.querySelector('.fact-title-input')?.value || '').trim(),
    content: String(card.querySelector('.fact-content')?.value || '').trim(),
    type: String(card.querySelector('.fact-type')?.value || 'uncategorized').trim() || 'uncategorized',
    source: String(card.querySelector('.fact-source')?.value || '').trim() || 'manual',
    keywords: splitKeywords(card.querySelector('.fact-keywords')?.value || ''),
    enabled: Boolean(enabledInput?.checked)
  };
}

function factSignature(fact) {
  return JSON.stringify({
    title: String(fact.title || '').trim(),
    content: String(fact.content || '').trim(),
    type: String(fact.type || 'uncategorized').trim() || 'uncategorized',
    source: String(fact.source || 'manual').trim() || 'manual',
    keywords: normalizeKeywordList(fact.keywords),
    enabled: fact.enabled !== false
  });
}

function factSignatureFromCard(card) {
  return factSignature(readFactCardFields(card));
}

function isFactCardDirty(card) {
  return String(card.dataset.savedSignature || '') !== factSignatureFromCard(card);
}

function isPersistedFactId(factId) {
  const value = String(factId || '').trim();
  return Boolean(value) && !value.startsWith('__index:');
}

function syncChangedFactCard(event) {
  const card = event.target.closest('.fact-card');
  if (card) syncFactPromoteState(card);
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

function splitKeywords(value) {
  return String(value || '')
    .split(/[\n\r、,，]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function saveProvider() {
  setStatus(els.providerStatus, '正在保存...', 'busy');
  els.saveProvider.disabled = true;
  try {
    const headers = parseJsonFromTextarea(els.providerHeaders, 'Headers JSON');
    if (!isPlainObject(headers)) throw new Error('Headers JSON 必须是普通对象');
    const provider = {
      id: els.providerId.value.trim() || 'local',
      kind: 'openai-compatible',
      baseUrl: els.providerBaseUrl.value.trim(),
      apiKey: resolveApiKeyForSave(),
      model: els.providerModel.value.trim(),
      temperature: Number(els.providerTemperature.value || 0.9),
      maxTokens: Number(els.providerMaxTokens.value || 2000),
      headers
    };
    const providers = {
      activeProviderId: provider.id,
      providers: [provider]
    };

    await apiRequest('/api/providers', {
      method: 'PUT',
      body: providers
    });
    setStatus(els.providerStatus, '接口已保存', 'ok');
    setStatus(els.appStatus, 'Provider 配置已更新', 'ok');
    await loadState();
  } catch (error) {
    setStatus(els.providerStatus, `保存失败：${error.message}`, 'error');
  } finally {
    els.saveProvider.disabled = false;
  }
}

function resolveApiKeyForSave() {
  const inputValue = els.providerApiKey.value.trim();
  if (inputValue === MASKED_SECRET) return MASKED_SECRET;
  if (inputValue) return inputValue;

  const existing = getExistingProvider();
  if (existing?.apiKey === MASKED_SECRET) return MASKED_SECRET;
  return '';
}

function getExistingProvider() {
  const providersConfig = state.config.providers || {};
  const providers = Array.isArray(providersConfig.providers) ? providersConfig.providers : [];
  const id = els.providerId.value.trim() || providersConfig.activeProviderId;
  return providers.find((provider) => provider.id === id) || providers[0];
}

async function saveWorldBook() {
  setStatus(els.worldbookStatus, '正在保存...', 'busy');
  els.saveWorldbook.disabled = true;
  try {
    const worldBook = parseJsonFromTextarea(els.worldbookEditor, '世界书 JSON');
    if (!Array.isArray(worldBook)) throw new Error('世界书 JSON 必须是数组');
    const payload = await apiRequest('/api/world-book', {
      method: 'PUT',
      body: { worldBook }
    });
    state.config.worldBook = payload.worldBook || worldBook;
    els.worldbookEditor.value = prettyJson(state.config.worldBook);
    setStatus(els.worldbookStatus, '世界书已保存', 'ok');
  } catch (error) {
    setStatus(els.worldbookStatus, `保存失败：${error.message}`, 'error');
  } finally {
    els.saveWorldbook.disabled = false;
  }
}

function addWorldBookEntry() {
  try {
    const worldBook = parseJsonFromTextarea(els.worldbookEditor, '世界书 JSON');
    if (!Array.isArray(worldBook)) throw new Error('世界书 JSON 必须是数组');
    worldBook.push(createWorldBookEntryTemplate());
    els.worldbookEditor.value = prettyJson(worldBook);
    setStatus(els.worldbookStatus, '已添加条目模板，编辑后保存', 'ok');
  } catch (error) {
    setStatus(els.worldbookStatus, `新增失败：${error.message}`, 'error');
  }
}

async function saveCharacterCard() {
  setStatus(els.characterCardStatus, '正在保存...', 'busy');
  els.saveCharacterCard.disabled = true;
  try {
    const characterCard = parseJsonFromTextarea(els.characterCardEditor, '角色卡 JSON');
    if (!isPlainObject(characterCard)) throw new Error('角色卡 JSON 必须是普通对象');
    const payload = await apiRequest('/api/character-card', {
      method: 'PUT',
      body: { characterCard }
    });
    state.config.characterCard = payload.characterCard || characterCard;
    els.characterCardEditor.value = prettyJson(state.config.characterCard);
    setStatus(els.characterCardStatus, '角色卡已保存', 'ok');
  } catch (error) {
    setStatus(els.characterCardStatus, `保存失败：${error.message}`, 'error');
  } finally {
    els.saveCharacterCard.disabled = false;
  }
}

function resetCharacterCardTemplate() {
  els.characterCardEditor.value = prettyJson({
    ...createCharacterCardTemplate(),
    ...safeObjectFromTextarea(els.characterCardEditor)
  });
  setStatus(els.characterCardStatus, '已套用角色卡模板，编辑后保存', 'ok');
}

async function importCharacterCardFile() {
  const file = els.characterCardImport.files?.[0];
  if (!file) return;
  setStatus(els.characterCardStatus, '正在导入角色卡...', 'busy');
  try {
    const data = await readFileAsDataUrl(file);
    const payload = await apiRequest('/api/character-card/import', {
      method: 'POST',
      body: {
        fileName: file.name,
        mimeType: file.type || inferMimeType(file.name),
        data
      }
    });
    state.config.characterCard = payload.characterCard || state.config.characterCard;
    state.config.worldBook = payload.worldBook || state.config.worldBook;
    renderInspector();
    setStatus(els.characterCardStatus, `导入完成，角色书条目 ${payload.importedWorldBookCount || 0} 条`, 'ok');
  } catch (error) {
    setStatus(els.characterCardStatus, `导入失败：${humanizeApiError(error)}`, 'error');
  } finally {
    els.characterCardImport.value = '';
  }
}

async function savePromptModules() {
  setStatus(els.promptStatus, '正在保存...', 'busy');
  els.savePrompt.disabled = true;
  try {
    const promptModules = parseJsonFromTextarea(els.promptEditor, 'Prompt JSON');
    if (!Array.isArray(promptModules)) throw new Error('Prompt JSON 必须是数组');
    const payload = await apiRequest('/api/prompt-modules', {
      method: 'PUT',
      body: { promptModules }
    });
    state.config.promptModules = payload.promptModules || promptModules;
    els.promptEditor.value = prettyJson(state.config.promptModules);
    setStatus(els.promptStatus, 'Prompt 已保存', 'ok');
  } catch (error) {
    setStatus(els.promptStatus, `保存失败：${error.message}`, 'error');
  } finally {
    els.savePrompt.disabled = false;
  }
}

async function sendMessage() {
  const content = els.chatInput.value.trim();
  if (!content) return;

  els.chatInput.disabled = true;
  setStatus(els.sessionStatus, 'Agent 正在生成...', 'busy');
  els.chatInput.value = '';
  const preview = appendStreamingPreview(content);

  try {
    const payload = await streamChat({
      sessionId: state.session?.id || 'main',
      content,
      onToken: (token) => updateStreamingPreview(preview, token)
    });
    state.session = payload.session || state.session;
    renderMessages();
    els.memoryView.textContent = prettyJson(state.session?.memory || {});
    setStatus(els.appStatus, '对话已更新', 'ok');
  } catch (error) {
    renderMessages();
    setStatus(els.sessionStatus, `发送失败：${humanizeApiError(error)}`, 'error');
  } finally {
    els.chatInput.disabled = false;
    els.chatInput.focus();
  }
}

function appendStreamingPreview(userContent) {
  const empty = els.messages.querySelector('.empty-state');
  if (empty) empty.remove();

  const userNode = createPreviewNode('user', userContent);
  const assistantNode = createPreviewNode('assistant', '');
  assistantNode.classList.add('is-streaming');
  els.messages.append(userNode, assistantNode);
  els.messages.scrollTop = els.messages.scrollHeight;
  return {
    content: '',
    userNode,
    node: assistantNode,
    contentNode: assistantNode.querySelector('.message-content')
  };
}

function createPreviewNode(role, content) {
  const article = document.createElement('article');
  article.className = `message ${role}`;
  const meta = document.createElement('div');
  meta.className = 'message-meta';
  const roleText = document.createElement('span');
  roleText.className = 'message-role';
  roleText.textContent = role === 'user' ? '用户' : 'Agent';
  meta.append(roleText);
  const body = document.createElement('div');
  body.className = 'message-content';
  body.innerHTML = renderSafeMarkdown(content);
  article.append(meta, body);
  return article;
}

function updateStreamingPreview(preview, token) {
  if (!preview?.contentNode) return;
  preview.content += token;
  preview.contentNode.innerHTML = renderSafeMarkdown(preview.content);
  els.messages.scrollTop = els.messages.scrollHeight;
}

async function streamChat(body) {
  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(formatHttpError(response, text));
  }
  if (!response.body) {
    throw new Error('当前浏览器不支持流式响应');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let donePayload;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';
    events.forEach((eventText) => {
      const event = parseSseEvent(eventText);
      if (!event) return;
      if (event.event === 'token') body.onToken?.(String(event.data?.content || ''));
      if (event.event === 'done') donePayload = event.data;
      if (event.event === 'error') throwSseError(event.data);
    });
  }

  if (!donePayload) throw new Error('流式响应缺少完成事件');
  return donePayload;
}

function parseSseEvent(text) {
  const lines = String(text || '').split('\n');
  const event = lines.find((line) => line.startsWith('event: '))?.slice(7).trim();
  const dataText = lines
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice(6))
    .join('\n');
  if (!event) return null;
  return { event, data: parseJsonResponse(dataText) };
}

function throwSseError(data) {
  const error = new Error(data?.error || 'STREAM_ERROR');
  error.code = data?.error;
  throw error;
}

function loadTheme() {
  try {
    return localStorage.getItem('local-roleplay-agent-theme') || 'wuxia-scroll';
  } catch {
    return 'wuxia-scroll';
  }
}

function applyTheme(theme) {
  const value = theme === 'default-dark' ? 'default-dark' : 'wuxia-scroll';
  document.documentElement.dataset.theme = value;
  try {
    localStorage.setItem('local-roleplay-agent-theme', value);
  } catch {
    // Theme still applies for the current page even if storage is unavailable.
  }
  if (els.themeSelect) els.themeSelect.value = value;
}

function activateTab(tab) {
  els.tabButtons.forEach((button) => {
    const active = button.dataset.tab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });

  els.tabPanes.forEach((pane) => {
    const active = pane.dataset.pane === tab;
    pane.classList.toggle('active', active);
    pane.hidden = !active;
  });
}

async function apiRequest(path, options = {}) {
  const fetchOptions = {
    method: options.method || 'GET',
    headers: options.headers ? { ...options.headers } : {}
  };

  if (options.body !== undefined) {
    fetchOptions.headers['content-type'] = 'application/json';
    fetchOptions.body = JSON.stringify(options.body);
  }

  const response = await fetch(path, fetchOptions);
  const responseText = await response.text();
  const isJson = isJsonResponse(response);
  const payload = isJson ? parseJsonResponse(responseText) : undefined;
  if (!response.ok) {
    const message = payload?.error || payload?.message || formatHttpError(response, responseText);
    const error = new Error(message);
    error.code = payload?.error;
    error.status = response.status;
    throw error;
  }
  if (payload === undefined) {
    throw new Error(`接口返回的不是 JSON：${formatHttpError(response, responseText)}`);
  }
  return payload;
}

function parseJsonFromTextarea(textarea, label) {
  try {
    return JSON.parse(textarea.value || 'null');
  } catch {
    throw new Error(`${label} 解析失败`);
  }
}

function parseJsonResponse(text) {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isJsonResponse(response) {
  return (response.headers.get('content-type') || '').toLowerCase().includes('application/json');
}

function formatHttpError(response, text) {
  const status = `${response.status} ${response.statusText}`.trim();
  const snippet = truncateText(text.trim(), 160);
  return snippet ? `${status}: ${snippet}` : status;
}

function truncateText(text, maxLength) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeObjectFromTextarea(textarea) {
  try {
    const value = JSON.parse(textarea.value || '{}');
    return isPlainObject(value) ? value : {};
  } catch {
    return {};
  }
}

function createWorldBookEntryTemplate() {
  return {
    id: `manual-${Date.now()}`,
    type: 'memory',
    title: '新世界书条目',
    keywords: ['关键词'],
    secondaryKeywords: [],
    matchMode: 'keyword',
    regex: [],
    logic: 'any',
    content: '这里写设定、地点、势力、物品、伏笔或长期事实。',
    priority: 50,
    depth: 4,
    insertionOrder: 0,
    constant: false,
    caseSensitive: false,
    position: 'after_character',
    scope: 'prompt',
    enabled: true,
    source: 'manual',
    extensions: {},
    updatedAt: new Date().toISOString()
  };
}

function createCharacterCardTemplate() {
  return {
    name: '未命名主角',
    role: '身份/职业',
    description: '外貌、背景、能力、限制、长期目标。',
    personality: '性格、说话方式、价值观。',
    scenario: '当前处境、开局地点、正在面对的问题。',
    firstMessage: '',
    exampleDialog: [],
    creatorNotes: '',
    systemPrompt: '',
    postHistoryInstructions: '',
    alternateGreetings: [],
    tags: [],
    creator: '',
    characterVersion: '',
    extensions: {},
    enabled: true
  };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result || '')));
    reader.addEventListener('error', () => reject(reader.error || new Error('文件读取失败')));
    reader.readAsDataURL(file);
  });
}

function inferMimeType(fileName) {
  return String(fileName || '').toLowerCase().endsWith('.png') ? 'image/png' : 'application/json';
}

function humanizeApiError(error) {
  if (error.code === 'NO_ACTIVE_PROVIDER') return '未配置可用 Provider';
  if (error.code === 'PROVIDER_ERROR') return 'Provider 调用失败';
  if (error.code === 'UNSUPPORTED_MEDIA_TYPE') return '请求格式错误';
  return error.message;
}

function setStatus(element, text, tone) {
  element.textContent = text;
  element.classList.remove('is-error', 'is-ok', 'is-busy');
  if (tone === 'error') element.classList.add('is-error');
  if (tone === 'ok') element.classList.add('is-ok');
  if (tone === 'busy') element.classList.add('is-busy');
}

function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function normalizedNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}
