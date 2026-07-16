import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSemver, normalizeSemver, satisfiesSemver } from '../server/lib/semver.js';

test('semver normalizes and compares stable versions', () => {
  assert.equal(normalizeSemver('v0.2.2'), '0.2.2');
  assert.equal(compareSemver('0.2.2', '0.2.1'), 1);
  assert.equal(compareSemver('1.0.0-beta.1', '1.0.0'), -1);
});

test('semver ranges support engine, caret, tilde and wildcard contracts', () => {
  assert.equal(satisfiesSemver('0.2.2', '>=0.2.2 <1.0.0'), true);
  assert.equal(satisfiesSemver('0.3.0', '^0.2.2'), false);
  assert.equal(satisfiesSemver('1.2.9', '~1.2.3'), true);
  assert.equal(satisfiesSemver('1.3.0', '~1.2.3'), false);
  assert.equal(satisfiesSemver('1.8.2', '1.x'), true);
  assert.equal(satisfiesSemver('2.0.0', '1.x'), false);
});
