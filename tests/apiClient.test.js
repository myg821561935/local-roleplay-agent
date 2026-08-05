import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createApiRequest,
  createHttpError,
  formatHttpError,
  isJsonResponse,
  parseJsonResponse
} from '../public/modules/apiClient.js';

test('API response helpers preserve JSON detection and bounded HTTP diagnostics', () => {
  assert.deepEqual(parseJsonResponse(' {"ok":true} '), { ok: true });
  assert.equal(parseJsonResponse(''), undefined);
  assert.equal(parseJsonResponse('{broken'), undefined);

  const jsonResponse = new Response('{}', {
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
  const textResponse = new Response('ok', {
    headers: { 'content-type': 'text/plain' }
  });
  assert.equal(isJsonResponse(jsonResponse), true);
  assert.equal(isJsonResponse(textResponse), false);

  const longText = 'x'.repeat(200);
  const formatted = formatHttpError({
    status: 502,
    statusText: 'Bad Gateway'
  }, longText);
  assert.equal(formatted, `502 Bad Gateway: ${'x'.repeat(160)}...`);
});

test('API request serializes JSON bodies and preserves raw request bodies', async () => {
  const calls = [];
  const apiRequest = createApiRequest({
    fetchImpl: async (...args) => {
      calls.push(args);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' }
      });
    }
  });

  assert.deepEqual(await apiRequest('/api/json', {
    method: 'POST',
    headers: { 'x-request-id': 'request-1' },
    body: { name: '沈观澜' }
  }), { ok: true });
  assert.deepEqual(calls[0], [
    '/api/json',
    {
      method: 'POST',
      headers: {
        'x-request-id': 'request-1',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ name: '沈观澜' })
    }
  ]);

  const rawBody = new Uint8Array([1, 2, 3]);
  await apiRequest('/api/raw', { method: 'PUT', rawBody });
  assert.deepEqual(calls[1], [
    '/api/raw',
    {
      method: 'PUT',
      headers: {},
      body: rawBody
    }
  ]);
});

test('API request returns structured errors with stable code, status and message precedence', async () => {
  const apiRequest = createApiRequest({
    fetchImpl: async () => new Response(JSON.stringify({
      error: 'PROVIDER_ERROR',
      message: '备用错误',
      detail: '模型不可用'
    }), {
      status: 502,
      statusText: 'Bad Gateway',
      headers: { 'content-type': 'application/json' }
    })
  });

  await assert.rejects(
    apiRequest('/api/provider'),
    (error) => (
      error.message === '模型不可用'
      && error.code === 'PROVIDER_ERROR'
      && error.status === 502
    )
  );

  const error = createHttpError(
    { status: 409, statusText: 'Conflict' },
    '{"error":"NO_ACTIVE_PROVIDER"}'
  );
  assert.equal(error.message, 'NO_ACTIVE_PROVIDER');
  assert.equal(error.code, 'NO_ACTIVE_PROVIDER');
  assert.equal(error.status, 409);
});

test('API request rejects successful non-JSON and malformed JSON responses', async () => {
  const textApiRequest = createApiRequest({
    fetchImpl: async () => new Response('upstream text', {
      statusText: 'OK',
      headers: { 'content-type': 'text/plain' }
    })
  });
  await assert.rejects(
    textApiRequest('/api/text'),
    /接口返回的不是 JSON：200 OK: upstream text/
  );

  const malformedApiRequest = createApiRequest({
    fetchImpl: async () => new Response('{broken', {
      statusText: 'OK',
      headers: { 'content-type': 'application/json' }
    })
  });
  await assert.rejects(
    malformedApiRequest('/api/malformed'),
    /接口返回的不是 JSON：200 OK: \{broken/
  );

  assert.throws(
    () => createApiRequest({ fetchImpl: null }),
    /fetchImpl must be a function/
  );
});
