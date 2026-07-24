import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const execFileAsync = promisify(execFile);

export const LOCAL_ONLY_PREFIXES = Object.freeze([
  '.runtime/',
  'backups/',
  'data/assets/',
  'data/community/',
  'data/config/',
  'data/content-packs-local/',
  'data/exports/',
  'data/imports/',
  'data/library/',
  'data/private-content/',
  'data/projects/',
  'data/sessions/',
  'local-content/',
  'private-content/',
  'work/'
]);

export const LOCAL_ONLY_FILES = Object.freeze([
  'data/.schema.json'
]);

export function findLocalOnlyTrackedPaths(paths = []) {
  return [...new Set(paths
    .map((item) => String(item || '').trim().replaceAll('\\', '/'))
    .filter(Boolean)
    .filter((item) => LOCAL_ONLY_FILES.includes(item)
      || LOCAL_ONLY_PREFIXES.some((prefix) => item.startsWith(prefix))))]
    .sort((left, right) => left.localeCompare(right));
}

async function listGitPaths(rootDir, args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  });
  return stdout.split('\0').filter(Boolean);
}

export async function checkPublicRepository(rootDir) {
  const tracked = await listGitPaths(rootDir, ['ls-files', '-z']);
  const staged = await listGitPaths(rootDir, ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']);
  const violations = findLocalOnlyTrackedPaths([...tracked, ...staged]);
  return { trackedCount: tracked.length, stagedCount: staged.length, violations };
}

async function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = await checkPublicRepository(rootDir);
  if (result.violations.length > 0) {
    console.error('仓库内容边界检查失败：以下本机或第三方内容正被 Git 跟踪：');
    for (const file of result.violations) console.error(`- ${file}`);
    console.error('请保留本机文件，并使用 git rm --cached <path> 取消跟踪后再提交。');
    process.exitCode = 1;
    return;
  }
  console.log(`仓库内容边界检查通过：${result.trackedCount} 个已跟踪文件，${result.stagedCount} 个暂存新增/修改文件。`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
