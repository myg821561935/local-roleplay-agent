import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BackupService } from '../server/services/backupService.js';

test('backup service restores data and creates a pre-restore safety snapshot', async () => {
  const rootDir = await createRoot('agent-backup-');
  const configPath = path.join(rootDir, 'data', 'config', 'character-card.json');
  await writeFile(configPath, '{"name":"旧角色"}\n', 'utf8');
  const service = new BackupService({ rootDir });

  const backup = await service.createBackup({ reason: 'manual-test' });
  await writeFile(configPath, '{"name":"新角色"}\n', 'utf8');
  const result = await service.restoreBackup(backup.id);
  const restored = JSON.parse(await readFile(configPath, 'utf8'));
  const listed = await service.listBackups();

  assert.equal(restored.name, '旧角色');
  assert.equal(result.restored.id, backup.id);
  assert.match(result.safetyBackup.reason, /^pre-restore:/);
  assert.equal(result.dataSchemaVersion, 3);
  assert.equal(listed.backups.length, 2);
  assert.ok(listed.backups.find((item) => item.id === result.safetyBackup.id));
});

test('backup service rejects a tampered snapshot without replacing current data', async () => {
  const rootDir = await createRoot('agent-backup-tampered-');
  const configPath = path.join(rootDir, 'data', 'config', 'character-card.json');
  await writeFile(configPath, '{"name":"原始角色"}\n', 'utf8');
  const service = new BackupService({ rootDir });
  const backup = await service.createBackup();
  const backupPath = path.join(rootDir, 'backups', `${backup.id}.json`);
  const payload = JSON.parse(await readFile(backupPath, 'utf8'));
  payload.files[0].contentBase64 = Buffer.from('tampered').toString('base64');
  await writeFile(backupPath, JSON.stringify(payload), 'utf8');
  await writeFile(configPath, '{"name":"当前角色"}\n', 'utf8');

  await assert.rejects(() => service.restoreBackup(backup.id), /BACKUP_CHECKSUM_MISMATCH/);
  assert.equal(JSON.parse(await readFile(configPath, 'utf8')).name, '当前角色');
});

test('backup service marks snapshots containing provider credentials as sensitive', async () => {
  const rootDir = await createRoot('agent-backup-secrets-');
  const service = new BackupService({ rootDir });

  const cleanBackup = await service.createBackup({ reason: 'without-provider' });
  await writeFile(
    path.join(rootDir, 'data', 'config', 'providers.local.json'),
    JSON.stringify({ providers: [{ id: 'local', apiKey: 'secret' }] }),
    'utf8'
  );
  const sensitiveBackup = await service.createBackup({ reason: 'with-provider' });

  assert.equal(cleanBackup.containsSecrets, false);
  assert.equal(sensitiveBackup.containsSecrets, true);
});

async function createRoot(prefix) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), prefix));
  await mkdir(path.join(rootDir, 'data', 'config'), { recursive: true });
  return rootDir;
}
