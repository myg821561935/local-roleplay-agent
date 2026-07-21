const EMPTY_LEDGER = {
  spec: 'lra.authoring-ledger/v1',
  scene: {
    title: '',
    objective: '',
    pov: '',
    location: '',
    time: '',
    tone: '',
    mustReveal: [],
    mustHide: [],
    forbidden: [],
    endingHook: ''
  },
  promises: [],
  decisions: [],
  updatedAt: ''
};

export function createAuthoringController({ state, els, apiRequest, setStatus, getSessionId } = {}) {
  let profiles = [];
  let draft = null;
  let loadedSessionId = '';
  let sourceStamp = '';
  let activeProfileId = 'story-director';

  function ensureDraft() {
    const sessionId = String(state.session?.id || getSessionId?.() || 'main');
    const source = state.session?.authoring || EMPTY_LEDGER;
    const stamp = JSON.stringify(source);
    if (!draft || sessionId !== loadedSessionId || stamp !== sourceStamp) {
      draft = cloneLedger(source);
      loadedSessionId = sessionId;
      sourceStamp = stamp;
      activeProfileId = String(state.session?.settings?.activeAgentProfileId || 'story-director');
    }
    return draft;
  }

  async function loadProfiles() {
    try {
      const payload = await apiRequest('/api/agent-profiles');
      profiles = Array.isArray(payload.profiles) ? payload.profiles : [];
      renderProfileOptions();
    } catch (error) {
      setStatus(els.authoringStatus, `职责加载失败：${error.message || error}`, 'error');
    }
  }

  function render() {
    const ledger = ensureDraft();
    renderProfileOptions();
    setInputValue(els.authoringSceneTitle, ledger.scene.title);
    setInputValue(els.authoringSceneObjective, ledger.scene.objective);
    setInputValue(els.authoringScenePov, ledger.scene.pov);
    setInputValue(els.authoringSceneLocation, ledger.scene.location);
    setInputValue(els.authoringSceneTime, ledger.scene.time);
    setInputValue(els.authoringSceneTone, ledger.scene.tone);
    setInputValue(els.authoringMustReveal, ledger.scene.mustReveal.join('\n'));
    setInputValue(els.authoringMustHide, ledger.scene.mustHide.join('\n'));
    setInputValue(els.authoringForbidden, ledger.scene.forbidden.join('\n'));
    setInputValue(els.authoringEndingHook, ledger.scene.endingHook);
    renderPromiseRows(ledger.promises);
    renderDecisionRows(ledger.decisions);
    renderSummary();
  }

  function bindEvents() {
    const sceneBindings = [
      [els.authoringSceneTitle, 'title'],
      [els.authoringSceneObjective, 'objective'],
      [els.authoringScenePov, 'pov'],
      [els.authoringSceneLocation, 'location'],
      [els.authoringSceneTime, 'time'],
      [els.authoringSceneTone, 'tone'],
      [els.authoringMustReveal, 'mustReveal', true],
      [els.authoringMustHide, 'mustHide', true],
      [els.authoringForbidden, 'forbidden', true],
      [els.authoringEndingHook, 'endingHook']
    ];
    sceneBindings.forEach(([input, key, list]) => input?.addEventListener('input', () => {
      ensureDraft().scene[key] = list ? splitLines(input.value) : input.value;
      renderSummary();
    }));
    els.authoringAgentProfile?.addEventListener('change', () => {
      activeProfileId = els.authoringAgentProfile.value;
    });
    els.addAuthoringPromise?.addEventListener('click', () => {
      ensureDraft().promises.push({
        id: `promise-${Date.now()}`,
        title: '', status: 'open', importance: 'major', target: '', note: '', introducedAt: '', lastAdvancedAt: ''
      });
      renderPromiseRows(draft.promises);
      renderSummary();
    });
    els.addAuthoringDecision?.addEventListener('click', () => {
      ensureDraft().decisions.push({
        id: `decision-${Date.now()}`,
        title: '', decision: '', motivation: '', risk: '', status: 'active', createdAt: ''
      });
      renderDecisionRows(draft.decisions);
      renderSummary();
    });
    els.authoringPromises?.addEventListener('input', updateCollectionDraft);
    els.authoringPromises?.addEventListener('change', updateCollectionDraft);
    els.authoringPromises?.addEventListener('click', removeCollectionItem);
    els.authoringDecisions?.addEventListener('input', updateCollectionDraft);
    els.authoringDecisions?.addEventListener('change', updateCollectionDraft);
    els.authoringDecisions?.addEventListener('click', removeCollectionItem);
    els.saveAuthoring?.addEventListener('click', save);
  }

  async function save() {
    const ledger = ensureDraft();
    setStatus(els.authoringStatus, '正在保存创作约束...', 'busy');
    try {
      const payload = await apiRequest(`/api/sessions/${encodeURIComponent(getSessionId?.() || 'main')}/authoring`, {
        method: 'PUT',
        body: { ledger, agentProfileId: activeProfileId }
      });
      state.session = payload.session || state.session;
      draft = cloneLedger(payload.ledger || ledger);
      loadedSessionId = String(state.session?.id || getSessionId?.() || 'main');
      sourceStamp = JSON.stringify(draft);
      activeProfileId = payload.agentProfileId || activeProfileId;
      render();
      setStatus(els.authoringStatus, '已保存，后续生成将遵循此账本', 'ok');
    } catch (error) {
      setStatus(els.authoringStatus, `保存失败：${error.message || error}`, 'error');
    }
  }

  function renderProfileOptions() {
    const select = els.authoringAgentProfile;
    if (!select) return;
    const current = activeProfileId || 'story-director';
    select.replaceChildren(...profiles.map((profile) => {
      const option = document.createElement('option');
      option.value = profile.id;
      option.textContent = `${profile.label} · ${profile.description}`;
      return option;
    }));
    if (!select.options.length) {
      const option = document.createElement('option');
      option.value = 'story-director';
      option.textContent = '叙事导演';
      select.append(option);
    }
    select.value = Array.from(select.options).some((option) => option.value === current) ? current : select.options[0].value;
  }

  function renderPromiseRows(promises) {
    if (!els.authoringPromises) return;
    els.authoringPromises.replaceChildren(...promises.map((item, index) => createLedgerItem({
      collection: 'promises',
      index,
      title: item.title || `叙事承诺 ${index + 1}`,
      fields: [
        field('title', '承诺', item.title, 'text', '例如：三章内揭示断魂灯来历'),
        field('status', '状态', item.status, 'select', '', [['open', '待推进'], ['advanced', '已推进'], ['fulfilled', '已兑现'], ['abandoned', '已放弃']]),
        field('importance', '重要度', item.importance, 'select', '', [['minor', '次要'], ['major', '重要'], ['core', '核心']]),
        field('target', '预期节点', item.target, 'text', '章节、场景或条件'),
        field('note', '说明', item.note, 'textarea', '承诺的边界和兑现方式')
      ]
    })));
    toggleEmpty(els.authoringPromises, promises.length, '暂无叙事承诺。用它记录伏笔、约定和必须回应的线索。');
  }

  function renderDecisionRows(decisions) {
    if (!els.authoringDecisions) return;
    els.authoringDecisions.replaceChildren(...decisions.map((item, index) => createLedgerItem({
      collection: 'decisions',
      index,
      title: item.title || `创作决策 ${index + 1}`,
      fields: [
        field('title', '决策名', item.title, 'text', '例如：幕后黑手暂不登场'),
        field('status', '状态', item.status, 'select', '', [['active', '生效'], ['superseded', '已替代'], ['reversed', '已撤销']]),
        field('decision', '决定', item.decision, 'textarea', '已经确定、不可被模型静默推翻的方向'),
        field('motivation', '理由', item.motivation, 'textarea', '为何这样写'),
        field('risk', '风险', item.risk, 'textarea', '需要防止的副作用')
      ]
    })));
    toggleEmpty(els.authoringDecisions, decisions.length, '暂无创作决策。重要方向确定后记录在这里。');
  }

  function updateCollectionDraft(event) {
    const input = event.target.closest('[data-authoring-field]');
    const row = event.target.closest('[data-authoring-collection][data-authoring-index]');
    if (!input || !row) return;
    const collection = ensureDraft()[row.dataset.authoringCollection];
    const item = collection?.[Number(row.dataset.authoringIndex)];
    if (item) item[input.dataset.authoringField] = input.value;
  }

  function removeCollectionItem(event) {
    const button = event.target.closest('[data-remove-authoring-item]');
    const row = event.target.closest('[data-authoring-collection][data-authoring-index]');
    if (!button || !row) return;
    const collectionName = row.dataset.authoringCollection;
    ensureDraft()[collectionName].splice(Number(row.dataset.authoringIndex), 1);
    if (collectionName === 'promises') renderPromiseRows(draft.promises);
    else renderDecisionRows(draft.decisions);
    renderSummary();
  }

  function renderSummary() {
    if (!els.authoringSummary) return;
    const ledger = ensureDraft();
    const openPromises = ledger.promises.filter((item) => ['open', 'advanced'].includes(item.status)).length;
    const activeDecisions = ledger.decisions.filter((item) => item.status === 'active').length;
    const hiddenFacts = ledger.scene.mustHide.length;
    els.authoringSummary.textContent = `${ledger.scene.title || '未命名场景'} · ${openPromises} 项待续承诺 · ${activeDecisions} 项有效决策 · ${hiddenFacts} 项隐藏信息`;
  }

  return { bindEvents, loadProfiles, render, save };
}

function createLedgerItem({ collection, index, title, fields }) {
  const article = document.createElement('article');
  article.className = 'authoring-ledger-item';
  article.dataset.authoringCollection = collection;
  article.dataset.authoringIndex = String(index);
  const heading = document.createElement('header');
  const strong = document.createElement('strong');
  strong.textContent = title;
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'icon-button subtle';
  remove.dataset.removeAuthoringItem = 'true';
  remove.title = '删除记录';
  remove.setAttribute('aria-label', '删除记录');
  remove.textContent = '×';
  heading.append(strong, remove);
  const grid = document.createElement('div');
  grid.className = 'authoring-ledger-fields';
  fields.forEach((descriptor) => grid.append(createField(descriptor)));
  article.append(heading, grid);
  return article;
}

function createField(descriptor) {
  const label = document.createElement('label');
  label.className = descriptor.type === 'textarea' ? 'authoring-field is-wide' : 'authoring-field';
  const span = document.createElement('span');
  span.textContent = descriptor.label;
  let input;
  if (descriptor.type === 'textarea') {
    input = document.createElement('textarea');
    input.rows = 2;
  } else if (descriptor.type === 'select') {
    input = document.createElement('select');
    descriptor.options.forEach(([value, text]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      input.append(option);
    });
  } else {
    input = document.createElement('input');
    input.type = 'text';
  }
  input.className = 'form-input';
  input.dataset.authoringField = descriptor.key;
  input.value = descriptor.value || '';
  input.placeholder = descriptor.placeholder || '';
  label.append(span, input);
  return label;
}

function field(key, label, value, type, placeholder = '', options = []) {
  return { key, label, value, type, placeholder, options };
}

function toggleEmpty(container, count, message) {
  if (count) return;
  const empty = document.createElement('p');
  empty.className = 'authoring-empty';
  empty.textContent = message;
  container.append(empty);
}

function cloneLedger(source) {
  const ledger = structuredClone(source && typeof source === 'object' ? source : EMPTY_LEDGER);
  ledger.scene = { ...structuredClone(EMPTY_LEDGER.scene), ...(ledger.scene || {}) };
  ledger.scene.mustReveal = asList(ledger.scene.mustReveal);
  ledger.scene.mustHide = asList(ledger.scene.mustHide);
  ledger.scene.forbidden = asList(ledger.scene.forbidden);
  ledger.promises = Array.isArray(ledger.promises) ? ledger.promises : [];
  ledger.decisions = Array.isArray(ledger.decisions) ? ledger.decisions : [];
  return ledger;
}

function asList(value) {
  return Array.isArray(value) ? value.map(String) : splitLines(value);
}

function splitLines(value) {
  return String(value || '').split(/[\n,，;；]+/).map((item) => item.trim()).filter(Boolean);
}

function setInputValue(input, value) {
  if (input && document.activeElement !== input) input.value = value || '';
}
