import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../server/lib/jsonStore.js';

test('JsonStore writes and reads JSON under the root directory', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-store-'));
  const store = new JsonStore(root);
  await store.write('config/example.json', { name: '神荒武界', count: 1 });
  const loaded = await store.read('config/example.json', {});
  assert.deepEqual(loaded, { name: '神荒武界', count: 1 });
});

test('JsonStore returns fallback when file is missing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-store-'));
  const store = new JsonStore(root);
  const loaded = await store.read('missing.json', { ok: true });
  assert.deepEqual(loaded, { ok: true });
});

test('JsonStore blocks path traversal', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-store-'));
  const store = new JsonStore(root);
  await assert.rejects(() => store.write('../escape.json', {}), /Path escapes store root/);
});
