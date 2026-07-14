import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateImage } from '../server/agent/imageClient.js';

test('generateImage throws on missing baseUrl', async () => {
  await assert.rejects(
    generateImage({ provider: { apiKey: 'k', model: 'm' }, prompt: 'cat', fetchImpl: async () => ({}) }),
    /baseUrl/
  );
});

test('generateImage throws on missing apiKey', async () => {
  await assert.rejects(
    generateImage({ provider: { baseUrl: 'http://x', model: 'm' }, prompt: 'cat', fetchImpl: async () => ({}) }),
    /apiKey/
  );
});

test('generateImage throws on missing model', async () => {
  await assert.rejects(
    generateImage({ provider: { baseUrl: 'http://x', apiKey: 'k' }, prompt: 'cat', fetchImpl: async () => ({}) }),
    /model/
  );
});

test('generateImage parses url response', async () => {
  const fakeFetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({
      data: [{ url: 'https://example.com/image.png' }]
    })
  });
  const result = await generateImage({
    provider: { baseUrl: 'http://x', apiKey: 'k', model: 'm' },
    prompt: 'a cat',
    fetchImpl: fakeFetch
  });
  assert.deepEqual(result.urls, ['https://example.com/image.png']);
  assert.equal(result.b64.length, 0);
});

test('generateImage parses b64_json response', async () => {
  const fakeFetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({
      data: [{ b64_json: 'iVBORw0KGgoAAAANS' }]
    })
  });
  const result = await generateImage({
    provider: { baseUrl: 'http://x', apiKey: 'k', model: 'm' },
    prompt: 'a dog',
    fetchImpl: fakeFetch
  });
  assert.equal(result.urls.length, 0);
  assert.deepEqual(result.b64, ['iVBORw0KGgoAAAANS']);
});

test('generateImage throws on missing data field', async () => {
  const fakeFetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ foo: 'bar' })
  });
  await assert.rejects(
    generateImage({
      provider: { baseUrl: 'http://x', apiKey: 'k', model: 'm' },
      prompt: 'test',
      fetchImpl: fakeFetch
    }),
    /missing urls or b64_json/
  );
});

test('generateImage throws on non-ok response with helpful message', async () => {
  const fakeFetch = async () => ({
    ok: false,
    status: 401,
    text: async () => JSON.stringify({ error: 'invalid api key' })
  });
  await assert.rejects(
    generateImage({
      provider: { baseUrl: 'http://x', apiKey: 'bad', model: 'm' },
      prompt: 'test',
      fetchImpl: fakeFetch
    }),
    /Image provider error 401/
  );
});

test('generateImage truncates long prompt', async () => {
  let capturedBody;
  const fakeFetch = async (url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return {
      ok: true,
      text: async () => JSON.stringify({ data: [{ url: 'http://x/img.png' }] })
    };
  };
  const longPrompt = 'a'.repeat(5000);
  await generateImage({
    provider: { baseUrl: 'http://x', apiKey: 'k', model: 'm' },
    prompt: longPrompt,
    fetchImpl: fakeFetch
  });
  assert.ok(capturedBody.prompt.length <= 4000);
});
