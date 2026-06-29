import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';

test('GET /api/state returns config and session', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, { url: '/api/state' });
  const payload = response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.session.id, 'main');
  assert.equal(Array.isArray(payload.config.promptModules), true);
  assert.equal(payload.config.characterCard.name, '未命名主角');
});

test('PUT /api/character-card saves character card', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'PUT',
    url: '/api/character-card',
    headers: { 'content-type': 'application/json' },
    body: {
      characterCard: {
        name: '沈观澜',
        role: '游侠',
        description: '初入江湖的刀客。',
        personality: '沉稳，重诺。',
        scenario: '正在调查镇武司旧案。',
        firstMessage: '夜雨打在刀鞘上。',
        exampleDialog: ['用户：你是谁？', '沈观澜：过路人。'],
        tags: ['武侠'],
        enabled: true
      }
    }
  });
  const payload = response.json();
  const state = (await request(app, { url: '/api/state' })).json();

  assert.equal(response.status, 200);
  assert.equal(payload.characterCard.name, '沈观澜');
  assert.equal(state.config.characterCard.name, '沈观澜');
});

test('PUT /api/character-card rejects non-object payload', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'PUT',
    url: '/api/character-card',
    headers: { 'content-type': 'application/json' },
    body: { characterCard: [] }
  });
  const payload = response.json();

  assert.equal(response.status, 400);
  assert.deepEqual(payload, { error: 'INVALID_CHARACTER_CARD' });
});

test('POST /api/character-card/import saves Character Card V2 and imports character book', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'POST',
    url: '/api/character-card/import',
    headers: { 'content-type': 'application/json' },
    body: {
      fileName: 'shen.json',
      mimeType: 'application/json',
      data: JSON.stringify(createV2CardPayload())
    }
  });
  const payload = response.json();
  const state = (await request(app, { url: '/api/state' })).json();

  assert.equal(response.status, 200);
  assert.equal(payload.characterCard.name, '沈观澜');
  assert.equal(payload.importedWorldBookCount, 1);
  assert.equal(state.config.characterCard.name, '沈观澜');
  assert.ok(state.config.worldBook.find((entry) => entry.title === '镇武司暗线'));
});

test('PUT /api/providers saves provider and GET /api/state masks apiKey and sensitive headers', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const providerConfig = {
    activeProviderId: 'local',
    providers: [{
      id: 'local',
      kind: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'secret',
      model: 'model-a',
      temperature: 0.8,
      maxTokens: 1024,
      headers: {
        Authorization: 'Bearer secret-token',
        'x-api-key': 'header-secret',
        'x-auth-token': 'auth-secret',
        'x-request-id': 'visible-request'
      }
    }]
  };

  const saveResponse = await request(app, {
    method: 'PUT',
    url: '/api/providers',
    headers: { 'content-type': 'application/json' },
    body: providerConfig
  });
  assert.equal(saveResponse.status, 200);

  const stateResponse = await request(app, { url: '/api/state' });
  const payload = stateResponse.json();

  assert.equal(payload.config.providers.activeProviderId, 'local');
  assert.equal(payload.config.providers.providers[0].apiKey, '********');
  assert.equal(payload.config.providers.providers[0].headers.Authorization, '********');
  assert.equal(payload.config.providers.providers[0].headers['x-api-key'], '********');
  assert.equal(payload.config.providers.providers[0].headers['x-auth-token'], '********');
  assert.equal(payload.config.providers.providers[0].headers['x-request-id'], 'visible-request');
  assert.equal(payload.config.providers.providers[0].model, 'model-a');
});

test('PUT /api/providers preserves real apiKey and sensitive headers when saving masked provider config', async () => {
  const rootDir = await createTestRoot();
  const app = createApp({ rootDir });
  const providerConfig = {
    activeProviderId: 'local',
    providers: [{
      id: 'local',
      kind: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'secret',
      model: 'model-a',
      temperature: 0.8,
      maxTokens: 1024,
      headers: {
        Authorization: 'Bearer secret-token',
        'x-api-key': 'header-secret',
        'x-request-id': 'visible-request'
      }
    }]
  };

  await request(app, {
    method: 'PUT',
    url: '/api/providers',
    headers: { 'content-type': 'application/json' },
    body: providerConfig
  });
  const stateResponse = await request(app, { url: '/api/state' });
  const maskedConfig = stateResponse.json().config.providers;
  maskedConfig.providers[0].model = 'model-b';
  maskedConfig.providers[0].headers['x-request-id'] = 'next-request';

  const saveMaskedResponse = await request(app, {
    method: 'PUT',
    url: '/api/providers',
    headers: { 'content-type': 'application/json' },
    body: maskedConfig
  });
  const nextState = (await request(app, { url: '/api/state' })).json();
  const savedProviderConfig = JSON.parse(
    await readFile(path.join(rootDir, 'data', 'config', 'providers.local.json'), 'utf8')
  );

  assert.equal(saveMaskedResponse.status, 200);
  assert.equal(nextState.config.providers.providers[0].apiKey, '********');
  assert.equal(nextState.config.providers.providers[0].model, 'model-b');
  assert.equal(nextState.config.providers.providers[0].headers.Authorization, '********');
  assert.equal(nextState.config.providers.providers[0].headers['x-api-key'], '********');
  assert.equal(nextState.config.providers.providers[0].headers['x-request-id'], 'next-request');
  assert.equal(savedProviderConfig.providers[0].apiKey, 'secret');
  assert.equal(savedProviderConfig.providers[0].model, 'model-b');
  assert.equal(savedProviderConfig.providers[0].headers.Authorization, 'Bearer secret-token');
  assert.equal(savedProviderConfig.providers[0].headers['x-api-key'], 'header-secret');
  assert.equal(savedProviderConfig.providers[0].headers['x-request-id'], 'next-request');
});

test('PUT /api/providers normalizes non-object headers to empty object', async () => {
  const rootDir = await createTestRoot();
  const app = createApp({ rootDir });

  const response = await request(app, {
    method: 'PUT',
    url: '/api/providers',
    headers: { 'content-type': 'application/json' },
    body: {
      activeProviderId: 'local',
      providers: [{
        id: 'local',
        kind: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret',
        model: 'model-a',
        temperature: 0.8,
        maxTokens: 1024,
        headers: ['x-api-key', 'secret']
      }]
    }
  });
  const savedProviderConfig = JSON.parse(
    await readFile(path.join(rootDir, 'data', 'config', 'providers.local.json'), 'utf8')
  );

  assert.equal(response.status, 200);
  assert.deepEqual(savedProviderConfig.providers[0].headers, {});
});

test('GET /api/health returns ok', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, { url: '/api/health' });
  const payload = response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload, { ok: true, app: 'local-roleplay-agent' });
});

test('unknown API route returns JSON 404', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, { url: '/api/missing' });
  const payload = response.json();

  assert.equal(response.status, 404);
  assert.deepEqual(payload, { error: 'NOT_FOUND' });
});

test('invalid JSON body returns INVALID_JSON', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'PUT',
    url: '/api/providers',
    headers: { 'content-type': 'application/json' },
    body: '{not-json'
  });
  const payload = response.json();

  assert.equal(response.status, 400);
  assert.deepEqual(payload, { error: 'INVALID_JSON' });
});

test('mutating API route rejects unsupported media type', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'PUT',
    url: '/api/providers',
    headers: { 'content-type': 'text/plain' },
    body: '{}'
  });
  const payload = response.json();

  assert.equal(response.status, 415);
  assert.deepEqual(payload, { error: 'UNSUPPORTED_MEDIA_TYPE' });
});

test('mutating API route rejects forbidden origin', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'PUT',
    url: '/api/providers',
    headers: {
      'content-type': 'application/json',
      origin: 'https://evil.example'
    },
    body: {}
  });
  const payload = response.json();

  assert.equal(response.status, 403);
  assert.deepEqual(payload, { error: 'FORBIDDEN_ORIGIN' });
});

test('PUT /api/prompt-modules rejects non-array payload', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'PUT',
    url: '/api/prompt-modules',
    headers: { 'content-type': 'application/json' },
    body: { promptModules: { id: 'not-an-array' } }
  });
  const payload = response.json();

  assert.equal(response.status, 400);
  assert.deepEqual(payload, { error: 'INVALID_PROMPT_MODULES' });
});

test('PUT /api/world-book rejects non-array payload', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'PUT',
    url: '/api/world-book',
    headers: { 'content-type': 'application/json' },
    body: { worldBook: 'not-an-array' }
  });
  const payload = response.json();

  assert.equal(response.status, 400);
  assert.deepEqual(payload, { error: 'INVALID_WORLD_BOOK' });
});

test('POST /api/chat without active provider returns NO_ACTIVE_PROVIDER', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'POST',
    url: '/api/chat',
    headers: { 'content-type': 'application/json' },
    body: { content: '有人吗？' }
  });
  const payload = response.json();

  assert.equal(response.status, 409);
  assert.deepEqual(payload, { error: 'NO_ACTIVE_PROVIDER' });
});

test('POST /api/chat maps provider failure to PROVIDER_ERROR', async () => {
  const rootDir = await createTestRoot();
  const app = createApp({
    rootDir,
    providerClient: {
      complete: async () => {
        throw new Error('provider down');
      }
    }
  });

  await request(app, {
    method: 'PUT',
    url: '/api/providers',
    headers: { 'content-type': 'application/json' },
    body: {
      activeProviderId: 'local',
      providers: [{
        id: 'local',
        kind: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret',
        model: 'model-a',
        temperature: 0.8,
        maxTokens: 1024,
        headers: {}
      }]
    }
  });

  const response = await request(app, {
    method: 'POST',
    url: '/api/chat',
    headers: { 'content-type': 'application/json' },
    body: { content: '推门进去。' }
  });
  const payload = response.json();

  assert.equal(response.status, 502);
  assert.deepEqual(payload, { error: 'PROVIDER_ERROR' });
});

test('POST /api/chat/stream returns SSE chunks and persists the turn', async () => {
  const rootDir = await createTestRoot();
  const app = createApp({
    rootDir,
    providerClient: {
      complete: async ({ messages }) => ({
        content: `流式回应：${messages.at(-1).content}`,
        raw: { fake: true }
      })
    }
  });
  await saveHttpProvider(app);

  const response = await request(app, {
    method: 'POST',
    url: '/api/chat/stream',
    headers: { 'content-type': 'application/json' },
    body: { content: '我拔刀。' }
  });
  const state = (await request(app, { url: '/api/state' })).json();

  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /^text\/event-stream/);
  assert.match(response.text, /event: token/);
  assert.match(response.text, /流式回应/);
  assert.match(response.text, /event: done/);
  assert.equal(state.session.messages.length, 2);
  assert.equal(state.session.messages[1].content, '流式回应：我拔刀。');
});

test('PATCH /api/messages/:messageId edits a user message and trims later history', async () => {
  const rootDir = await createTestRoot();
  const app = createApp({ rootDir, providerClient: createHttpEchoProviderClient() });
  await saveHttpProvider(app);

  const firstTurn = await request(app, {
    method: 'POST',
    url: '/api/chat',
    headers: { 'content-type': 'application/json' },
    body: { content: '我去镇武司。' }
  });
  await request(app, {
    method: 'POST',
    url: '/api/chat',
    headers: { 'content-type': 'application/json' },
    body: { content: '我继续前进。' }
  });
  const userId = firstTurn.json().session.messages[0].id;

  const response = await request(app, {
    method: 'PATCH',
    url: `/api/messages/${userId}`,
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'main', content: '我改去听雨楼。' }
  });
  const payload = response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.session.messages.length, 2);
  assert.equal(payload.session.messages[0].content, '我改去听雨楼。');
  assert.match(payload.session.messages[1].content, /回应：我改去听雨楼。/);
});

test('POST /api/messages/:messageId/regenerate stores assistant swipes', async () => {
  const rootDir = await createTestRoot();
  let turn = 0;
  const app = createApp({
    rootDir,
    providerClient: {
      complete: async ({ messages }) => {
        turn += 1;
        return { content: `第${turn}版回应：${messages.at(-1).content}`, raw: { fake: true } };
      }
    }
  });
  await saveHttpProvider(app);

  const firstTurn = await request(app, {
    method: 'POST',
    url: '/api/chat',
    headers: { 'content-type': 'application/json' },
    body: { content: '我推门进去。' }
  });
  const assistantId = firstTurn.json().reply.id;

  const response = await request(app, {
    method: 'POST',
    url: `/api/messages/${assistantId}/regenerate`,
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'main' }
  });
  const assistant = response.json().session.messages[1];

  assert.equal(response.status, 200);
  assert.equal(assistant.activeSwipeIndex, 1);
  assert.deepEqual(assistant.swipes, ['第1版回应：我推门进去。', '第2版回应：我推门进去。']);
});

test('static / returns the HTML page', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, { url: '/' });

  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /^text\/html/);
  assert.match(response.text, /本地角色扮演 Agent/);
});

test('static path traversal attempt returns non-200 and does not expose files', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, { url: '/%2e%2e/secret.txt' });

  assert.notEqual(response.status, 200);
  assert.doesNotMatch(response.text, /do-not-expose/);
});

async function request(app, { method = 'GET', url = '/', body, headers = {} } = {}) {
  const rawBody = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  const req = Readable.from(rawBody ? [Buffer.from(rawBody)] : []);
  req.method = method;
  req.url = url;
  req.headers = headers;

  const chunks = [];
  let statusCode = 200;
  let responseHeaders = {};
  let resolveEnd;
  const ended = new Promise((resolve) => {
    resolveEnd = resolve;
  });

  const res = {
    writeHead(code, writtenHeaders = {}) {
      statusCode = code;
      responseHeaders = normalizeHeaders(writtenHeaders);
    },
    write(chunk = '') {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    },
    end(chunk = '') {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      resolveEnd();
    }
  };

  await app(req, res);
  await ended;
  const text = Buffer.concat(chunks).toString('utf8');
  return {
    status: statusCode,
    headers: responseHeaders,
    text,
    json: () => JSON.parse(text)
  };
}

function normalizeHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
}

async function createTestRoot() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'agent-http-'));
  await mkdir(path.join(rootDir, 'public'), { recursive: true });
  await writeFile(
    path.join(rootDir, 'public', 'index.html'),
    '<!doctype html><html><body><h1>本地角色扮演 Agent</h1></body></html>',
    'utf8'
  );
  await writeFile(path.join(rootDir, 'secret.txt'), 'do-not-expose', 'utf8');
  return rootDir;
}

async function saveHttpProvider(app) {
  await request(app, {
    method: 'PUT',
    url: '/api/providers',
    headers: { 'content-type': 'application/json' },
    body: {
      activeProviderId: 'local',
      providers: [{
        id: 'local',
        kind: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret',
        model: 'model-a',
        temperature: 0.8,
        maxTokens: 1024,
        headers: {}
      }]
    }
  });
}

function createHttpEchoProviderClient() {
  return {
    complete: async ({ messages }) => ({
      content: `回应：${messages.at(-1).content}`,
      raw: { fake: true }
    })
  };
}

function createV2CardPayload() {
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: '沈观澜',
      description: '初入江湖的刀客。',
      personality: '沉稳。',
      scenario: '旧案开局。',
      first_mes: '夜雨打在刀鞘上。',
      mes_example: '',
      creator_notes: '',
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: [],
      tags: ['武侠'],
      creator: 'liufeng',
      character_version: '1.0.0',
      extensions: {},
      character_book: {
        scan_depth: 5,
        extensions: {},
        entries: [{
          name: '镇武司暗线',
          keys: ['镇武司'],
          content: '镇武司旧案背后另有朝堂暗线。',
          enabled: true,
          insertion_order: 1,
          extensions: {}
        }]
      }
    }
  };
}
