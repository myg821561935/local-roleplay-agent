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
  'server/services/resourceLibraryService.js',
  'server/services/worldSimulationService.js',
  'server/simulation/actionProtocol.js',
  'server/simulation/eventLedger.js',
  'server/simulation/npcSimulation.js',
  'server/simulation/worldStateArbiter.js',
  'server/resources/resourceAdapters.js',
  'server/resources/resourceEvaluator.js',
  'server/resources/communityDependencyScanner.js',
  'server/compat/compatibilityPolicy.js',
  'server/compat/declarativeLifecycle.js',
  'server/compat/lifecyclePolicy.js',
  'server/compat/lightFrontendRuntime.js',
  'server/compat/mvuProtocol.js',
  'server/content/contentPackManifest.js',
  'server/plugins/pluginManifest.js',
  'server/services/pluginRegistryService.js',
  'scripts/start-local.sh',
  'scripts/stop-local.sh',
  'start-local.command',
  'stop-local.command',
  'docs/release-v0.2.md',
  'docs/release-v0.2.1.md',
  'docs/release-v0.2.2.md',
  'docs/release-v0.4.md',
  'docs/release-v0.4.1-rc.1.md',
  'docs/release-v0.5.0-rc.1.md',
  'docs/release-v0.5.0.md',
  'docs/action-protocol-v1.md',
  'docs/content-pack-spec-v1.md',
  'docs/plugin-manifest-spec-v1.md',
  'docs/light-frontend-runtime-v1.md',
  'docs/tavern-compatibility-policy-v1.md',
  'tests/tavernCompatibility.test.js',
  'tests/fixtures/compatibility/README.md'
];

assert(nodeMajor >= MIN_NODE_MAJOR, `Node.js ${MIN_NODE_MAJOR}+ required; current ${process.versions.node}`);
assert(packageJson.version === APP_VERSION, `package version ${packageJson.version} does not match ${APP_VERSION}`);
assert(packageJson.scripts?.start === 'zsh scripts/start-local.sh', 'npm start must use the managed start script');
assert(packageJson.scripts?.stop === 'zsh scripts/stop-local.sh', 'npm stop must use the managed stop script');
assert(packageJson.scripts?.restart === 'zsh scripts/stop-local.sh && zsh scripts/start-local.sh', 'npm restart must use the managed lifecycle scripts');
for (const relativePath of requiredFiles) await access(path.join(rootDir, relativePath));

for (const relativePath of [
  'scripts/start-local.sh',
  'scripts/stop-local.sh',
  'start-local.command',
  'stop-local.command'
]) {
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
