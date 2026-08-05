import test from 'node:test';
import assert from 'node:assert/strict';

import { ReferenceRepairService } from '../server/services/referenceRepairService.js';

test('reference repair plans only missing operational bindings and keeps a stable fingerprint', async () => {
  const harness = createHarness();
  const service = new ReferenceRepairService(harness);

  const first = await service.inspect();
  const second = await service.inspect();

  assert.equal(first.planId, second.planId);
  assert.equal(first.requiresConfirmation, true);
  assert.deepEqual(first.summary, {
    sessionsScanned: 2,
    projectsScanned: 2,
    sessionUpdates: 1,
    projectUpdates: 1,
    referenceChanges: 9
  });
  assert.deepEqual(first.sessions[0].changes.map((item) => item.field), [
    'storyProjectId',
    'basePackId',
    'config.contentPackId',
    'memory.resourcePackId',
    'memory.ruleSystem.contentPackId'
  ]);
  assert.deepEqual(first.projects[0].changes.map((item) => item.field), [
    'basePackId',
    'lifecycle.state',
    'sessionIds',
    'activeSessionId'
  ]);
  assert.equal(first.sessions.some((item) => item.id === 'valid-session'), false);
  assert.equal(first.projects.some((item) => item.id === 'valid-project'), false);
});

test('reference repair rejects stale or unconfirmed plans, then backs up and preserves story content', async () => {
  const events = [];
  const harness = createHarness({ events });
  const service = new ReferenceRepairService(harness);
  const plan = await service.inspect();

  await assert.rejects(
    service.repair({ expectedPlanId: 'stale', confirmRepair: true }),
    (error) => error.code === 'REFERENCE_REPAIR_PLAN_CHANGED'
  );
  await assert.rejects(
    service.repair({ expectedPlanId: plan.planId }),
    (error) => error.code === 'REFERENCE_REPAIR_CONFIRMATION_REQUIRED'
  );
  assert.deepEqual(events, []);

  const result = await service.repair({
    expectedPlanId: plan.planId,
    confirmRepair: true
  });
  const project = harness.projects.get('orphan-project');
  const session = harness.sessions.get('orphan-session');

  assert.deepEqual(events, [
    `backup:before-reference-repair:${plan.planId.slice(0, 12)}`,
    'save-project:orphan-project',
    'save-session:orphan-session'
  ]);
  assert.equal(project.basePackId, '');
  assert.equal(project.lifecycle.state, 'detached');
  assert.equal(project.lifecycle.sourcePack.id, 'missing-pack');
  assert.deepEqual(project.sessionIds, ['orphan-session']);
  assert.equal(project.activeSessionId, 'orphan-session');
  assert.equal(session.storyProjectId, '');
  assert.equal(session.basePackId, '');
  assert.equal(session.config.contentPackId, '');
  assert.equal(session.memory.resourcePackId, '');
  assert.equal(session.memory.ruleSystem.contentPackId, '');
  assert.equal(session.config.characterCard.description, '角色内容保留');
  assert.equal(session.config.worldBook[0].content, '世界内容保留');
  assert.equal(session.config.promptModules[0].text, 'Prompt 保留');
  assert.equal(session.memory.factCards[0].text, '事实保留');
  assert.equal(session.messages[0].content, '正文保留');
  assert.equal(session.provenance.bindingHistory.at(-1).reason, 'historical-reference-repair');
  assert.equal(result.backup.id, 'repair-backup');
  assert.deepEqual(result.repairedSessionIds, ['orphan-session']);
  assert.deepEqual(result.repairedProjectIds, ['orphan-project']);
  assert.equal(result.remainingPlan.requiresConfirmation, false);
  assert.equal(result.remainingPlan.summary.referenceChanges, 0);
});

function createHarness({ events = [] } = {}) {
  const sessions = new Map([
    ['orphan-session', {
      id: 'orphan-session',
      title: '旧存档',
      storyProjectId: 'orphan-project',
      basePackId: 'missing-pack',
      messages: [{ id: 'm1', content: '正文保留' }],
      config: {
        contentPackId: 'missing-pack',
        characterCard: { name: '阿月', description: '角色内容保留' },
        worldBook: [{ id: 'w1', content: '世界内容保留' }],
        promptModules: [{ id: 'p1', text: 'Prompt 保留' }]
      },
      memory: {
        resourcePackId: 'missing-pack',
        ruleSystem: { contentPackId: 'missing-pack', rules: [{ id: 'r1' }] },
        factCards: [{ id: 'f1', text: '事实保留' }]
      },
      settings: {}
    }],
    ['valid-session', {
      id: 'valid-session',
      title: '正常存档',
      storyProjectId: 'valid-project',
      basePackId: 'xianxia',
      config: { contentPackId: 'xianxia' },
      memory: { resourcePackId: 'xianxia', ruleSystem: { contentPackId: 'xianxia' } },
      messages: []
    }]
  ]);
  const projects = new Map([
    ['orphan-project', {
      id: 'orphan-project',
      title: '失去素材的故事',
      basePackId: 'missing-pack',
      basePackTitle: '旧素材包',
      basePackVersion: '1.0.0',
      visualPackId: 'neutral',
      lifecycle: { state: 'active' },
      sessionIds: ['orphan-session', 'missing-session'],
      activeSessionId: 'missing-session'
    }],
    ['valid-project', {
      id: 'valid-project',
      title: '正常故事',
      basePackId: 'xianxia',
      lifecycle: { state: 'active' },
      sessionIds: ['valid-session'],
      activeSessionId: 'valid-session'
    }]
  ]);
  return {
    sessions,
    projects,
    sessionService: {
      listSessions: async () => [...sessions.keys()],
      getSession: async (sessionId) => structuredClone(sessions.get(sessionId)),
      saveSession: async (session) => {
        events.push(`save-session:${session.id}`);
        sessions.set(session.id, structuredClone(session));
        return session;
      }
    },
    storyProjectService: {
      listProjects: async () => [...projects.values()].map((project) => structuredClone(project)),
      getProject: async (projectId) => {
        const project = projects.get(projectId);
        return project ? structuredClone(project) : null;
      },
      saveProject: async (project) => {
        events.push(`save-project:${project.id}`);
        projects.set(project.id, structuredClone(project));
        return project;
      }
    },
    resourceLibraryService: {
      listPacks: async () => [{ id: 'custom-valid' }]
    },
    backupService: {
      createBackup: async ({ reason }) => {
        events.push(`backup:${reason}`);
        return { id: 'repair-backup' };
      }
    },
    listBuiltInPacks: () => [{ id: 'xianxia' }],
    now: () => new Date('2026-08-03T13:00:00.000Z')
  };
}
