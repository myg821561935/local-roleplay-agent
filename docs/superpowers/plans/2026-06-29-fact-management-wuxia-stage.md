# Fact Management Wuxia Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reviewable Fact Management surface for auto-extracted memory and upgrade the chat workspace into a wuxia-themed immersive main stage.

**Architecture:** Add a focused `factCards` helper module for normalization and world-book promotion, expose small memory fact APIs from the existing Node server, and keep the browser app framework-free by extending current DOM rendering. The prompt path continues to use `memoryCards` through `retrieveCards`, with `enabled:false` cards excluded from injection.

**Tech Stack:** Node.js ESM, native `node:test`, static HTML/CSS/JS, local JSON storage through `JsonStore`, no frontend build step.

---

## File Structure

- Create: `server/agent/factCards.js`
  - Owns fact-card normalization, old-memory compatibility, and conversion from fact card to world-book entry.
- Modify: `server/agent/factExtractor.js`
  - Normalizes extracted `memoryCards` before merging them into session memory.
- Modify: `server/agent/promptAssembler.js`
  - Normalizes memory cards before passing them into `retrieveCards`.
- Modify: `server/app.js`
  - Adds `PUT /api/memory/facts` and `POST /api/memory/facts/:factId/promote`.
- Modify: `public/index.html`
  - Adds a theme selector and a `事实` inspector tab.
- Modify: `public/app.js`
  - Renders fact cards, handles edit/save/delete/enable/promote, persists theme selection.
- Modify: `public/styles.css`
  - Adds fact-card styles, `wuxia-scroll` theme variables, main-stage background, and floating input treatment.
- Test: `tests/factCards.test.js`
  - Unit tests for normalization and world-book promotion.
- Modify Test: `tests/httpApi.test.js`
  - API tests for fact save and promote.
- Modify Test: `tests/promptAssembler.test.js`
  - Ensures disabled memory facts are not injected and old loose cards are still compatible.

## Task 1: Fact Card Normalization

**Files:**
- Create: `server/agent/factCards.js`
- Modify: `server/agent/factExtractor.js`
- Modify: `server/agent/promptAssembler.js`
- Create: `tests/factCards.test.js`
- Modify: `tests/promptAssembler.test.js`

- [ ] **Step 1: Write failing fact card unit tests**

Create `tests/factCards.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldBookEntryFromFact, normalizeFactCards } from '../server/agent/factCards.js';

test('normalizeFactCards preserves useful fields and fills management metadata', () => {
  const facts = normalizeFactCards([{
    title: '沈观澜获得名刀',
    content: '沈观澜获得名刀雪照。',
    keywords: ['沈观澜', '雪照'],
    type: 'item',
    extensions: { confidence: 'medium' }
  }], { now: '2026-06-29T00:00:00.000Z' });

  assert.equal(facts.length, 1);
  assert.match(facts[0].id, /^fact-/);
  assert.equal(facts[0].title, '沈观澜获得名刀');
  assert.equal(facts[0].content, '沈观澜获得名刀雪照。');
  assert.deepEqual(facts[0].keywords, ['沈观澜', '雪照']);
  assert.equal(facts[0].type, 'item');
  assert.equal(facts[0].enabled, true);
  assert.equal(facts[0].source, 'auto-extracted');
  assert.equal(facts[0].createdAt, '2026-06-29T00:00:00.000Z');
  assert.equal(facts[0].updatedAt, '2026-06-29T00:00:00.000Z');
  assert.deepEqual(facts[0].extensions, { confidence: 'medium' });
});

test('normalizeFactCards accepts legacy strings and skips empty facts', () => {
  const facts = normalizeFactCards(['镇武司旧案仍未查清。', { content: '   ' }], {
    now: '2026-06-29T00:00:00.000Z'
  });

  assert.equal(facts.length, 1);
  assert.equal(facts[0].title, '镇武司旧案仍未查清。');
  assert.equal(facts[0].content, '镇武司旧案仍未查清。');
  assert.deepEqual(facts[0].keywords, []);
});

test('createWorldBookEntryFromFact maps review facts into dynamic lore entries', () => {
  const entry = createWorldBookEntryFromFact({
    id: 'fact-sword',
    title: '名刀雪照',
    content: '沈观澜持有名刀雪照。',
    keywords: ['雪照'],
    type: 'item',
    enabled: true,
    extensions: { originTurnId: 'assistant-1' }
  }, { now: '2026-06-29T00:00:00.000Z' });

  assert.equal(entry.id, 'worldbook-fact-sword');
  assert.equal(entry.type, 'dynamic-memory');
  assert.equal(entry.title, '名刀雪照');
  assert.deepEqual(entry.keywords, ['雪照']);
  assert.equal(entry.content, '沈观澜持有名刀雪照。');
  assert.equal(entry.priority, 80);
  assert.equal(entry.depth, 6);
  assert.equal(entry.enabled, true);
  assert.equal(entry.source, 'fact-management');
  assert.equal(entry.updatedAt, '2026-06-29T00:00:00.000Z');
  assert.equal(entry.extensions.sourceFactId, 'fact-sword');
});
```

- [ ] **Step 2: Add failing prompt assembler regression test**

Append to `tests/promptAssembler.test.js` before `cardFixture`:

```js
test('assemblePrompt injects enabled normalized memory facts and ignores disabled facts', () => {
  const result = assemblePrompt({
    promptModules: [],
    characterCard: { name: '沈观澜', enabled: true },
    worldBook: [],
    memory: {
      worldState: {},
      memoryCards: [
        {
          id: 'fact-enabled',
          title: '名刀雪照',
          keywords: ['雪照'],
          content: '沈观澜持有名刀雪照。',
          enabled: true
        },
        {
          id: 'fact-disabled',
          title: '错误事实',
          keywords: ['雪照'],
          content: '这条禁用事实不应出现。',
          enabled: false
        },
        '雪照曾在镇武司旧案中出现。'
      ]
    },
    messages: [],
    userMessage: '我查看雪照刀身。',
    options: { maxInjectedCards: 5 }
  });

  assert.match(result.messages[0].content, /沈观澜持有名刀雪照。/);
  assert.match(result.messages[0].content, /雪照曾在镇武司旧案中出现。/);
  assert.doesNotMatch(result.messages[0].content, /这条禁用事实不应出现。/);
  assert.deepEqual(result.sections.injectedCardIds, ['fact-enabled']);
});
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
npm test -- tests/factCards.test.js tests/promptAssembler.test.js
```

Expected: FAIL because `server/agent/factCards.js` does not exist and string memory cards are not normalized for prompt injection.

- [ ] **Step 4: Implement factCards helper**

Create `server/agent/factCards.js`:

```js
const FACT_TYPES = new Set(['character', 'location', 'item', 'quest', 'relationship', 'event', 'flag', 'uncategorized']);

export function normalizeFactCards(value, { now = new Date().toISOString() } = {}) {
  if (!Array.isArray(value)) return [];
  return value
    .map((fact, index) => normalizeFactCard(fact, { index, now }))
    .filter(Boolean);
}

export function normalizeFactCard(value, { index = 0, now = new Date().toISOString() } = {}) {
  const object = typeof value === 'string' ? { content: value } : value;
  if (!isPlainObject(object)) return null;

  const content = stringValue(object.content);
  if (!content) return null;
  const id = stringValue(object.id) || createFactId(content, index);
  const createdAt = stringValue(object.createdAt) || now;

  return {
    id,
    title: stringValue(object.title) || content.slice(0, 40),
    content,
    type: normalizeType(object.type),
    keywords: normalizeStringArray(object.keywords),
    enabled: object.enabled !== false,
    source: stringValue(object.source) || 'auto-extracted',
    createdAt,
    updatedAt: stringValue(object.updatedAt) || now,
    extensions: isPlainObject(object.extensions) ? object.extensions : {}
  };
}

export function createWorldBookEntryFromFact(fact, { now = new Date().toISOString() } = {}) {
  const normalized = normalizeFactCard(fact, { now });
  if (!normalized) return null;
  return {
    id: `worldbook-${normalized.id}`,
    type: 'dynamic-memory',
    title: normalized.title,
    keywords: normalized.keywords,
    secondaryKeywords: [],
    matchMode: 'keyword',
    regex: [],
    logic: 'any',
    content: normalized.content,
    priority: 80,
    depth: 6,
    insertionOrder: 0,
    constant: false,
    caseSensitive: false,
    position: 'after_character',
    scope: 'prompt',
    enabled: true,
    source: 'fact-management',
    extensions: {
      ...normalized.extensions,
      sourceFactId: normalized.id,
      sourceFactType: normalized.type
    },
    updatedAt: now
  };
}

export function worldBookIdentity(entry) {
  return `${stringValue(entry?.title)}\n${stringValue(entry?.content)}`;
}

function createFactId(content, index) {
  const compact = Buffer.from(`${index}:${content}`).toString('base64url').slice(0, 18);
  return `fact-${compact}`;
}

function normalizeType(type) {
  const value = stringValue(type) || 'uncategorized';
  return FACT_TYPES.has(value) ? value : 'uncategorized';
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => stringValue(item)).filter(Boolean);
}

function stringValue(value) {
  return String(value ?? '').trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
```

- [ ] **Step 5: Normalize extracted facts**

Modify `server/agent/factExtractor.js` imports and `applyFactExtractionResult` memoryCards block:

```js
import { createDefaultMemory } from './memoryUpdater.js';
import { normalizeFactCards } from './factCards.js';
```

```js
if (Array.isArray(payload.memoryCards)) {
  const existingCards = normalizeFactCards(next.memoryCards);
  const incomingCards = normalizeFactCards(payload.memoryCards);
  next.memoryCards = mergeFactCards(existingCards, incomingCards);
}
```

Add below `mergeArrays`:

```js
function mergeFactCards(current, incoming) {
  const seen = new Set(current.map((card) => `${card.title}\n${card.content}`));
  const merged = [...current];
  incoming.forEach((card) => {
    const key = `${card.title}\n${card.content}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(card);
    }
  });
  return merged;
}
```

- [ ] **Step 6: Normalize memory cards for prompt injection**

Modify `server/agent/promptAssembler.js` imports and memoryCards assignment:

```js
import { estimateTokens } from './token.js';
import { normalizeFactCards } from './factCards.js';
import { retrieveCards } from './memoryRetriever.js';
```

```js
const memoryCards = normalizeFactCards(Array.isArray(memory?.memoryCards) ? memory.memoryCards : []);
```

- [ ] **Step 7: Run focused tests and commit**

Run:

```bash
npm test -- tests/factCards.test.js tests/promptAssembler.test.js
```

Expected: PASS.

Commit:

```bash
git add server/agent/factCards.js server/agent/factExtractor.js server/agent/promptAssembler.js tests/factCards.test.js tests/promptAssembler.test.js
git commit -m "feat: normalize memory fact cards"
```

## Task 2: Memory Fact HTTP API

**Files:**
- Modify: `server/app.js`
- Modify: `tests/httpApi.test.js`

- [ ] **Step 1: Write failing API tests**

Append before `test('static / returns the HTML page'...)` in `tests/httpApi.test.js`:

```js
test('PUT /api/memory/facts saves normalized memory facts', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'PUT',
    url: '/api/memory/facts',
    headers: { 'content-type': 'application/json' },
    body: {
      sessionId: 'main',
      facts: [{
        title: '名刀雪照',
        content: '沈观澜持有名刀雪照。',
        keywords: ['雪照'],
        type: 'item',
        enabled: false
      }]
    }
  });
  const payload = response.json();
  const state = (await request(app, { url: '/api/state' })).json();

  assert.equal(response.status, 200);
  assert.equal(payload.facts.length, 1);
  assert.equal(payload.facts[0].title, '名刀雪照');
  assert.equal(payload.facts[0].enabled, false);
  assert.equal(state.session.memory.memoryCards[0].content, '沈观澜持有名刀雪照。');
});

test('PUT /api/memory/facts rejects non-array facts', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'PUT',
    url: '/api/memory/facts',
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'main', facts: { content: 'not-array' } }
  });

  assert.equal(response.status, 400);
  assert.deepEqual(response.json(), { error: 'INVALID_MEMORY_FACTS' });
});

test('POST /api/memory/facts/:factId/promote creates one world book entry', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  await request(app, {
    method: 'PUT',
    url: '/api/memory/facts',
    headers: { 'content-type': 'application/json' },
    body: {
      sessionId: 'main',
      facts: [{ id: 'fact-sword', title: '名刀雪照', content: '沈观澜持有名刀雪照。', keywords: ['雪照'] }]
    }
  });

  const first = await request(app, {
    method: 'POST',
    url: '/api/memory/facts/fact-sword/promote',
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'main' }
  });
  const second = await request(app, {
    method: 'POST',
    url: '/api/memory/facts/fact-sword/promote',
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'main' }
  });
  const worldBook = second.json().worldBook.filter((entry) => entry.source === 'fact-management');

  assert.equal(first.status, 200);
  assert.equal(worldBook.length, 1);
  assert.equal(worldBook[0].title, '名刀雪照');
  assert.equal(worldBook[0].extensions.sourceFactId, 'fact-sword');
});

test('POST /api/memory/facts/:factId/promote rejects missing fact', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'POST',
    url: '/api/memory/facts/missing/promote',
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'main' }
  });

  assert.equal(response.status, 404);
  assert.deepEqual(response.json(), { error: 'MEMORY_FACT_NOT_FOUND' });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- tests/httpApi.test.js
```

Expected: FAIL with `NOT_FOUND` for the new memory fact routes.

- [ ] **Step 3: Add imports and routes**

Modify the imports in `server/app.js`:

```js
import { createWorldBookEntryFromFact, normalizeFactCards, worldBookIdentity } from './agent/factCards.js';
```

Add to `handleApi` after `/api/world-book` and before `/api/character-card`:

```js
if (req.method === 'PUT' && url.pathname === '/api/memory/facts') {
  validateMutatingRequest(req);
  const body = await readRequestJson(req);
  const result = await saveMemoryFacts({ sessionService, body });
  writeJson(res, 200, result);
  return;
}

const memoryFactPromoteRoute = matchMemoryFactPromoteRoute(url.pathname);
if (memoryFactPromoteRoute && req.method === 'POST') {
  validateMutatingRequest(req);
  const body = await readRequestJson(req);
  const result = await promoteMemoryFact({
    configService,
    sessionService,
    body,
    factId: memoryFactPromoteRoute.factId
  });
  writeJson(res, 200, result);
  return;
}
```

- [ ] **Step 4: Add route helpers**

Add below `matchMessageRoute` or near the other route helpers in `server/app.js`:

```js
function matchMemoryFactPromoteRoute(pathname) {
  const match = pathname.match(/^\/api\/memory\/facts\/([^/]+)\/promote$/);
  if (!match) return null;
  return { factId: decodeURIComponent(match[1]) };
}
```

Add near `sendChat` helpers:

```js
async function saveMemoryFacts({ sessionService, body }) {
  const factsPayload = body.facts ?? [];
  if (!Array.isArray(factsPayload)) throw new ApiError(400, 'INVALID_MEMORY_FACTS');
  const session = await sessionService.getSession(body.sessionId || 'main');
  const facts = normalizeFactCards(factsPayload);
  session.memory = {
    ...session.memory,
    memoryCards: facts
  };
  session.updatedAt = new Date().toISOString();
  await sessionService.saveSession(session);
  return { facts, session };
}

async function promoteMemoryFact({ configService, sessionService, body, factId }) {
  const session = await sessionService.getSession(body.sessionId || 'main');
  const facts = normalizeFactCards(session.memory?.memoryCards || []);
  const fact = facts.find((item) => item.id === factId);
  if (!fact) throw new ApiError(404, 'MEMORY_FACT_NOT_FOUND');

  const nextEntry = createWorldBookEntryFromFact(fact);
  const config = await configService.getAll();
  const existingWorldBook = Array.isArray(config.worldBook) ? config.worldBook : [];
  const existingKeys = new Set(existingWorldBook.map(worldBookIdentity));
  const nextWorldBook = existingKeys.has(worldBookIdentity(nextEntry))
    ? existingWorldBook
    : await configService.saveWorldBook([...existingWorldBook, nextEntry]);

  return { fact, worldBook: nextWorldBook };
}
```

- [ ] **Step 5: Run API tests and commit**

Run:

```bash
npm test -- tests/httpApi.test.js tests/factCards.test.js
```

Expected: PASS.

Commit:

```bash
git add server/app.js tests/httpApi.test.js
git commit -m "feat: add memory fact management api"
```

## Task 3: Fact Management UI

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`

- [ ] **Step 1: Add fact tab markup**

Modify the inspector tabs in `public/index.html` so the first five buttons are:

```html
<button class="tab-button active" type="button" data-tab="memory" role="tab" aria-selected="true">记忆</button>
<button class="tab-button" type="button" data-tab="facts" role="tab" aria-selected="false">事实</button>
<button class="tab-button" type="button" data-tab="worldbook" role="tab" aria-selected="false">世界书</button>
<button class="tab-button" type="button" data-tab="character" role="tab" aria-selected="false">角色卡</button>
<button class="tab-button" type="button" data-tab="prompt" role="tab" aria-selected="false">Prompt</button>
```

Insert this pane after the memory pane:

```html
<section class="tab-pane" data-pane="facts" role="tabpanel" hidden>
  <div id="fact-list" class="fact-list"></div>
  <div class="editor-actions">
    <span id="fact-status" class="status-text"></span>
    <button id="add-fact" class="ghost-button compact" type="button">新增事实</button>
    <button id="save-facts" class="primary-button compact" type="button">保存事实</button>
  </div>
</section>
```

- [ ] **Step 2: Wire DOM references and events**

Modify `public/app.js` `els`:

```js
factList: document.querySelector('#fact-list'),
factStatus: document.querySelector('#fact-status'),
addFact: document.querySelector('#add-fact'),
saveFacts: document.querySelector('#save-facts'),
```

Add to `bindEvents()`:

```js
els.addFact.addEventListener('click', () => addFactCard());
els.saveFacts.addEventListener('click', () => saveFacts());
els.factList.addEventListener('click', (event) => {
  const deleteButton = event.target.closest('[data-delete-fact]');
  if (deleteButton) {
    deleteFactCard(deleteButton.dataset.deleteFact);
    return;
  }
  const promoteButton = event.target.closest('[data-promote-fact]');
  if (promoteButton) promoteFact(promoteButton.dataset.promoteFact);
});
```

- [ ] **Step 3: Render fact cards**

Add below `renderInspector()` in `public/app.js`:

```js
function renderInspector() {
  els.memoryView.textContent = prettyJson(state.session?.memory || {});
  els.worldbookEditor.value = prettyJson(state.config.worldBook || []);
  els.characterCardEditor.value = prettyJson(state.config.characterCard || createCharacterCardTemplate());
  els.promptEditor.value = prettyJson(state.config.promptModules || []);
  renderFacts();
}

function renderFacts() {
  const facts = getMemoryFacts();
  els.factList.innerHTML = '';
  if (!facts.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state compact-empty';
    empty.textContent = '暂无事实卡片。';
    els.factList.append(empty);
    setStatus(els.factStatus, '0 条事实', '');
    return;
  }

  const fragment = document.createDocumentFragment();
  facts.forEach((fact, index) => fragment.append(createFactNode(fact, index)));
  els.factList.append(fragment);
  setStatus(els.factStatus, `${facts.length} 条事实`, '');
}

function createFactNode(fact, index) {
  const article = document.createElement('article');
  article.className = 'fact-card';
  article.dataset.factId = fact.id;
  article.innerHTML = `
    <div class="fact-card-topline">
      <input class="fact-title" value="${escapeAttribute(fact.title)}" aria-label="事实标题 ${index + 1}">
      <label class="fact-enabled"><input class="fact-enabled-input" type="checkbox" ${fact.enabled === false ? '' : 'checked'}>启用</label>
    </div>
    <textarea class="fact-content" rows="3" aria-label="事实内容 ${index + 1}">${escapeHtml(fact.content)}</textarea>
    <div class="fact-grid">
      <label><span>类型</span><input class="fact-type" value="${escapeAttribute(fact.type || 'uncategorized')}"></label>
      <label><span>关键词</span><input class="fact-keywords" value="${escapeAttribute((fact.keywords || []).join('、'))}"></label>
      <label><span>来源</span><input class="fact-source" value="${escapeAttribute(fact.source || 'manual')}"></label>
    </div>
    <div class="fact-card-actions">
      <span class="status-text">${escapeHtml(formatTime(fact.updatedAt))}</span>
      <button class="ghost-button compact" type="button" data-promote-fact="${escapeAttribute(fact.id)}">提升世界书</button>
      <button class="tool-button danger-button" type="button" data-delete-fact="${escapeAttribute(fact.id)}">删除</button>
    </div>
  `;
  return article;
}
```

- [ ] **Step 4: Add fact UI actions**

Add below the fact render helpers:

```js
function getMemoryFacts() {
  return Array.isArray(state.session?.memory?.memoryCards) ? state.session.memory.memoryCards : [];
}

function addFactCard() {
  const facts = getMemoryFacts();
  facts.push(createFactTemplate());
  state.session.memory = { ...(state.session.memory || {}), memoryCards: facts };
  renderFacts();
  setStatus(els.factStatus, '已新增事实，编辑后保存', 'ok');
}

function deleteFactCard(factId) {
  const facts = getMemoryFacts().filter((fact) => fact.id !== factId);
  state.session.memory = { ...(state.session.memory || {}), memoryCards: facts };
  renderFacts();
  setStatus(els.factStatus, '已删除事实，保存后生效', 'ok');
}

async function saveFacts() {
  setStatus(els.factStatus, '正在保存...', 'busy');
  els.saveFacts.disabled = true;
  try {
    const facts = collectFactsFromDom();
    const payload = await apiRequest('/api/memory/facts', {
      method: 'PUT',
      body: { sessionId: state.session?.id || 'main', facts }
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
  return Array.from(els.factList.querySelectorAll('.fact-card')).map((card) => ({
    id: card.dataset.factId,
    title: card.querySelector('.fact-title').value,
    content: card.querySelector('.fact-content').value,
    type: card.querySelector('.fact-type').value,
    keywords: splitKeywords(card.querySelector('.fact-keywords').value),
    source: card.querySelector('.fact-source').value,
    enabled: card.querySelector('.fact-enabled-input').checked
  }));
}

function createFactTemplate() {
  return {
    id: `fact-manual-${Date.now()}`,
    title: '新事实',
    content: '这里写稳定事实。',
    type: 'uncategorized',
    keywords: [],
    enabled: true,
    source: 'manual',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    extensions: {}
  };
}

function splitKeywords(value) {
  return String(value || '').split(/[、,，\n]/).map((item) => item.trim()).filter(Boolean);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/"/g, '&quot;');
}
```

- [ ] **Step 5: Add fact styles**

Add to `public/styles.css` near inspector styles:

```css
.tabs {
  grid-template-columns: repeat(5, minmax(0, 1fr));
}

.fact-list {
  display: grid;
  gap: 10px;
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 10px;
  background: var(--panel-deep);
}

.fact-card {
  display: grid;
  gap: 9px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: rgba(32, 36, 39, 0.92);
  padding: 10px;
}

.fact-card-topline,
.fact-card-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.fact-title {
  font-weight: 740;
}

.fact-enabled {
  display: flex;
  grid-template-columns: none;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.fact-enabled input {
  width: 14px;
  height: 14px;
}

.fact-grid {
  display: grid;
  grid-template-columns: 0.7fr 1.3fr 1fr;
  gap: 8px;
}

.danger-button {
  border-color: rgba(209, 121, 103, 0.45);
  color: #e4a296;
}

.compact-empty {
  align-self: center;
}
```

- [ ] **Step 6: Run syntax checks and commit**

Run:

```bash
node --check public/app.js
node --check public/markdown.js
```

Expected: both commands exit 0.

Commit:

```bash
git add public/index.html public/app.js public/styles.css
git commit -m "feat: add fact management UI"
```

## Task 4: Wuxia Theme and Floating Main Stage

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`

- [ ] **Step 1: Add theme selector markup**

Modify `public/index.html` topbar after the status block and before refresh button:

```html
<label class="theme-switcher">
  <span>主题</span>
  <select id="theme-select" aria-label="主题">
    <option value="default-dark">极简暗黑</option>
    <option value="wuxia-scroll">武侠卷轴</option>
  </select>
</label>
```

- [ ] **Step 2: Persist theme in frontend JS**

Modify `public/app.js` `els`:

```js
themeSelect: document.querySelector('#theme-select'),
```

Modify `DOMContentLoaded` handler:

```js
document.addEventListener('DOMContentLoaded', () => {
  applyTheme(loadTheme());
  bindEvents();
  loadState();
});
```

Add to `bindEvents()`:

```js
els.themeSelect.addEventListener('change', () => {
  applyTheme(els.themeSelect.value);
});
```

Add near utility functions:

```js
function loadTheme() {
  return localStorage.getItem('local-roleplay-agent-theme') || 'wuxia-scroll';
}

function applyTheme(theme) {
  const value = theme === 'default-dark' ? 'default-dark' : 'wuxia-scroll';
  document.documentElement.dataset.theme = value;
  localStorage.setItem('local-roleplay-agent-theme', value);
  if (els.themeSelect) els.themeSelect.value = value;
}
```

- [ ] **Step 3: Add scene action bar markup**

Modify `public/index.html` inside `section.chat-panel`, between `#messages` and `#chat-form`:

```html
<div class="stage-actions" aria-label="场景操作">
  <button class="tool-button" type="button" data-tab-shortcut="character">角色设定</button>
  <button class="tool-button" type="button" data-action-template="请修复上一轮回复的格式，保持剧情不倒退。">修复格式</button>
  <button class="tool-button" type="button" data-scroll-bottom>回到底部</button>
</div>
```

Add DOM/events in `public/app.js`:

```js
stageActions: document.querySelector('.stage-actions'),
```

```js
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
```

- [ ] **Step 4: Add wuxia theme CSS variables**

Add after `:root` in `public/styles.css`:

```css
:root[data-theme="wuxia-scroll"] {
  --bg: #100d0a;
  --panel: rgba(25, 21, 17, 0.9);
  --panel-raised: rgba(43, 34, 24, 0.92);
  --panel-deep: #100f0d;
  --line: rgba(222, 181, 100, 0.28);
  --text: #f3ead8;
  --muted: #c5b89f;
  --subtle: #9d8d75;
  --gold: #e2b45f;
  --gold-deep: #8d5f22;
  --teal: #78b8ad;
  --blue: #8aa9c0;
}
```

Add topbar theme selector styles:

```css
.theme-switcher {
  display: flex;
  grid-template-columns: none;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.theme-switcher select {
  height: 34px;
  min-width: 118px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #111315;
  color: var(--text);
  padding: 0 8px;
}
```

- [ ] **Step 5: Add main-stage background and floating input CSS**

Add near chat styles:

```css
.chat-panel {
  position: relative;
}

:root[data-theme="wuxia-scroll"] .chat-panel {
  background:
    linear-gradient(180deg, rgba(18, 12, 8, 0.18), rgba(10, 8, 6, 0.84)),
    radial-gradient(circle at 72% 18%, rgba(226, 180, 95, 0.22), transparent 30%),
    radial-gradient(circle at 24% 76%, rgba(120, 184, 173, 0.18), transparent 34%),
    linear-gradient(135deg, #2b261d 0%, #151711 48%, #091211 100%);
}

:root[data-theme="wuxia-scroll"] .messages {
  padding-bottom: 142px;
  background:
    linear-gradient(180deg, rgba(8, 7, 6, 0.16), rgba(8, 7, 6, 0.72)),
    transparent;
}

.stage-actions {
  position: absolute;
  right: 24px;
  bottom: 118px;
  z-index: 3;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

:root[data-theme="wuxia-scroll"] .stage-actions .tool-button {
  border-color: rgba(226, 180, 95, 0.36);
  background: rgba(21, 17, 13, 0.74);
  color: #f0dec0;
  backdrop-filter: blur(8px);
}

:root[data-theme="wuxia-scroll"] .chat-form {
  position: absolute;
  left: 24px;
  right: 24px;
  bottom: 18px;
  z-index: 3;
  border: 1px solid rgba(226, 180, 95, 0.42);
  border-radius: 18px;
  background:
    linear-gradient(135deg, rgba(244, 226, 186, 0.96), rgba(207, 178, 122, 0.9));
  box-shadow: 0 20px 44px rgba(0, 0, 0, 0.38);
}

:root[data-theme="wuxia-scroll"] .chat-form textarea {
  border-color: rgba(109, 75, 31, 0.22);
  background: rgba(84, 55, 25, 0.12);
  color: #2f2112;
}

:root[data-theme="wuxia-scroll"] .chat-form textarea::placeholder {
  color: rgba(47, 33, 18, 0.58);
}

@media (max-width: 760px) {
  .stage-actions,
  :root[data-theme="wuxia-scroll"] .chat-form {
    position: static;
  }

  :root[data-theme="wuxia-scroll"] .messages {
    padding-bottom: 18px;
  }
}
```

- [ ] **Step 6: Run syntax checks and commit**

Run:

```bash
node --check public/app.js
git diff --check
```

Expected: both commands exit 0.

Commit:

```bash
git add public/index.html public/app.js public/styles.css
git commit -m "style: add wuxia stage theme"
```

## Task 5: Final Verification

**Files:**
- No source changes expected unless verification exposes a bug.

- [ ] **Step 1: Run full automated tests**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Run frontend syntax checks**

Run:

```bash
node --check public/app.js
node --check public/markdown.js
node --check server/app.js
node --check server/agent/factCards.js
```

Expected: all commands exit 0.

- [ ] **Step 3: Verify static app responds**

Run:

```bash
curl -fsSI http://127.0.0.1:5177/
```

Expected: `HTTP/1.1 200 OK`. If the dev server is not running, start it with `npm run dev` and retry the curl command.

- [ ] **Step 4: Verify worktree and summarize commits**

Run:

```bash
git status --short
git log --oneline -6
```

Expected: `git status --short` prints nothing. The log includes commits for fact normalization, memory fact API, Fact Management UI, and wuxia stage theme.

## Self-Review

- Spec coverage: Fact card review, edit, enable/disable, delete, promote-to-world-book, default auto-effect behavior, theme switching, background/overlay, floating input, and scene actions are covered by Tasks 1-4.
- Scope: Full graph visualization and persistent background upload are not implemented because the approved spec explicitly defers them.
- Type consistency: The plan uses `memoryCards`, `enabled`, `source`, `extensions`, `PUT /api/memory/facts`, and `POST /api/memory/facts/:factId/promote` consistently across server tests, API handlers, and frontend code.
- Verification: Focused tests run after each backend task, syntax checks run after frontend tasks, and full verification runs at the end.
