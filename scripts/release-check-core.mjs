export function compareVersions(left, right) {
  const leftParts = numericVersionParts(left);
  const rightParts = numericVersionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

export function assertMinimumVersion(current, required, label = 'Node.js') {
  assert(
    compareVersions(current, required) >= 0,
    `${label} ${required}+ required; current ${current}`
  );
}

export function parseTrackedFiles(output) {
  return new Set(String(output || '').split('\0').filter(Boolean));
}

export function findUntrackedRequiredFiles(requiredFiles, trackedFiles) {
  return requiredFiles.filter((relativePath) => !trackedFiles.has(relativePath));
}

export function assertRequiredFilesTracked(requiredFiles, trackedFiles) {
  const missing = findUntrackedRequiredFiles(requiredFiles, trackedFiles);
  assert(
    missing.length === 0,
    `release files are not tracked by Git (${missing.length}): ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ', ...' : ''}`
  );
}

export function summarizeGitStatus(output) {
  const source = String(output || '');
  const records = source.includes('\0') ? source.split('\0') : source.split(/\r?\n/);
  const summary = {
    total: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0
  };

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.length < 3) continue;
    const x = record[0];
    const y = record[1];
    const pair = `${x}${y}`;
    if (pair === '!!') continue;

    summary.total += 1;
    if (pair === '??') {
      summary.untracked += 1;
    } else {
      if (x !== ' ') summary.staged += 1;
      if (y !== ' ') summary.unstaged += 1;
      if (['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(pair)) summary.conflicted += 1;
    }

    if (source.includes('\0') && ['R', 'C'].includes(x)) index += 1;
  }

  return summary;
}

export function assertCleanReleaseWorkspace(statusOutput) {
  const summary = summarizeGitStatus(statusOutput);
  assert(
    summary.total === 0,
    `Git workspace is not clean: total ${summary.total}, staged ${summary.staged}, unstaged ${summary.unstaged}, untracked ${summary.untracked}, conflicted ${summary.conflicted}`
  );
  return summary;
}

export function assert(condition, message) {
  if (!condition) throw new Error(`RELEASE_CHECK_FAILED: ${message}`);
}

function numericVersionParts(version) {
  const core = String(version || '').trim().replace(/^v/, '').split('-', 1)[0];
  if (!/^\d+(?:\.\d+)*$/.test(core)) {
    throw new Error(`RELEASE_CHECK_FAILED: invalid version ${version}`);
  }
  return core.split('.').map(Number);
}
