import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { migrateData, readDataSchemaStatus } from '../server/data/migrations.js';

test('data migrations establish the v0.4 schema and are idempotent', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'agent-migration-'));
  await mkdir(path.join(rootDir, 'data', 'config'), { recursive: true });
  await writeFile(path.join(rootDir, 'data', 'config', 'example.json'), '{"ok":true}\n', 'utf8');

  const first = await migrateData({ rootDir });
  const second = await migrateData({ rootDir });
  const status = await readDataSchemaStatus(rootDir);

  assert.deepEqual(first.applied, [
    '0001-v0.1-release-baseline',
    '0002-v0.2-resource-library',
    '0003-v0.4-world-simulation'
  ]);
  assert.deepEqual(second.applied, []);
  assert.equal(status.currentVersion, 3);
  assert.equal(status.ready, true);
  assert.equal(JSON.parse(await readFile(path.join(rootDir, 'data', '.schema.json'), 'utf8')).schemaVersion, 3);
});

test('v0.4 migration preserves legacy story data and adds replay baselines', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'agent-migration-v04-'));
  const sessionDir = path.join(rootDir, 'data', 'sessions');
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    path.join(rootDir, 'data', '.schema.json'),
    '{"schemaVersion":2,"appVersion":"0.2.2","migrations":[]}\n',
    'utf8'
  );
  await writeFile(
    path.join(sessionDir, 'main.json'),
    JSON.stringify({
      id: 'main',
      messages: [{ id: 'a1', role: 'assistant', content: '旧剧情仍在。' }],
      memory: {
        rollingSummary: '旧章摘要',
        worldState: { protagonist: { name: '沈砚', inventory: ['旧刀'] }, flags: { sealed: true } },
        eventLedger: [{ id: 'legacy-event', kind: 'turn', summary: '旧事件' }]
      }
    }),
    'utf8'
  );

  const result = await migrateData({ rootDir });
  const session = JSON.parse(await readFile(path.join(sessionDir, 'main.json'), 'utf8'));

  assert.deepEqual(result.applied, ['0003-v0.4-world-simulation']);
  assert.equal(session.messages[0].content, '旧剧情仍在。');
  assert.equal(session.memory.rollingSummary, '旧章摘要');
  assert.deepEqual(session.memory.worldState.protagonist.inventory, ['旧刀']);
  assert.equal(session.memory.eventLedger[0].id, 'legacy-event');
  assert.equal(session.memory.simulation.spec, 'lra.simulation/v1');
  assert.deepEqual(session.memory.worldStateBaseline, session.memory.worldState);
  assert.deepEqual(session.memory.simulationBaseline, session.memory.simulation);
  assert.equal(session.memory.actionCheckpointMessageId, '');
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

  await assert.rejects(() => migrateData({ rootDir }), /DATA_SCHEMA_NEWER_THAN_APP:99>3/);
});
