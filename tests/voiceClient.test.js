import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synthesizeSpeech, transcribeSpeech } from '../server/agent/voiceClient.js';

test('synthesizeSpeech throws on missing baseUrl', async () => {
  await assert.rejects(
    synthesizeSpeech({ provider: { apiKey: 'k', model: 'm' }, text: 'hi', fetchImpl: async () => ({}) }),
    /baseUrl/
  );
});

test('synthesizeSpeech throws on missing apiKey', async () => {
  await assert.rejects(
    synthesizeSpeech({ provider: { baseUrl: 'http://x', model: 'm' }, text: 'hi', fetchImpl: async () => ({}) }),
    /apiKey/
  );
});

test('synthesizeSpeech throws on missing model', async () => {
  await assert.rejects(
    synthesizeSpeech({ provider: { baseUrl: 'http://x', apiKey: 'k' }, text: 'hi', fetchImpl: async () => ({}) }),
    /model/
  );
});

test('synthesizeSpeech throws on empty text', async () => {
  await assert.rejects(
    synthesizeSpeech({ provider: { baseUrl: 'http://x', apiKey: 'k', model: 'm' }, text: '  ', fetchImpl: async () => ({}) }),
    /text is required/
  );
});

test('synthesizeSpeech returns audio buffer on success', async () => {
  const audioBuf = new Uint8Array([1, 2, 3, 4]).buffer;
  const fakeFetch = async () => ({
    ok: true,
    arrayBuffer: async () => audioBuf
  });
  const result = await synthesizeSpeech({
    provider: { baseUrl: 'http://x', apiKey: 'k', model: 'm' },
    text: 'hello world',
    voice: 'alloy',
    format: 'mp3',
    fetchImpl: fakeFetch
  });
  assert.equal(result.format, 'mp3');
  assert.ok(result.audio.byteLength > 0);
});

test('synthesizeSpeech throws on non-ok response', async () => {
  const fakeFetch = async () => ({
    ok: false,
    status: 401,
    text: async () => JSON.stringify({ error: 'invalid key' })
  });
  await assert.rejects(
    synthesizeSpeech({
      provider: { baseUrl: 'http://x', apiKey: 'bad', model: 'm' },
      text: 'test',
      fetchImpl: fakeFetch
    }),
    /TTS provider error 401/
  );
});

test('synthesizeSpeech truncates long text', async () => {
  let capturedBody;
  const fakeFetch = async (url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
  };
  const longText = 'a'.repeat(5000);
  await synthesizeSpeech({
    provider: { baseUrl: 'http://x', apiKey: 'k', model: 'm' },
    text: longText,
    fetchImpl: fakeFetch
  });
  assert.ok(capturedBody.input.length <= 4000);
});

test('synthesizeSpeech uses ttsModel when present', async () => {
  let capturedBody;
  const fakeFetch = async (url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
  };
  await synthesizeSpeech({
    provider: { baseUrl: 'http://x', apiKey: 'k', model: 'chat-model', ttsModel: 'tts-1' },
    text: 'test',
    fetchImpl: fakeFetch
  });
  assert.equal(capturedBody.model, 'tts-1');
});

test('transcribeSpeech throws on missing audio', async () => {
  await assert.rejects(
    transcribeSpeech({ provider: { baseUrl: 'http://x', apiKey: 'k', model: 'm' }, fetchImpl: async () => ({}) }),
    /audio is required/
  );
});

test('transcribeSpeech returns text on success', async () => {
  const fakeFetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ text: 'hello world' })
  });
  const result = await transcribeSpeech({
    provider: { baseUrl: 'http://x', apiKey: 'k', model: 'whisper-1' },
    audio: new Blob(['fake audio'], { type: 'audio/wav' }),
    filename: 'test.wav',
    fetchImpl: fakeFetch
  });
  assert.equal(result.text, 'hello world');
});

test('transcribeSpeech throws on non-ok response', async () => {
  const fakeFetch = async () => ({
    ok: false,
    status: 400,
    text: async () => JSON.stringify({ error: 'bad request' })
  });
  await assert.rejects(
    transcribeSpeech({
      provider: { baseUrl: 'http://x', apiKey: 'k', model: 'm' },
      audio: new Blob(['fake'], { type: 'audio/wav' }),
      fetchImpl: fakeFetch
    }),
    /STT provider error 400/
  );
});

test('transcribeSpeech throws on missing text in response', async () => {
  const fakeFetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ foo: 'bar' })
  });
  await assert.rejects(
    transcribeSpeech({
      provider: { baseUrl: 'http://x', apiKey: 'k', model: 'm' },
      audio: new Blob(['fake'], { type: 'audio/wav' }),
      fetchImpl: fakeFetch
    }),
    /missing text/
  );
});

test('transcribeSpeech uses sttModel when present', async () => {
  let capturedFormData;
  const fakeFetch = async (url, opts) => {
    capturedFormData = opts.body;
    return { ok: true, text: async () => JSON.stringify({ text: 'ok' }) };
  };
  await transcribeSpeech({
    provider: { baseUrl: 'http://x', apiKey: 'k', model: 'chat', sttModel: 'whisper-1' },
    audio: new Blob(['fake'], { type: 'audio/wav' }),
    fetchImpl: fakeFetch
  });
  assert.ok(capturedFormData instanceof FormData);
  assert.equal(capturedFormData.get('model'), 'whisper-1');
});

test('transcribeSpeech accepts ArrayBuffer input', async () => {
  const fakeFetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ text: 'from buffer' })
  });
  const result = await transcribeSpeech({
    provider: { baseUrl: 'http://x', apiKey: 'k', model: 'm' },
    audio: new ArrayBuffer(8),
    format: 'wav',
    fetchImpl: fakeFetch
  });
  assert.equal(result.text, 'from buffer');
});

test('transcribeSpeech throws on unsupported audio type', async () => {
  await assert.rejects(
    transcribeSpeech({
      provider: { baseUrl: 'http://x', apiKey: 'k', model: 'm' },
      audio: 'string is not allowed',
      fetchImpl: async () => ({})
    }),
    /Unsupported audio input type/
  );
});
