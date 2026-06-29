import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
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
});

test('PUT /api/providers saves provider and GET /api/state masks apiKey', async () => {
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
      headers: {}
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
  assert.equal(payload.config.providers.providers[0].model, 'model-a');
});

test('GET /api/health returns ok', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, { url: '/api/health' });
  const payload = response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload, { ok: true, app: 'local-roleplay-agent' });
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
