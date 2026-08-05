import test from 'node:test';
import assert from 'node:assert/strict';

import { createSessionHealthController } from '../public/modules/sessionHealth.js';

test('session health controller refreshes the active session and opens script audit from a finding', async () => {
  const documentObject = { createElement: (tagName) => new FakeElement(tagName) };
  const els = {
    sessionHealthSummary: new FakeElement('div'),
    sessionHealthList: new FakeElement('div'),
    sessionHealthStatus: new FakeElement('span'),
    refreshSessionHealth: new FakeElement('button'),
    referenceRepairSummary: new FakeElement('p'),
    previewReferenceRepair: new FakeElement('button'),
    applyReferenceRepair: new FakeElement('button'),
    sessionConfigMigrationSummary: new FakeElement('p'),
    previewSessionConfigMigration: new FakeElement('button'),
    applySessionConfigMigration: new FakeElement('button')
  };
  const report = {
    status: 'warning',
    summary: { errors: 0, warnings: 1, passes: 5 },
    checks: [{
      category: '第三方脚本',
      status: 'warning',
      title: '1 个第三方脚本等待审核',
      detail: '本次不会执行。',
      evidence: ['社区面板：尚未审核'],
      action: { kind: 'open-script-audit', scriptIds: ['community-panel'] }
    }]
  };
  const state = {};
  const requests = [];
  const audits = [];
  const controller = createSessionHealthController({
    state,
    els,
    apiRequest: async (path) => {
      requests.push(path);
      if (path === '/api/reference-repairs/orphans') {
        return {
          plan: {
            planId: 'plan-1',
            requiresConfirmation: false,
            summary: { sessionsScanned: 2, projectsScanned: 1, sessionUpdates: 0, projectUpdates: 0 }
          }
        };
      }
      if (path === '/api/session-config-migrations/incomplete') {
        return {
          plan: {
            planId: 'config-plan-1',
            requiresConfirmation: false,
            summary: { sessionsScanned: 2, sessionUpdates: 0, fieldChanges: 0, manualReviewSessions: 0 }
          }
        };
      }
      return { health: report };
    },
    getSessionId: () => 'story/一',
    setStatus: (element, value, tone) => {
      element.textContent = `${tone}:${value}`;
    },
    onOpenScriptAudit: (items) => audits.push(items),
    documentObject
  });

  assert.equal(controller.bindEvents(), true);
  assert.equal(controller.bindEvents(), false);
  await els.refreshSessionHealth.dispatch('click');

  assert.deepEqual(requests, [
    '/api/sessions/story%2F%E4%B8%80/health',
    '/api/reference-repairs/orphans',
    '/api/session-config-migrations/incomplete'
  ]);
  assert.equal(state.sessionHealth, report);
  assert.equal(els.sessionHealthSummary.children.length, 1);
  assert.equal(els.sessionHealthList.children.length, 1);
  const evidence = els.sessionHealthList.children[0].children.find((item) => item.tagName === 'details');
  assert.equal(evidence.children[0].textContent, '查看记录（1）');
  assert.equal(evidence.children[1].children[0].textContent, '社区面板：尚未审核');
  const actionButton = els.sessionHealthList.children[0].children.at(-1);
  await els.sessionHealthList.dispatch('click', {
    target: { closest: () => actionButton }
  });
  assert.deepEqual(audits, [[{ id: 'community-panel' }]]);
  assert.match(els.referenceRepairSummary.textContent, /未发现孤儿引用/);
  assert.equal(els.applyReferenceRepair.disabled, true);
  assert.match(els.sessionConfigMigrationSummary.textContent, /全部会话都已持有独立配置/);
  assert.equal(els.applySessionConfigMigration.disabled, true);
});

test('session config migration previews a scoped plan and refreshes health after backup', async () => {
  const documentObject = { createElement: (tagName) => new FakeElement(tagName) };
  const els = {
    sessionHealthSummary: new FakeElement('div'),
    sessionHealthList: new FakeElement('div'),
    sessionHealthStatus: new FakeElement('span'),
    refreshSessionHealth: new FakeElement('button'),
    sessionConfigMigrationSummary: new FakeElement('p'),
    previewSessionConfigMigration: new FakeElement('button'),
    applySessionConfigMigration: new FakeElement('button')
  };
  const plan = {
    planId: 'config-plan',
    requiresConfirmation: true,
    summary: {
      sessionsScanned: 28,
      incompleteSessions: 22,
      sessionUpdates: 22,
      fieldChanges: 32,
      manualReviewSessions: 0
    }
  };
  const cleanPlan = {
    planId: 'config-clean',
    requiresConfirmation: false,
    summary: {
      sessionsScanned: 28,
      incompleteSessions: 0,
      sessionUpdates: 0,
      fieldChanges: 0,
      manualReviewSessions: 0
    }
  };
  const report = { status: 'healthy', summary: { errors: 0, warnings: 0, passes: 6 }, checks: [] };
  const requests = [];
  const confirmations = [];
  const state = {};
  const controller = createSessionHealthController({
    state,
    els,
    apiRequest: async (path, options) => {
      requests.push([path, options]);
      if (path === '/api/session-config-migrations/incomplete') return { plan };
      if (path === '/api/session-config-migrations/incomplete/migrate') {
        return {
          backup: { id: 'backup-config' },
          migratedSessionIds: Array.from({ length: 22 }, (_, index) => `s${index}`),
          remainingPlan: cleanPlan
        };
      }
      return { health: report };
    },
    getSessionId: () => 'main',
    setStatus: (element, value, tone) => {
      element.textContent = `${tone}:${value}`;
    },
    confirmAction: (message) => {
      confirmations.push(message);
      return true;
    },
    documentObject
  });
  controller.bindEvents();

  await els.previewSessionConfigMigration.dispatch('click');
  assert.equal(els.applySessionConfigMigration.disabled, false);
  assert.match(els.sessionConfigMigrationSummary.textContent, /22 个会话的 32 个字段/);
  await els.applySessionConfigMigration.dispatch('click');

  assert.match(confirmations[0], /不会复制系统默认剧本/);
  assert.deepEqual(requests, [
    ['/api/session-config-migrations/incomplete', undefined],
    ['/api/session-config-migrations/incomplete/migrate', {
      method: 'POST',
      body: { expectedPlanId: 'config-plan', confirmMigration: true }
    }],
    ['/api/sessions/main/health', undefined]
  ]);
  assert.equal(state.sessionConfigMigrationPlan, cleanPlan);
  assert.equal(els.applySessionConfigMigration.disabled, true);
  assert.match(els.sessionConfigMigrationSummary.textContent, /全部会话都已持有独立配置/);
  assert.match(els.sessionHealthStatus.textContent, /本地备份：backup-config/);
});

test('reference repair preview confirms the fingerprint and refreshes health after a backed-up repair', async () => {
  const documentObject = { createElement: (tagName) => new FakeElement(tagName) };
  const els = {
    sessionHealthSummary: new FakeElement('div'),
    sessionHealthList: new FakeElement('div'),
    sessionHealthStatus: new FakeElement('span'),
    refreshSessionHealth: new FakeElement('button'),
    referenceRepairSummary: new FakeElement('p'),
    previewReferenceRepair: new FakeElement('button'),
    applyReferenceRepair: new FakeElement('button')
  };
  const plan = {
    planId: 'repair-plan',
    requiresConfirmation: true,
    summary: {
      sessionsScanned: 28,
      projectsScanned: 4,
      sessionUpdates: 25,
      projectUpdates: 2,
      referenceChanges: 31
    }
  };
  const cleanPlan = {
    planId: 'clean-plan',
    requiresConfirmation: false,
    summary: {
      sessionsScanned: 28,
      projectsScanned: 4,
      sessionUpdates: 0,
      projectUpdates: 0,
      referenceChanges: 0
    }
  };
  const report = { status: 'healthy', summary: { errors: 0, warnings: 0, passes: 6 }, checks: [] };
  const requests = [];
  const confirmations = [];
  const state = {};
  const controller = createSessionHealthController({
    state,
    els,
    apiRequest: async (path, options) => {
      requests.push([path, options]);
      if (path === '/api/reference-repairs/orphans') return { plan };
      if (path === '/api/reference-repairs/orphans/repair') {
        return {
          backup: { id: 'backup-safe' },
          repairedSessionIds: Array.from({ length: 25 }, (_, index) => `s${index}`),
          repairedProjectIds: ['p1', 'p2'],
          remainingPlan: cleanPlan
        };
      }
      return { health: report };
    },
    getSessionId: () => 'main',
    setStatus: (element, value, tone) => {
      element.textContent = `${tone}:${value}`;
    },
    confirmAction: (message) => {
      confirmations.push(message);
      return true;
    },
    documentObject
  });
  controller.bindEvents();

  await els.previewReferenceRepair.dispatch('click');
  assert.equal(els.applyReferenceRepair.disabled, false);
  assert.match(els.referenceRepairSummary.textContent, /25 个会话、2 个故事，共 31 处引用/);
  await els.applyReferenceRepair.dispatch('click');

  assert.match(confirmations[0], /正文、角色卡、世界书、Prompt、消息和记忆内容不会删除/);
  assert.deepEqual(requests, [
    ['/api/reference-repairs/orphans', undefined],
    ['/api/reference-repairs/orphans/repair', {
      method: 'POST',
      body: { expectedPlanId: 'repair-plan', confirmRepair: true }
    }],
    ['/api/sessions/main/health', undefined]
  ]);
  assert.equal(state.referenceRepairPlan, cleanPlan);
  assert.equal(els.applyReferenceRepair.disabled, true);
  assert.match(els.referenceRepairSummary.textContent, /未发现孤儿引用/);
  assert.match(els.sessionHealthStatus.textContent, /本地备份：backup-safe/);
});

test('compatibility upgrade creates a new audited pack while keeping the active session unchanged', async () => {
  const els = { sessionHealthStatus: new FakeElement('span') };
  const requests = [];
  const confirmations = [];
  const created = [];
  const preview = {
    sourcePack: { id: 'custom-legacy', title: '旧卷' },
    rebuildable: true,
    issues: [],
    resourceRevisionChanges: [{ resourceId: 'character-1', changed: true }],
    requiresScriptApproval: false,
    compatibilityReview: {
      fingerprint: 'sha256:upgrade',
      requiresCompatibilityAcknowledgement: true,
      blockers: [{ id: 'tavern-helper', label: '酒馆助手运行时' }],
      rules: []
    }
  };
  const controller = createSessionHealthController({
    els,
    apiRequest: async (requestPath, options) => {
      requests.push([requestPath, options]);
      if (!options) return { preview };
      return { pack: { id: 'custom-upgraded', title: '旧卷 · 兼容复审版' } };
    },
    setStatus: (element, value, tone) => {
      element.textContent = `${tone}:${value}`;
    },
    confirmAction: (message) => {
      confirmations.push(message);
      return true;
    },
    onCompatibilityUpgradeCreated: (result) => created.push(result)
  });

  const result = await controller.upgradeCompatibilityAudit('custom-legacy');

  assert.equal(result.pack.id, 'custom-upgraded');
  assert.match(confirmations[0], /将明确禁用：酒馆助手运行时/);
  assert.match(confirmations[0], /1 份素材已更新/);
  assert.match(confirmations[0], /旧剧本、项目、会话和正文不会修改或迁移/);
  assert.deepEqual(requests, [
    ['/api/resource-library/packs/custom-legacy/compatibility-upgrade', undefined],
    ['/api/resource-library/packs/custom-legacy/compatibility-upgrade', {
      method: 'POST',
      body: {
        compatibilityReview: {
          fingerprint: 'sha256:upgrade',
          approvedScriptHashes: [],
          acknowledgeCompatibility: true
        }
      }
    }]
  ]);
  assert.equal(created.length, 1);
  assert.match(els.sessionHealthStatus.textContent, /当前会话仍使用旧剧本/);
});

test('compatibility upgrade does not batch-approve scripts or fabricate missing resources', async () => {
  const statuses = [];
  const scriptController = createSessionHealthController({
    els: { sessionHealthStatus: new FakeElement('span') },
    apiRequest: async () => ({
      preview: {
        sourcePack: { id: 'custom-script', title: '脚本旧卷' },
        rebuildable: true,
        requiresScriptApproval: true,
        compatibilityReview: {
          fingerprint: 'sha256:script',
          rules: [{ scriptId: 'script-1' }]
        }
      }
    }),
    setStatus: (_element, value, tone) => statuses.push(`${tone}:${value}`)
  });
  const missingController = createSessionHealthController({
    els: { sessionHealthStatus: new FakeElement('span') },
    apiRequest: async () => ({
      preview: {
        sourcePack: { id: 'custom-missing', title: '缺失旧卷' },
        rebuildable: false,
        issues: [{ message: '原组装素材 character-1 已不在本地素材库中' }]
      }
    }),
    setStatus: (_element, value, tone) => statuses.push(`${tone}:${value}`)
  });

  const scriptPreview = await scriptController.upgradeCompatibilityAudit('custom-script');
  const missingPreview = await missingController.upgradeCompatibilityAudit('custom-missing');

  assert.equal(scriptPreview.requiresScriptApproval, true);
  assert.equal(missingPreview.rebuildable, false);
  assert.ok(statuses.some((item) => /不会批量批准/u.test(item)));
  assert.ok(statuses.some((item) => /已不在本地素材库/u.test(item)));
});

test('compatibility upgrade reports a created pack even when the resource catalog refresh fails', async () => {
  const els = { sessionHealthStatus: new FakeElement('span') };
  const controller = createSessionHealthController({
    els,
    apiRequest: async (_requestPath, options) => options
      ? { pack: { id: 'custom-upgraded', title: '复审新版' } }
      : {
          preview: {
            sourcePack: { id: 'custom-legacy', title: '旧卷' },
            rebuildable: true,
            resourceRevisionChanges: [{ resourceId: 'character-1', revisionUnknown: true }],
            requiresScriptApproval: false,
            compatibilityReview: {
              fingerprint: 'sha256:upgrade',
              requiresCompatibilityAcknowledgement: false,
              blockers: [],
              rules: []
            }
          }
        },
    setStatus: (element, value, tone) => {
      element.textContent = `${tone}:${value}`;
    },
    confirmAction: (message) => {
      assert.match(message, /缺少历史 revision 记录/);
      return true;
    },
    onCompatibilityUpgradeCreated: async () => {
      throw new Error('catalog refresh failed');
    }
  });

  const result = await controller.upgradeCompatibilityAudit('custom-legacy');

  assert.equal(result.pack.id, 'custom-upgraded');
  assert.match(els.sessionHealthStatus.textContent, /^warning:已生成/);
  assert.match(els.sessionHealthStatus.textContent, /素材库刷新失败/);
});

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.listeners = new Map();
    this.textContent = '';
    this.disabled = false;
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = children;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  async dispatch(type, event = {}) {
    return this.listeners.get(type)?.({ target: this, ...event });
  }
}
