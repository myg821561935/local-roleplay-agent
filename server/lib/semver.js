const SEMVER_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function parseSemver(value) {
  const match = String(value || '').trim().match(SEMVER_PATTERN);
  if (!match) return null;
  const parsed = {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || ''
  };
  parsed.version = `${parsed.major}.${parsed.minor}.${parsed.patch}${parsed.prerelease ? `-${parsed.prerelease}` : ''}`;
  return parsed;
}

export function normalizeSemver(value, fallback = '') {
  return parseSemver(value)?.version || fallback;
}

export function compareSemver(leftValue, rightValue) {
  const left = parseSemver(leftValue);
  const right = parseSemver(rightValue);
  if (!left || !right) throw new Error('INVALID_SEMVER');
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }
  if (left.prerelease === right.prerelease) return 0;
  if (!left.prerelease) return 1;
  if (!right.prerelease) return -1;
  return left.prerelease.localeCompare(right.prerelease);
}

export function satisfiesSemver(version, range = '*') {
  const parsed = parseSemver(version);
  if (!parsed) return false;
  const normalizedRange = String(range || '*').trim();
  if (!normalizedRange || normalizedRange === '*') return true;
  return normalizedRange
    .split('||')
    .map((item) => item.trim())
    .filter(Boolean)
    .some((alternative) => satisfiesAlternative(parsed.version, alternative));
}

function satisfiesAlternative(version, alternative) {
  const hyphen = alternative.match(/^\s*(v?\d+\.\d+\.\d+)\s+-\s+(v?\d+\.\d+\.\d+)\s*$/);
  if (hyphen) {
    return compareSemver(version, hyphen[1]) >= 0 && compareSemver(version, hyphen[2]) <= 0;
  }

  const tokens = alternative.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  return tokens.every((token) => satisfiesComparator(version, token));
}

function satisfiesComparator(version, token) {
  if (token === '*' || /^x$/i.test(token)) return true;
  const wildcard = token.match(/^v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/i);
  if (wildcard && /[x*]/i.test(token)) {
    const parsed = parseSemver(version);
    if (Number(wildcard[1]) !== parsed.major) return false;
    if (wildcard[2] && !/[x*]/i.test(wildcard[2]) && Number(wildcard[2]) !== parsed.minor) return false;
    if (wildcard[3] && !/[x*]/i.test(wildcard[3]) && Number(wildcard[3]) !== parsed.patch) return false;
    return true;
  }

  if (token.startsWith('^')) return satisfiesCaret(version, token.slice(1));
  if (token.startsWith('~')) return satisfiesTilde(version, token.slice(1));

  const comparator = token.match(/^(>=|<=|>|<|=)?(v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/);
  if (!comparator) return false;
  const relation = comparator[1] || '=';
  const comparison = compareSemver(version, comparator[2]);
  if (relation === '>=') return comparison >= 0;
  if (relation === '<=') return comparison <= 0;
  if (relation === '>') return comparison > 0;
  if (relation === '<') return comparison < 0;
  return comparison === 0;
}

function satisfiesCaret(version, baseValue) {
  const base = parseSemver(baseValue);
  if (!base || compareSemver(version, base.version) < 0) return false;
  let upper;
  if (base.major > 0) upper = `${base.major + 1}.0.0`;
  else if (base.minor > 0) upper = `0.${base.minor + 1}.0`;
  else upper = `0.0.${base.patch + 1}`;
  return compareSemver(version, upper) < 0;
}

function satisfiesTilde(version, baseValue) {
  const base = parseSemver(baseValue);
  if (!base || compareSemver(version, base.version) < 0) return false;
  return compareSemver(version, `${base.major}.${base.minor + 1}.0`) < 0;
}
