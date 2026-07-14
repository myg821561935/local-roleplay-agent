import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNarrativeControlPrompt,
  buildNarrativeMaintenanceAnchor,
  normalizeNarrativeMode,
  resolveNarrativeContext
} from '../server/agent/narrativeControl.js';
import { getContentPack } from '../server/config/contentPacks.js';

function xianxiaMemory(overrides = {}) {
  return {
    worldState: {
      quests: [{ id: 'main', title: '查清听雪峰旧案', status: 'active' }],
      flags: { genre: 'xianxia', currentPhase: '望舒仙市' }
    },
    ruleSystem: {
      contentPackId: 'xianxia',
      boundary: '只使用太虚仙侠规则。'
    },
    ...overrides
  };
}

test('stable mode keeps secondary scenes subordinate to the xianxia route', () => {
  const prompt = buildNarrativeControlPrompt({ memory: xianxiaMemory(), mode: 'stable' });

  assert.match(prompt, /叙事路线锁（稳定模式）/);
  assert.match(prompt, /当前主线：查清听雪峰旧案/);
  assert.match(prompt, /家族和师承的代际传承/);
  assert.match(prompt, /资源权属/);
  assert.match(prompt, /最多连续 2 轮/);
  assert.match(prompt, /不能因为场景发生在荒野、遗迹或密室/);
});

test('strict mode requires every turn to advance a pillar and limits detours to one turn', () => {
  const prompt = buildNarrativeControlPrompt({ memory: xianxiaMemory(), mode: 'strict' });

  assert.match(prompt, /最多连续 1 轮/);
  assert.match(prompt, /每轮正文必须明确推进当前主线或一个题材支柱/);
  assert.match(prompt, /除非用户明确提出/);
});

test('free mode allows an explicit genre pivot while preserving established facts', () => {
  const prompt = buildNarrativeControlPrompt({ memory: xianxiaMemory(), mode: 'free' });

  assert.match(prompt, /自由模式/);
  assert.match(prompt, /允许用户主动跨类型或更换主线/);
  assert.doesNotMatch(prompt, /最多连续/);
});

test('narrative state active arc takes precedence over the first active quest', () => {
  const context = resolveNarrativeContext({
    memory: xianxiaMemory({
      narrativeState: { activeArc: '青禾灵田族产争议' }
    }),
    mode: 'stable'
  });

  assert.equal(context.activeArc, '青禾灵田族产争议');
  assert.equal(context.genre, 'xianxia');
  assert.match(buildNarrativeMaintenanceAnchor(context), /青禾灵田族产争议/);
});

test('unknown narrative mode falls back to stable', () => {
  assert.equal(normalizeNarrativeMode('anything'), 'stable');
});

test('every content pack supplies its own route contract to narrative control', () => {
  const packIds = ['xuanhuan', 'lingyi', 'mingmo', 'xianxia', 'yingxiongzhi'];

  for (const packId of packIds) {
    const pack = getContentPack(packId);
    const memory = { ...pack.memory, ruleSystem: pack.ruleSystem };
    const context = resolveNarrativeContext({ memory, mode: 'stable' });
    const prompt = buildNarrativeControlPrompt({ memory, mode: 'stable' });

    assert.equal(context.genre, packId);
    assert.equal(context.activeArc, pack.memory.narrativeState.activeArc);
    assert.deepEqual(context.pillars, pack.memory.narrativeState.corePillars);
    assert.deepEqual(context.forbiddenDominance, pack.memory.narrativeState.forbiddenDominance);
    assert.match(prompt, new RegExp(pack.memory.narrativeState.corePillars[0]));
    assert.match(prompt, /本剧本回流规则/);
    assert.match(prompt, /这些支线不得自行升级为新主线/);
  }
});
