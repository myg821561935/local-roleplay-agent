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
