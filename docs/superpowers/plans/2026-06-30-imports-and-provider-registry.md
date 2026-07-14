# Imports and Provider Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Discord-friendly Character Card / World Book import with preview-confirm flow, and expand model support beyond OpenAI-compatible endpoints.

**Architecture:** Keep import parsing server-side and local-only, returning a bounded preview before mutating config. Add a provider registry that routes `openai-compatible`, `anthropic`, and `gemini` providers through focused client modules while preserving existing provider config and masked-secret behavior.

**Tech Stack:** Node.js ESM, native `fetch`, native `node:test`, browser HTML/CSS/vanilla JS.

---

### Task 1: Import Parser and Preview API

**Files:**
- Modify: `server/character/characterCardImport.js`
- Create: `server/character/worldBookImport.js`
- Create: `server/character/importPreview.js`
- Modify: `server/config/configService.js`
- Modify: `server/app.js`
- Test: `tests/importPreview.test.js`
- Test: `tests/httpApi.test.js`

- [ ] **Step 1: Write failing tests**

Add tests for:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { previewImportPayload } from '../server/character/importPreview.js';
import { importWorldBookFromPayload } from '../server/character/worldBookImport.js';

test('previews Character Card V2 with embedded character book', () => {
  const preview = previewImportPayload({
    fileName: 'shen.json',
    mimeType: 'application/json',
    data: JSON.stringify({
      spec: 'chara_card_v2',
      data: {
        name: '沈观澜',
        first_mes: '夜雨打在刀鞘上。',
        tags: ['武侠'],
        character_book: {
          scan_depth: 6,
          entries: [{ name: '镇武司暗线', keys: ['镇武司'], content: '旧案背后另有暗线。' }]
        }
      }
    })
  });

  assert.equal(preview.kind, 'character-card');
  assert.equal(preview.summary.characterName, '沈观澜');
  assert.equal(preview.summary.worldBookCount, 1);
  assert.deepEqual(preview.summary.keywordSamples, ['镇武司']);
});

test('imports SillyTavern world book JSON entries', () => {
  const entries = importWorldBookFromPayload({
    fileName: 'world.json',
    mimeType: 'application/json',
    data: JSON.stringify({
      entries: {
        '1': {
          comment: '听雨楼',
          key: ['听雨楼'],
          content: '听雨楼贩卖秘密。',
          enabled: true,
          depth: 5,
          selectiveLogic: 0
        }
      }
    })
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, '听雨楼');
  assert.equal(entries[0].depth, 5);
});
```

- [ ] **Step 2: Run failing tests**

Run: `node --test tests/importPreview.test.js tests/httpApi.test.js`

Expected: import preview modules are missing.

- [ ] **Step 3: Implement import modules**

Implement:

```js
export function importWorldBookFromPayload(payload) {
  const raw = readJsonPayload(payload);
  const rawEntries = Array.isArray(raw.entries) ? raw.entries : Object.values(raw.entries || raw);
  return rawEntries.filter((entry) => entry && entry.enabled !== false && entry.content).map(normalizeEntry);
}

export function previewImportPayload(payload) {
  const card = tryCharacterCard(payload);
  if (card) return buildCharacterPreview(card);
  const worldBook = importWorldBookFromPayload(payload);
  return buildWorldBookPreview(worldBook);
}
```

Use existing Character Card parsing for V2 PNG/JSON. Normalize SillyTavern fields `key`, `keysecondary`, `depth`, `insertion_order`, `constant`, `case_sensitive`, `selective`, and `selectiveLogic`.

- [ ] **Step 4: Add API routes**

Add:

```js
POST /api/import/preview
POST /api/import/commit
```

`preview` returns `{ preview }`. `commit` accepts `{ payload, options }`; options default to `{ characterMode: 'replace', worldBookMode: 'append-dedupe' }`.

- [ ] **Step 5: Run import tests**

Run: `node --test tests/importPreview.test.js tests/httpApi.test.js`

Expected: PASS.

### Task 2: Provider Registry and Native Providers

**Files:**
- Create: `server/provider/anthropic.js`
- Create: `server/provider/gemini.js`
- Create: `server/provider/providerRegistry.js`
- Modify: `server/provider/openaiCompatible.js`
- Modify: `server/config/defaults.js`
- Modify: `server/config/configService.js`
- Modify: `server/app.js`
- Test: `tests/providerRegistry.test.js`
- Test: `tests/providerClient.test.js`
- Test: `tests/configService.test.js`

- [ ] **Step 1: Write failing tests**

Add tests for:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProviderClient } from '../server/provider/providerRegistry.js';
import { buildAnthropicRequest } from '../server/provider/anthropic.js';
import { buildGeminiRequest } from '../server/provider/gemini.js';

test('buildProviderClient routes anthropic provider', async () => {
  const client = buildProviderClient();
  let request;
  const result = await client.complete({
    provider: { kind: 'anthropic', apiKey: 'secret', model: 'claude-3-5-sonnet-latest', maxTokens: 500 },
    messages: [{ role: 'system', content: '规则' }, { role: 'user', content: '你好' }],
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({ content: [{ type: 'text', text: '江湖夜雨。' }] }), { status: 200 });
    }
  });

  assert.match(request.url, /api\.anthropic\.com/);
  assert.equal(result.content, '江湖夜雨。');
});

test('buildGeminiRequest maps chat messages to contents', () => {
  const { url, init } = buildGeminiRequest({
    provider: { apiKey: 'secret', model: 'gemini-2.5-flash', temperature: 0.8, maxTokens: 1200 },
    messages: [{ role: 'system', content: '规则' }, { role: 'user', content: '你好' }]
  });

  assert.match(url, /gemini-2\.5-flash:generateContent/);
  assert.equal(JSON.parse(init.body).generationConfig.maxOutputTokens, 1200);
});
```

- [ ] **Step 2: Implement focused clients**

Anthropic:

```js
POST https://api.anthropic.com/v1/messages
headers: x-api-key, anthropic-version, content-type
body: { model, max_tokens, temperature, system, messages }
```

Gemini:

```js
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}
body: { systemInstruction, contents, generationConfig }
```

Return `{ content, raw }` from both clients.

- [ ] **Step 3: Wire registry**

Replace app provider client construction with:

```js
const providerClient = providerClientOverride || buildProviderClient();
```

Keep `openai-compatible` default for older configs.

- [ ] **Step 4: Run provider tests**

Run: `node --test tests/providerRegistry.test.js tests/providerClient.test.js tests/configService.test.js`

Expected: PASS.

### Task 3: Frontend Import Preview and Provider Presets

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Test: `tests/smoke.test.js`

- [ ] **Step 1: Add UI controls**

In the provider form, add:

```html
<label>
  <span>厂商预设</span>
  <select id="provider-preset"></select>
</label>
<label>
  <span>协议</span>
  <select id="provider-kind">
    <option value="openai-compatible">OpenAI Compatible</option>
    <option value="anthropic">Anthropic Claude</option>
    <option value="gemini">Google Gemini</option>
  </select>
</label>
```

In the character panel, add a shared import file input that accepts `.json,.png`, a preview block, and confirm/cancel buttons.

- [ ] **Step 2: Add JS behavior**

Add provider presets for OpenAI, DeepSeek, Qwen, Moonshot, SiliconFlow, OpenRouter, Ollama, LM Studio, Anthropic, and Gemini. On file select, call `/api/import/preview`; on confirm, call `/api/import/commit`.

- [ ] **Step 3: Style preview**

Add compact cards for import summaries and provider preset hints, keeping the current wuxia theme.

- [ ] **Step 4: Run smoke and full tests**

Run: `npm test`

Expected: all tests pass.
