import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { retrieveCards } from '../server/agent/memoryRetriever.js';
import { scanCommunityDependencies } from '../server/resources/communityDependencyScanner.js';
import { extractLightFrontendRuntime } from '../server/compat/lightFrontendRuntime.js';
import { executeDeclarativeLifecycle } from '../server/compat/declarativeLifecycle.js';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'compatibility');

const benchmarkCases = [
  ['plain-text-card.json', {
    outcome: 'full-mapping', counts: { supported: 1, degraded: 0, missing: 0 }, differences: [], blockers: []
  }],
  ['regex-card.json', {
    outcome: 'full-mapping', counts: { supported: 3, degraded: 0, missing: 0 }, differences: [], blockers: []
  }],
  ['quick-reply-card.json', {
    outcome: 'safe-degradation', counts: { supported: 2, degraded: 1, missing: 0 }, differences: ['stscript'], blockers: []
  }],
  ['mvu-card.json', {
    outcome: 'full-mapping', counts: { supported: 3, degraded: 0, missing: 0 }, differences: [], blockers: []
  }],
  ['static-heavy-frontend-card.json', {
    outcome: 'full-mapping', counts: { supported: 2, degraded: 0, missing: 0 }, differences: [], blockers: []
  }],
  ['blocked-dynamic-card.json', {
    outcome: 'blocked', counts: { supported: 1, degraded: 0, missing: 2 }, differences: [], blockers: ['executable-extension', 'custom-html-ui']
  }]
];

for (const [fileName, expected] of benchmarkCases) {
  test(`compatibility benchmark: ${fileName} => ${expected.outcome}`, async () => {
    const payload = JSON.parse(await readFile(join(fixtureDir, fileName), 'utf8'));
    const report = scanCommunityDependencies(payload, { kind: 'character' });
    const snapshot = {
      outcome: report.acceptance.outcome,
      counts: report.counts,
      differences: report.acceptance.differences.map((item) => item.id),
      blockers: report.acceptance.blockers.map((item) => item.id)
    };

    assert.deepEqual(snapshot, expected);
    assert.equal(report.acceptance.canStore, true);
    assert.equal(report.acceptance.executesThirdPartyCode, false);
    assert.equal(report.acceptance.canRun, expected.outcome !== 'blocked');
  });
}

test('selectiveLogic applies all four SillyTavern secondary-key filters', () => {
  const base = {
    title: '选择逻辑',
    keywords: ['主词'],
    secondaryKeywords: ['甲', '乙'],
    matchMode: 'selective',
    content: '命中',
    enabled: true
  };
  const hit = (logic, query) => retrieveCards({
    query,
    worldBook: [{ ...base, logic }],
    maxCards: 2,
    maxRecursionDepth: 0
  }).length === 1;

  assert.equal(hit('and_any', '主词 甲'), true);
  assert.equal(hit('and_any', '主词'), false);
  assert.equal(hit('and_all', '主词 甲 乙'), true);
  assert.equal(hit('and_all', '主词 甲'), false);
  assert.equal(hit('not_any', '主词'), true);
  assert.equal(hit('not_any', '主词 甲'), false);
  assert.equal(hit('not_all', '主词 甲'), true);
  assert.equal(hit('not_all', '主词 甲 乙'), false);
});

test('bounded lifecycle applies allowlisted patches and rolls back the whole event on failure', () => {
  const runtime = extractLightFrontendRuntime({
    extensions: {
      mvu: { values: { relationships: { guide: { trust: 1 } } } },
      lifecycle: {
        onUser: [
          { op: 'increment', path: 'relationships.guide.trust', amount: 2 }
        ]
      }
    }
  });
  const applied = executeDeclarativeLifecycle({
    runtime,
    event: 'onUser',
    currentState: runtime.mvu
  });
  assert.equal(applied.report.status, 'applied');
  assert.equal(applied.state.values.relationships.guide.trust, 3);

  const blockedRuntime = {
    lifecycle: {
      events: {
        onUser: [
          { op: 'set', path: 'relationships.guide.trust', value: 9 },
          { op: 'set', path: 'system.secrets', value: true }
        ]
      }
    }
  };
  const rolledBack = executeDeclarativeLifecycle({
    runtime: blockedRuntime,
    event: 'onUser',
    currentState: runtime.mvu
  });
  assert.equal(rolledBack.report.status, 'rolled-back');
  assert.deepEqual(rolledBack.state, runtime.mvu);
});

test('lifecycle budgets reject excessive event executions without mutating state', () => {
  const runtime = {
    lifecycle: {
      events: {
        onAssistant: [{ op: 'increment', path: 'variables.turns', amount: 1 }]
      }
    }
  };
  const state = { enabled: true, values: { variables: { turns: 0 } }, revision: 0 };

  assert.throws(() => executeDeclarativeLifecycle({
    runtime,
    event: 'onAssistant',
    currentState: state,
    executions: 9
  }), /LIFECYCLE_EXECUTION_BUDGET_EXCEEDED/);
  assert.equal(state.values.variables.turns, 0);
});

test('lifecycle recursion and change budgets fail closed instead of silently truncating', () => {
  const state = { enabled: true, values: { variables: { turns: 0 } }, revision: 0 };
  const tooDeep = {
    lifecycle: {
      events: {
        onUser: {
          steps: [{ steps: [{ steps: [{ steps: [{ steps: [{ steps: [
            { op: 'increment', path: 'variables.turns', amount: 1 }
          ] }] }] }] }] }]
        }
      }
    }
  };
  const tooMany = {
    lifecycle: {
      events: {
        onAssistant: Array.from({ length: 33 }, () => ({
          op: 'increment',
          path: 'variables.turns',
          amount: 1
        }))
      }
    }
  };

  const depthResult = executeDeclarativeLifecycle({
    runtime: tooDeep,
    event: 'onUser',
    currentState: state
  });
  const countResult = executeDeclarativeLifecycle({
    runtime: tooMany,
    event: 'onAssistant',
    currentState: state
  });

  assert.equal(depthResult.report.status, 'rolled-back');
  assert.equal(depthResult.report.error.code, 'lifecycle-recursion-blocked');
  assert.deepEqual(depthResult.state, state);
  assert.equal(countResult.report.status, 'rolled-back');
  assert.equal(countResult.report.error.code, 'lifecycle-change-budget-truncated');
  assert.deepEqual(countResult.state, state);
});
