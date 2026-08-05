import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertCleanReleaseWorkspace,
  assertMinimumVersion,
  assertRequiredFilesTracked,
  compareVersions,
  parseTrackedFiles,
  summarizeGitStatus
} from '../scripts/release-check-core.mjs';

test('release gate compares full Node versions instead of major only', () => {
  assert.equal(compareVersions('22.13.0', '22.13.0'), 0);
  assert.equal(compareVersions('22.12.9', '22.13.0'), -1);
  assert.equal(compareVersions('23.0.0', '22.13.0'), 1);
  assert.doesNotThrow(() => assertMinimumVersion('22.13.1', '22.13.0'));
  assert.throws(
    () => assertMinimumVersion('22.12.9', '22.13.0'),
    /Node\.js 22\.13\.0\+ required/
  );
});

test('release gate requires every signed file to be tracked', () => {
  const tracked = parseTrackedFiles('README.md\0server/app.js\0');
  assert.doesNotThrow(() => assertRequiredFilesTracked(['README.md'], tracked));
  assert.throws(
    () => assertRequiredFilesTracked(['README.md', 'docs/release.md'], tracked),
    /docs\/release\.md/
  );
});

test('release gate summarizes staged, unstaged, untracked and conflicted entries', () => {
  const status = [
    'M  staged.js',
    ' M unstaged.js',
    '?? local.js',
    'UU conflict.js'
  ].join('\0') + '\0';
  assert.deepEqual(summarizeGitStatus(status), {
    total: 4,
    staged: 2,
    unstaged: 2,
    untracked: 1,
    conflicted: 1
  });
});

test('release gate rejects any dirty workspace and accepts a clean one', () => {
  assert.deepEqual(assertCleanReleaseWorkspace(''), {
    total: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0
  });
  assert.throws(
    () => assertCleanReleaseWorkspace(' M README.md\0'),
    /Git workspace is not clean: total 1/
  );
});
