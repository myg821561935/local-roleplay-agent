import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMvuPatchEnvelope,
  buildMvuPatchPrompt,
  extractMvuPatchEnvelope,
  replayMvuHistory
} from '../server/compat/mvuProtocol.js';

test('MVU protocol extracts hidden patches and applies revisioned operations', () => {
  const parsed = extractMvuPatchEnvelope([
    '雨声压低了檐下的交谈。',
    '```lra-mvu-patch',
    JSON.stringify({
      expectedRevision: 2,
      summary: '信任上升',
      operations: [
        { op: 'increment', path: 'relationships.shen.trust', value: 2 },
        { op: 'set', path: 'scene.alert', value: true }
      ]
    }),
    '```'
  ].join('\n'));

  assert.equal(parsed.content, '雨声压低了檐下的交谈。');
  const applied = applyMvuPatchEnvelope({
    enabled: true,
    revision: 2,
    values: { relationships: { shen: { trust: 10 } } }
  }, parsed.envelope);
  assert.equal(applied.state.revision, 3);
  assert.equal(applied.state.values.relationships.shen.trust, 12);
  assert.equal(applied.state.values.scene.alert, true);
});

test('MVU protocol rejects stale revisions without mutating the source state', () => {
  const current = { enabled: true, revision: 4, values: { clues: 1 } };
  assert.throws(() => applyMvuPatchEnvelope(current, {
    expectedRevision: 3,
    operations: [{ op: 'increment', path: 'clues', value: 1 }]
  }), /MVU_REVISION_CONFLICT/);
  assert.deepEqual(current.values, { clues: 1 });
});

test('MVU prompt is only injected for enabled light frontend state', () => {
  assert.equal(buildMvuPatchPrompt({ memory: {} }), '');
  const prompt = buildMvuPatchPrompt({
    memory: { lightFrontendState: { enabled: true, revision: 5, values: { clues: 2 } } }
  });
  assert.match(prompt, /当前 MVU 修订号：5/);
  assert.match(prompt, /lra-mvu-patch/);
  assert.match(prompt, /set、increment、delete/);
  assert.match(prompt, /不要输出 JavaScript/);
});

test('MVU history replay follows the selected message branch', () => {
  const baseline = { enabled: true, revision: 0, values: { clues: 0 } };
  const firstPatch = {
    expectedRevision: 0,
    operations: [{ op: 'increment', path: 'clues', value: 1 }]
  };
  const replayed = replayMvuHistory({
    memory: { lightFrontendBaseline: baseline, lightFrontendState: baseline },
    messages: [
      { role: 'user', content: '搜索现场。' },
      { role: 'assistant', content: '找到一条线索。', mvuPatches: [firstPatch] }
    ]
  });

  assert.equal(replayed.state.revision, 1);
  assert.equal(replayed.state.values.clues, 1);
  assert.deepEqual(replayed.errors, []);
});
