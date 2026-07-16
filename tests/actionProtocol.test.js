import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_PROTOCOL_SPEC,
  ActionProtocolError,
  extractActionEnvelope,
  normalizeActionEnvelope
} from '../server/simulation/actionProtocol.js';

test('action protocol extracts a hidden action envelope from narrative text', () => {
  const result = extractActionEnvelope([
    '门锁发出一声轻响，旧铜钥匙落入掌心。',
    '```lra-actions',
    JSON.stringify({
      spec: ACTION_PROTOCOL_SPEC,
      baseRevision: 2,
      actorId: 'narrator',
      actions: [{ type: 'state.append', path: 'protagonist.inventory', value: '旧铜钥匙', reason: '已拾取' }]
    }),
    '```'
  ].join('\n'));

  assert.equal(result.content, '门锁发出一声轻响，旧铜钥匙落入掌心。');
  assert.equal(result.error, null);
  assert.equal(result.envelope.spec, ACTION_PROTOCOL_SPEC);
  assert.equal(result.envelope.baseRevision, 2);
  assert.equal(result.envelope.actions[0].path, 'protagonist.inventory');
});

test('action protocol rejects executable paths and unsupported action types', () => {
  assert.throws(
    () => normalizeActionEnvelope({ actions: [{ type: 'state.set', path: '__proto__.polluted', value: true }] }),
    ActionProtocolError
  );
  assert.throws(
    () => normalizeActionEnvelope({ actions: [{ type: 'shell.execute', command: 'rm -rf' }] }),
    /ACTION_TYPE_UNSUPPORTED/
  );
});

test('malformed action JSON is hidden from visible reply and returned as an error', () => {
  const result = extractActionEnvelope('正文\n```lra-actions\n{bad json\n```');
  assert.equal(result.content, '正文');
  assert.equal(result.envelope, null);
  assert.equal(result.error.code, 'ACTION_JSON_INVALID');
});
