import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BackupService } from '../server/services/backupService.js';
import { migrateData } from '../server/data/migrations.js';
import { APP_VERSION, DATA_SCHEMA_VERSION, MIN_NODE_MAJOR } from '../server/releaseInfo.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(path.join(rootDir, 'package.json'), 'utf8'));
const nodeMajor = Number(process.versions.node.split('.')[0]);
const requiredFiles = [
  'public/index.html',
  'public/app.js',
  'public/styles.css',
  'server/index.js',
  'server/app.js',
  'server/data/migrations.js',
  'server/services/backupService.js',
  'scripts/start-local.sh',
  '启动本地角色扮演.command',
  'docs/release-v0.1.md'
];

assert(nodeMajor >= MIN_NODE_MAJOR, `Node.js ${MIN_NODE_MAJOR}+ required; current ${process.versions.node}`);
assert(packageJson.version === APP_VERSION, `package version ${packageJson.version} does not match ${APP_VERSION}`);
for (const relativePath of requiredFiles) await access(path.join(rootDir, relativePath));

for (const relativePath of ['scripts/start-local.sh', '启动本地角色扮演.command']) {
  const info = await stat(path.join(rootDir, relativePath));
  assert((info.mode & 0o111) !== 0, `${relativePath} is not executable`);
}

const migration = await migrateData({ rootDir });
assert(migration.currentVersion === DATA_SCHEMA_VERSION, `data schema is ${migration.currentVersion}`);
const backupState = await new BackupService({ rootDir }).listBackups();

console.log(`v${APP_VERSION} 发布基线检查通过`);
console.log(`Node.js ${process.versions.node}`);
console.log(`数据版本 v${migration.currentVersion}`);
console.log(`有效备份 ${backupState.backups.length}，无效备份 ${backupState.invalidCount}`);

function assert(condition, message) {
  if (!condition) throw new Error(`RELEASE_CHECK_FAILED: ${message}`);
}
