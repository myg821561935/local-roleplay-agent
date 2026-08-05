import crypto from 'node:crypto';

const REPAIR_PLAN_SPEC = 'lra.reference-repair-plan/v1';
const BINDING_HISTORY_SPEC = 'lra.binding-history/v1';
const MAX_BINDING_HISTORY = 20;
const PACK_REFERENCE_FIELDS = Object.freeze([
  ['basePackId'],
  ['config', 'contentPackId'],
  ['memory', 'resourcePackId'],
  ['memory', 'ruleSystem', 'contentPackId']
]);

export class ReferenceRepairService {
  constructor({
    sessionService,
    storyProjectService,
    resourceLibraryService,
    backupService,
    listBuiltInPacks = () => [],
    now = () => new Date()
  } = {}) {
    if (!sessionService) throw new TypeError('sessionService is required');
    if (!storyProjectService) throw new TypeError('storyProjectService is required');
    if (!resourceLibraryService) throw new TypeError('resourceLibraryService is required');
    if (!backupService) throw new TypeError('backupService is required');
    this.sessionService = sessionService;
    this.storyProjectService = storyProjectService;
    this.resourceLibraryService = resourceLibraryService;
    this.backupService = backupService;
    this.listBuiltInPacks = listBuiltInPacks;
    this.now = now;
  }

  async inspect() {
    const [sessionIds, projects, customPacks] = await Promise.all([
      this.sessionService.listSessions(),
      this.storyProjectService.listProjects(),
      this.resourceLibraryService.listPacks()
    ]);
    const sessions = await Promise.all(
      sessionIds.map((sessionId) => this.sessionService.getSession(sessionId))
    );
    const availableSessionIds = new Set(sessionIds);
    const availableProjectIds = new Set(projects.map((project) => project.id));
    const availablePackIds = new Set([
      ...(this.listBuiltInPacks() || []).map((pack) => String(pack?.id || '').trim()),
      ...customPacks.map((pack) => String(pack?.id || '').trim())
    ].filter(Boolean));
    const detachedProjectIds = new Set(projects
      .filter((project) => isDetachedProject(project, availablePackIds))
      .map((project) => project.id));
    const projectRepairs = projects
      .map((project) => planProjectRepair(project, { availablePackIds, availableSessionIds }))
      .filter(Boolean)
      .sort(compareRepairTargets);
    const sessionRepairs = sessions
      .map((session) => planSessionRepair(session, {
        availablePackIds,
        availableProjectIds,
        detachedProjectIds
      }))
      .filter(Boolean)
      .sort(compareRepairTargets);
    const fingerprint = {
      projects: projectRepairs,
      sessions: sessionRepairs
    };
    const planId = crypto.createHash('sha256')
      .update(JSON.stringify(fingerprint))
      .digest('hex');
    const referenceChanges = [...projectRepairs, ...sessionRepairs]
      .reduce((sum, item) => sum + item.changes.length, 0);
    return {
      spec: REPAIR_PLAN_SPEC,
      planId,
      generatedAt: this.now().toISOString(),
      requiresConfirmation: projectRepairs.length > 0 || sessionRepairs.length > 0,
      summary: {
        sessionsScanned: sessions.length,
        projectsScanned: projects.length,
        sessionUpdates: sessionRepairs.length,
        projectUpdates: projectRepairs.length,
        referenceChanges
      },
      sessions: sessionRepairs,
      projects: projectRepairs
    };
  }

  async repair({ expectedPlanId = '', confirmRepair = false } = {}) {
    const plan = await this.inspect();
    if (!plan.requiresConfirmation) {
      return {
        ok: true,
        backup: null,
        repairedSessionIds: [],
        repairedProjectIds: [],
        appliedPlanId: plan.planId,
        remainingPlan: plan
      };
    }
    if (!expectedPlanId || expectedPlanId !== plan.planId) {
      throw repairError('REFERENCE_REPAIR_PLAN_CHANGED');
    }
    if (confirmRepair !== true) {
      throw repairError('REFERENCE_REPAIR_CONFIRMATION_REQUIRED');
    }
    const backup = await this.backupService.createBackup({
      reason: `before-reference-repair:${plan.planId.slice(0, 12)}`
    });
    const repairedAt = this.now().toISOString();
    for (const projectRepair of plan.projects) {
      const project = await this.storyProjectService.getProject(projectRepair.id);
      if (!project) throw repairError('REFERENCE_REPAIR_PLAN_CHANGED');
      await this.storyProjectService.saveProject(applyProjectRepair(project, projectRepair, repairedAt));
    }
    for (const sessionRepair of plan.sessions) {
      const session = await this.sessionService.getSession(sessionRepair.id);
      const next = applySessionRepair(session, sessionRepair, plan.planId, repairedAt);
      await this.sessionService.saveSession(next);
    }
    const remainingPlan = await this.inspect();
    return {
      ok: true,
      backup,
      appliedPlanId: plan.planId,
      repairedSessionIds: plan.sessions.map((session) => session.id),
      repairedProjectIds: plan.projects.map((project) => project.id),
      remainingPlan
    };
  }
}

function planProjectRepair(project, { availablePackIds, availableSessionIds }) {
  const changes = [];
  const basePackId = String(project.basePackId || '').trim();
  const missingPack = Boolean(basePackId) && !availablePackIds.has(basePackId);
  const needsDetachedState = (missingPack || !basePackId) && project.lifecycle?.state !== 'detached';
  const sessionIds = (project.sessionIds || []).filter((sessionId) => availableSessionIds.has(sessionId));
  const activeSessionId = availableSessionIds.has(project.activeSessionId)
    ? project.activeSessionId
    : sessionIds.at(-1) || '';
  if (missingPack) changes.push(change('basePackId', basePackId, '', 'missing-content-pack'));
  if (needsDetachedState) {
    changes.push(change('lifecycle.state', project.lifecycle?.state || 'active', 'detached', 'missing-content-pack'));
  }
  if (!arraysEqual(sessionIds, project.sessionIds || [])) {
    changes.push(change('sessionIds', project.sessionIds || [], sessionIds, 'missing-session'));
  }
  if (activeSessionId !== String(project.activeSessionId || '')) {
    changes.push(change('activeSessionId', project.activeSessionId || '', activeSessionId, 'missing-session'));
  }
  if (!changes.length) return null;
  return {
    id: project.id,
    title: project.title || project.id,
    changes,
    snapshot: {
      basePackId,
      basePackTitle: project.basePackTitle || '',
      basePackVersion: project.basePackVersion || '1.0.0',
      visualPackId: project.visualPackId || ''
    }
  };
}

function planSessionRepair(session, { availablePackIds, availableProjectIds, detachedProjectIds }) {
  const changes = [];
  const projectId = String(session.storyProjectId || '').trim();
  if (projectId && !availableProjectIds.has(projectId)) {
    changes.push(change('storyProjectId', projectId, '', 'missing-story-project'));
  } else if (projectId && detachedProjectIds.has(projectId)) {
    changes.push(change('storyProjectId', projectId, '', 'detached-story-project'));
  }
  for (const path of PACK_REFERENCE_FIELDS) {
    const value = String(getPath(session, path) || '').trim();
    if (value && !availablePackIds.has(value)) {
      changes.push(change(path.join('.'), value, '', 'missing-content-pack'));
    }
  }
  if (!changes.length) return null;
  return {
    id: session.id,
    title: session.title || session.id,
    messageCount: Array.isArray(session.messages) ? session.messages.length : 0,
    changes
  };
}

function applyProjectRepair(project, repair, repairedAt) {
  const next = structuredClone(project);
  for (const item of repair.changes) {
    if (item.field === 'basePackId') next.basePackId = '';
    if (item.field === 'sessionIds') next.sessionIds = structuredClone(item.to);
    if (item.field === 'activeSessionId') next.activeSessionId = item.to;
    if (item.field === 'lifecycle.state') {
      next.lifecycle = {
        state: 'detached',
        detachedAt: repairedAt,
        reason: 'historical-content-pack-missing',
        sourcePack: {
          id: repair.snapshot.basePackId,
          title: repair.snapshot.basePackTitle,
          version: repair.snapshot.basePackVersion,
          visualPackId: repair.snapshot.visualPackId
        }
      };
    }
  }
  return next;
}

function applySessionRepair(session, repair, planId, repairedAt) {
  const previous = captureSessionBindings(session);
  const next = structuredClone(session);
  for (const item of repair.changes) {
    if (item.field === 'storyProjectId') next.storyProjectId = '';
    if (item.field === 'basePackId') next.basePackId = '';
    if (item.field === 'config.contentPackId' && next.config) next.config.contentPackId = '';
    if (item.field === 'memory.resourcePackId' && next.memory) next.memory.resourcePackId = '';
    if (item.field === 'memory.ruleSystem.contentPackId' && next.memory?.ruleSystem) {
      next.memory.ruleSystem.contentPackId = '';
    }
  }
  next.provenance = appendRepairHistory(next.provenance, {
    spec: BINDING_HISTORY_SPEC,
    kind: 'reference-repair',
    detachedAt: repairedAt,
    reason: 'historical-reference-repair',
    source: { planId, changes: structuredClone(repair.changes) },
    previous
  });
  next.updatedAt = repairedAt;
  return next;
}

function appendRepairHistory(provenance, entry) {
  const current = provenance && typeof provenance === 'object' && !Array.isArray(provenance)
    ? structuredClone(provenance)
    : {};
  const history = Array.isArray(current.bindingHistory) ? current.bindingHistory : [];
  return {
    ...current,
    bindingHistory: [...history, entry].slice(-MAX_BINDING_HISTORY)
  };
}

function captureSessionBindings(session) {
  return {
    storyProjectId: String(session.storyProjectId || '').trim(),
    basePackId: String(session.basePackId || '').trim(),
    configContentPackId: String(session.config?.contentPackId || '').trim(),
    memoryResourcePackId: String(session.memory?.resourcePackId || '').trim(),
    ruleContentPackId: String(session.memory?.ruleSystem?.contentPackId || '').trim()
  };
}

function isDetachedProject(project, availablePackIds) {
  const packId = String(project.basePackId || '').trim();
  return project.lifecycle?.state === 'detached' || !packId || !availablePackIds.has(packId);
}

function getPath(value, path) {
  return path.reduce((current, key) => current?.[key], value);
}

function change(field, from, to, reason) {
  return { field, from: structuredClone(from), to: structuredClone(to), reason };
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function compareRepairTargets(left, right) {
  return String(left.id).localeCompare(String(right.id));
}

function repairError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
