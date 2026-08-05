import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createPackCompatibilityManager,
  getPackCompatibilityAudit,
  isPackStartBlocked,
  mergePackCompatibilityOverview
} from '../public/modules/packCompatibility.js';

test('pack compatibility overview merges native and custom status without guessing missing audits', () => {
  const packs = mergePackCompatibilityOverview([
    { id: 'xuanhuan', title: '原生', custom: false },
    { id: 'custom-audited', title: '已审核', custom: true },
    { id: 'custom-unknown', title: '未知', custom: true }
  ], {
    packs: [{
      packId: 'custom-audited',
      status: 'safe-derivative',
      label: '安全派生已审核',
      canStartNewStory: true,
      disabledCapabilityCount: 2
    }]
  });

  assert.equal(getPackCompatibilityAudit(packs[0]).status, 'native');
  assert.equal(getPackCompatibilityAudit(packs[1]).status, 'safe-derivative');
  assert.equal(isPackStartBlocked(packs[1]), false);
  assert.equal(getPackCompatibilityAudit(packs[2]).status, 'unavailable');
  assert.equal(isPackStartBlocked(packs[2]), true);
});

test('pack compatibility manager creates a new reviewed pack without approving scripts', async () => {
  const requests = [];
  const statuses = [];
  const refreshed = [];
  const preview = {
    sourcePack: { id: 'custom-legacy', title: '历史卷' },
    rebuildable: true,
    resourceRevisionChanges: [{ resourceId: 'character-1', changed: true }],
    requiresScriptApproval: false,
    compatibilityReview: {
      fingerprint: 'sha256:review',
      requiresCompatibilityAcknowledgement: true,
      blockers: [{ id: 'tavern-helper', label: '酒馆助手运行时' }]
    }
  };
  const manager = createPackCompatibilityManager({
    apiRequest: async (path, options) => {
      requests.push([path, options]);
      return options
        ? { pack: { id: 'custom-new', title: '历史卷 · 兼容复审版' } }
        : { preview };
    },
    onRefresh: (result) => refreshed.push(result),
    confirmAction: () => true
  });

  const result = await manager.act({
    id: 'custom-legacy',
    title: '历史卷',
    custom: true,
    compatibilityAudit: { status: 'upgrade-available', action: 'upgrade' }
  }, {
    reportStatus: (message, tone) => statuses.push({ message, tone })
  });

  assert.equal(result.kind, 'created');
  assert.deepEqual(requests, [
    ['/api/resource-library/packs/custom-legacy/compatibility-upgrade', undefined],
    ['/api/resource-library/packs/custom-legacy/compatibility-upgrade', {
      method: 'POST',
      body: {
        compatibilityReview: {
          fingerprint: 'sha256:review',
          approvedScriptHashes: [],
          acknowledgeCompatibility: true
        }
      }
    }]
  ]);
  assert.equal(refreshed.length, 1);
  assert.match(statuses.at(-1).message, /旧剧本和现有故事保持不变/);
});

test('pack compatibility manager routes scripts to full review and never posts an approval', async () => {
  const requests = [];
  const opened = [];
  const preview = {
    sourcePack: { id: 'custom-script', title: '脚本卷' },
    rebuildable: true,
    requiresScriptApproval: true,
    compatibilityReview: {
      fingerprint: 'sha256:script-review',
      rules: [{ contentHash: 'sha256:script-one', source: 'state.value = 1' }]
    }
  };
  const manager = createPackCompatibilityManager({
    apiRequest: async (path, options) => {
      requests.push([path, options]);
      return { preview };
    },
    onOpenScriptReview: (value) => {
      opened.push(value);
      return true;
    }
  });

  const result = await manager.act({
    id: 'custom-script',
    custom: true,
    compatibilityAudit: { status: 'script-review-required', action: 'review-scripts' }
  });

  assert.equal(result.kind, 'script-review');
  assert.equal(opened.length, 1);
  assert.deepEqual(requests, [[
    '/api/resource-library/packs/custom-script/compatibility-upgrade',
    undefined
  ]]);
});
