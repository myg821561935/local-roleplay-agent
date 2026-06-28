import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
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

test('JsonStore clones fallback values for missing files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-store-'));
  const store = new JsonStore(root);
  const fallback = { nested: { ok: true }, items: [] };

  const firstLoaded = await store.read('missing.json', fallback);
  firstLoaded.nested.ok = false;
  firstLoaded.items.push('changed');

  const secondLoaded = await store.read('missing.json', fallback);
  assert.deepEqual(fallback, { nested: { ok: true }, items: [] });
  assert.deepEqual(secondLoaded, { nested: { ok: true }, items: [] });
});

test('JsonStore blocks path traversal', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-store-'));
  const store = new JsonStore(root);
  await assert.rejects(() => store.write('../escape.json', {}), /Path escapes store root/);
});

test('JsonStore writes pretty JSON with a trailing newline', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-store-'));
  const store = new JsonStore(root);

  await store.write('config/example.json', { name: '神荒武界', count: 1 });

  const raw = await readFile(path.join(root, 'config/example.json'), 'utf8');
  assert.equal(raw, '{\n  "name": "神荒武界",\n  "count": 1\n}\n');
});

test('JsonStore lists missing directories as empty', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-store-'));
  const store = new JsonStore(root);

  const entries = await store.list('missing');

  assert.deepEqual(entries, []);
});
