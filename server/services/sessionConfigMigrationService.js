import crypto from 'node:crypto';

const MIGRATION_PLAN_SPEC = 'lra.session-config-migration-plan/v1';
const MIGRATION_HISTORY_SPEC = 'lra.session-config-migration-history/v1';
const MAX_MIGRATION_HISTORY = 20;
const REQUIRED_FIELDS = Object.freeze([
  ['characterCard', 'object'],
  ['promptModules', 'array'],
  ['worldBook', 'array'],
  ['persona', 'object'],
  ['lightFrontend', 'object']
]);
const SAFE_EMPTY_OBJECT_FIELDS = new Set(['persona', 'lightFrontend']);

export class SessionConfigMigrationService {
  constructor({
    sessionService,
    backupService,
    now = () => new Date()
  } = {}) {
    if (!sessionService) throw new TypeError('sessionService is required');
    if (!backupService) throw new TypeError('backupService is required');
    this.sessionService = sessionService;
    this.backupService = backupService;
    this.now = now;
  }

  async inspect() {
    const sessionIds = await this.sessionService.listSessions();
    const sessions = await Promise.all(
      sessionIds.map((sessionId) => this.sessionService.getSession(sessionId))
    );
    const candidates = sessions
      .map(planSessionMigration)
      .filter(Boolean)
      .sort((left, right) => String(left.id).localeCompare(String(right.id)));
    const migrations = candidates.filter((item) => item.safeToMigrate);
    const manualReview = candidates.filter((item) => !item.safeToMigrate);
    const fingerprint = { migrations, manualReview };
    const planId = crypto.createHash('sha256')
      .update(JSON.stringify(fingerprint))
      .digest('hex');
    return {
      spec: MIGRATION_PLAN_SPEC,
      planId,
      generatedAt: this.now().toISOString(),
      requiresConfirmation: migrations.length > 0,
      summary: {
        sessionsScanned: sessions.length,
        incompleteSessions: candidates.length,
        sessionUpdates: migrations.length,
        fieldChanges: migrations.reduce((sum, item) => sum + item.changes.length, 0),
        manualReviewSessions: manualReview.length
      },
      sessions: migrations,
      manualReview
    };
  }

  async migrate({ expectedPlanId = '', confirmMigration = false } = {}) {
    const plan = await this.inspect();
    if (!plan.requiresConfirmation) {
      return {
        ok: true,
        backup: null,
        migratedSessionIds: [],
        appliedPlanId: plan.planId,
        remainingPlan: plan
      };
    }
    if (!expectedPlanId || expectedPlanId !== plan.planId) {
      throw migrationError('SESSION_CONFIG_MIGRATION_PLAN_CHANGED');
    }
    if (confirmMigration !== true) {
      throw migrationError('SESSION_CONFIG_MIGRATION_CONFIRMATION_REQUIRED');
    }
    const backup = await this.backupService.createBackup({
      reason: `before-session-config-migration:${plan.planId.slice(0, 12)}`
    });
    const migratedAt = this.now().toISOString();
    for (const migration of plan.sessions) {
      const session = await this.sessionService.getSession(migration.id);
      const currentPlan = planSessionMigration(session);
      if (!currentPlan?.safeToMigrate
        || JSON.stringify(currentPlan.changes) !== JSON.stringify(migration.changes)) {
        throw migrationError('SESSION_CONFIG_MIGRATION_PLAN_CHANGED');
      }
      await this.sessionService.saveSession(applySessionMigration(
        session,
        migration,
        plan.planId,
        migratedAt
      ));
    }
    const remainingPlan = await this.inspect();
    return {
      ok: true,
      backup,
      appliedPlanId: plan.planId,
      migratedSessionIds: plan.sessions.map((session) => session.id),
      remainingPlan
    };
  }
}

function planSessionMigration(session) {
  const config = isPlainObject(session?.config) ? session.config : null;
  const issues = [];
  for (const [field, expectedType] of REQUIRED_FIELDS) {
    const value = config?.[field];
    if (matchesType(value, expectedType)) continue;
    issues.push({
      field,
      issue: value === undefined || value === null ? 'missing' : 'invalid',
      expectedType
    });
  }
  if (!issues.length) return null;
  const safeToMigrate = Boolean(config) && issues.every((item) => (
    item.issue === 'missing' && SAFE_EMPTY_OBJECT_FIELDS.has(item.field)
  ));
  return {
    id: session.id,
    title: session.title || session.id,
    messageCount: Array.isArray(session.messages) ? session.messages.length : 0,
    safeToMigrate,
    changes: safeToMigrate
      ? issues.map((item) => ({
        field: `config.${item.field}`,
        from: null,
        to: {},
        reason: 'materialize-session-owned-empty-object'
      }))
      : [],
    issues
  };
}

function applySessionMigration(session, migration, planId, migratedAt) {
  const next = structuredClone(session);
  next.config = isPlainObject(next.config) ? next.config : {};
  for (const item of migration.changes) {
    const field = item.field.replace(/^config\./, '');
    if (SAFE_EMPTY_OBJECT_FIELDS.has(field)) next.config[field] = {};
  }
  next.provenance = appendMigrationHistory(next.provenance, {
    spec: MIGRATION_HISTORY_SPEC,
    kind: 'session-config-migration',
    migratedAt,
    reason: 'materialize-session-owned-config',
    source: {
      planId,
      changes: structuredClone(migration.changes)
    }
  });
  next.updatedAt = migratedAt;
  return next;
}

function appendMigrationHistory(provenance, entry) {
  const current = isPlainObject(provenance) ? structuredClone(provenance) : {};
  const history = Array.isArray(current.configMigrationHistory)
    ? current.configMigrationHistory
    : [];
  return {
    ...current,
    configMigrationHistory: [...history, entry].slice(-MAX_MIGRATION_HISTORY)
  };
}

function matchesType(value, expectedType) {
  return expectedType === 'array' ? Array.isArray(value) : isPlainObject(value);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function migrationError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
