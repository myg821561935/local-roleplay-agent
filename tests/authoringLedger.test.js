import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAuthoringLedger,
  normalizeAuthoringLedger,
  renderAuthoringLedgerPrompt,
  summarizeAuthoringLedger
} from '../server/authoring/authoringLedger.js';
import { assemblePrompt } from '../server/agent/promptAssembler.js';

test('authoring ledger normalizes scene boundaries, promises and decisions', () => {
  const ledger = normalizeAuthoringLedger({
    scene: {
      title: '雨夜审问',
      mustReveal: '断魂灯失窃\n守夜人说谎',
      mustHide: ['幕后主使是掌门'],
      forbidden: '不要转成寻宝探险'
    },
    promises: [{ title: '三章内揭示灯芯来历', importance: 'core', status: 'open' }],
    decisions: [{ title: '主使暂不登场', decision: '只通过代理人施压', status: 'active' }]
  });

  assert.deepEqual(ledger.scene.mustReveal, ['断魂灯失窃', '守夜人说谎']);
  assert.equal(ledger.promises[0].importance, 'core');
  assert.equal(ledger.decisions[0].status, 'active');
  assert.deepEqual(summarizeAuthoringLedger(ledger), {
    sceneTitle: '雨夜审问',
    sceneObjective: '',
    openPromises: 1,
    activeDecisions: 1,
    hiddenFacts: 1,
    updatedAt: ''
  });
});

test('authoring ledger prompt only injects active constraints', () => {
  const prompt = renderAuthoringLedgerPrompt({
    scene: { title: '旧档房', objective: '拿到卷宗但不揭穿内应', mustHide: ['内应身份'] },
    promises: [
      { title: '旧案回响', status: 'advanced', importance: 'major' },
      { title: '已经完成', status: 'fulfilled', importance: 'minor' }
    ],
    decisions: [
      { title: '主角控制权', decision: '不代替用户决定主角行动', status: 'active' },
      { title: '旧方向', decision: '废弃', status: 'superseded' }
    ]
  });

  assert.match(prompt, /旧档房/);
  assert.match(prompt, /内应身份/);
  assert.match(prompt, /旧案回响/);
  assert.match(prompt, /不代替用户决定主角行动/);
  assert.doesNotMatch(prompt, /已经完成/);
  assert.doesNotMatch(prompt, /旧方向/);
});

test('prompt assembly includes agent profile and authoring ledger before story context', () => {
  const authoring = createAuthoringLedger();
  authoring.scene.title = '城门夜禁';
  authoring.scene.objective = '在不暴露密诏的前提下通过盘查';
  authoring.scene.forbidden = ['不要转为野外探险'];

  const assembled = assemblePrompt({
    promptModules: [],
    characterCard: { enabled: true, name: '顾怀砚', role: '行人司书吏' },
    worldBook: [],
    memory: {},
    authoring,
    messages: [],
    userMessage: '我走向城门。',
    options: { activeAgentProfileId: 'continuity-guard' }
  });
  const systemPrompt = assembled.messages[0].content;

  assert.match(systemPrompt, /# Agent Profile/);
  assert.match(systemPrompt, /连续性守门人/);
  assert.match(systemPrompt, /# 创作账本（作者约束）/);
  assert.match(systemPrompt, /不要转为野外探险/);
  assert.equal(assembled.sections.agentProfileId, 'continuity-guard');
  assert.equal(assembled.sections.hasAuthoringLedger, true);
});
