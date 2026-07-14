import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { migrateData, readDataSchemaStatus } from '../server/data/migrations.js';

test('data migrations establish the v0.1 schema and are idempotent', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'agent-migration-'));
  await mkdir(path.join(rootDir, 'data', 'config'), { recursive: true });
  await writeFile(path.join(rootDir, 'data', 'config', 'example.json'), '{"ok":true}\n', 'utf8');

  const first = await migrateData({ rootDir });
  const second = await migrateData({ rootDir });
  const status = await readDataSchemaStatus(rootDir);

  assert.deepEqual(first.applied, ['0001-v0.1-release-baseline']);
  assert.deepEqual(second.applied, []);
  assert.equal(status.currentVersion, 1);
  assert.equal(status.ready, true);
  assert.equal(JSON.parse(await readFile(path.join(rootDir, 'data', '.schema.json'), 'utf8')).schemaVersion, 1);
});

test('data migration stops before versioning invalid JSON', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'agent-migration-invalid-'));
  await mkdir(path.join(rootDir, 'data', 'sessions'), { recursive: true });
  await writeFile(path.join(rootDir, 'data', 'sessions', 'broken.json'), '{bad-json', 'utf8');

  await assert.rejects(
    () => migrateData({ rootDir }),
    /DATA_JSON_INVALID:sessions\/broken\.json/
  );
  const status = await readDataSchemaStatus(rootDir);
  assert.equal(status.currentVersion, 0);
});

test('data migration refuses a schema newer than the application', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'agent-migration-newer-'));
  await mkdir(path.join(rootDir, 'data'), { recursive: true });
  await writeFile(path.join(rootDir, 'data', '.schema.json'), '{"schemaVersion":99}\n', 'utf8');

  await assert.rejects(() => migrateData({ rootDir }), /DATA_SCHEMA_NEWER_THAN_APP:99>1/);
});
