import test from 'node:test';
import assert from 'node:assert/strict';
import { applySandboxTransforms } from '../public/modules/sandboxRenderer.js';

test('sandbox transforms do not execute unreviewed rules', () => {
  const rule = createRule();
  const result = applySandboxTransforms('<status>ready</status>', [rule], [], {
    role: 'assistant'
  });

  assert.equal(result.text, '<status>ready</status>');
  assert.equal(result.sandboxFragments.size, 0);
  assert.equal(result.blockedAssessments.length, 1);
});

test('sandbox transforms require a matching hash-bound approval', () => {
  const rule = createRule();
  const stale = applySandboxTransforms('<status>ready</status>', [rule], [{
    scriptId: rule.id,
    contentHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    decision: 'approved',
    policyVersion: 1
  }], { role: 'assistant' });
  const approved = applySandboxTransforms('<status>ready</status>', [rule], [{
    scriptId: rule.id,
    contentHash: rule.contentHash,
    decision: 'approved',
    policyVersion: 1
  }], { role: 'assistant' });

  assert.equal(stale.sandboxFragments.size, 0);
  assert.equal(stale.blockedAssessments.length, 1);
  assert.match(approved.text, /LRA-SANDBOX-FRAGMENT-0/);
  assert.equal(approved.sandboxFragments.size, 1);
  assert.equal(approved.sandboxFragments.get('LRA-SANDBOX-FRAGMENT-0').scriptId, rule.id);
});

function createRule() {
  return {
    id: 'status-script',
    name: '状态面板脚本',
    pattern: '<status>([\\s\\S]*?)</status>',
    flags: 'g',
    replacement: '<script>document.body.textContent = "ok"</script>',
    scope: 'assistant',
    enabled: true,
    requiresSandbox: true,
    contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  };
}
