import test from 'node:test';
import assert from 'node:assert/strict';

import { SessionConfigMigrationService } from '../server/services/sessionConfigMigrationService.js';

test('session config migration only auto-plans missing session-owned empty objects', async () => {
  const harness = createHarness();
  const service = new SessionConfigMigrationService(harness);

  const first = await service.inspect();
  const second = await service.inspect();

  assert.equal(first.planId, second.planId);
  assert.equal(first.requiresConfirmation, true);
  assert.deepEqual(first.summary, {
    sessionsScanned: 3,
    incompleteSessions: 2,
    sessionUpdates: 1,
    fieldChanges: 2,
    manualReviewSessions: 1
  });
  assert.deepEqual(first.sessions[0].changes.map((item) => item.field), [
    'config.persona',
    'config.lightFrontend'
  ]);
  assert.equal(first.manualReview[0].id, 'manual-session');
  assert.equal(first.manualReview[0].issues.some((item) => item.field === 'characterCard'), true);
});

test('session config migration requires a fresh confirmation, backs up, and preserves content', async () => {
  const events = [];
  const harness = createHarness({ events });
  const service = new SessionConfigMigrationService(harness);
  const plan = await service.inspect();

  await assert.rejects(
    service.migrate({ expectedPlanId: 'stale', confirmMigration: true }),
    (error) => error.code === 'SESSION_CONFIG_MIGRATION_PLAN_CHANGED'
  );
  await assert.rejects(
    service.migrate({ expectedPlanId: plan.planId }),
    (error) => error.code === 'SESSION_CONFIG_MIGRATION_CONFIRMATION_REQUIRED'
  );
  assert.deepEqual(events, []);

  const result = await service.migrate({
    expectedPlanId: plan.planId,
    confirmMigration: true
  });
  const session = harness.sessions.get('safe-session');

  assert.deepEqual(events, [
    `backup:before-session-config-migration:${plan.planId.slice(0, 12)}`,
    'save-session:safe-session'
  ]);
  assert.deepEqual(session.config.persona, {});
  assert.deepEqual(session.config.lightFrontend, {});
  assert.equal(session.config.characterCard.description, '角色内容保留');
  assert.equal(session.config.worldBook[0].content, '世界内容保留');
  assert.equal(session.config.promptModules[0].text, 'Prompt 保留');
  assert.equal(session.messages[0].content, '正文保留');
  assert.equal(session.memory.factCards[0].text, '事实保留');
  assert.equal(session.provenance.configMigrationHistory.at(-1).reason, 'materialize-session-owned-config');
  assert.equal(result.backup.id, 'migration-backup');
  assert.deepEqual(result.migratedSessionIds, ['safe-session']);
  assert.equal(result.remainingPlan.requiresConfirmation, false);
  assert.equal(result.remainingPlan.summary.incompleteSessions, 1);
  assert.equal(result.remainingPlan.summary.manualReviewSessions, 1);
});

function createHarness({ events = [] } = {}) {
  const sessions = new Map([
    ['safe-session', {
      id: 'safe-session',
      title: '可迁移旧存档',
      config: {
        characterCard: { name: '阿月', description: '角色内容保留' },
        worldBook: [{ id: 'w1', content: '世界内容保留' }],
        promptModules: [{ id: 'p1', text: 'Prompt 保留' }]
      },
      messages: [{ id: 'm1', content: '正文保留' }],
      memory: { factCards: [{ id: 'f1', text: '事实保留' }] }
    }],
    ['manual-session', {
      id: 'manual-session',
      title: '需人工确认旧存档',
      config: { promptModules: [], worldBook: [] },
      messages: []
    }],
    ['complete-session', {
      id: 'complete-session',
      title: '完整存档',
      config: {
        characterCard: {},
        promptModules: [],
        worldBook: [],
        persona: {},
        lightFrontend: {}
      },
      messages: []
    }]
  ]);
  return {
    sessions,
    sessionService: {
      listSessions: async () => [...sessions.keys()],
      getSession: async (sessionId) => structuredClone(sessions.get(sessionId)),
      saveSession: async (session) => {
        events.push(`save-session:${session.id}`);
        sessions.set(session.id, structuredClone(session));
        return session;
      }
    },
    backupService: {
      createBackup: async ({ reason }) => {
        events.push(`backup:${reason}`);
        return { id: 'migration-backup' };
      }
    },
    now: () => new Date('2026-08-03T16:00:00.000Z')
  };
}
