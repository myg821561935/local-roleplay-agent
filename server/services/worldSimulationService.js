import { appendTurnEvent } from '../agent/memoryUpdater.js';
import { normalizeActionEnvelope } from '../simulation/actionProtocol.js';
import { appendLedgerEvent, createManualLedgerEvent, projectEventLedger } from '../simulation/eventLedger.js';
import { ensureSimulationMemory, normalizeActors, projectSimulation } from '../simulation/npcSimulation.js';
import { adjudicateActionEnvelope } from '../simulation/worldStateArbiter.js';

export class WorldSimulationService {
  constructor({ sessionService, resolveCharacterPresets }) {
    this.sessionService = sessionService;
    this.resolveCharacterPresets = typeof resolveCharacterPresets === 'function'
      ? resolveCharacterPresets
      : () => [];
  }

  prepareSession(session, seeds = {}) {
    const resolvedSeeds = resolveSessionSeeds(session, seeds, this.resolveCharacterPresets);
    session.memory = ensureSimulationMemory(session.memory, resolvedSeeds);
    const baselineMemory = ensureSimulationMemory({ simulation: session.memory.simulationBaseline }, resolvedSeeds);
    session.memory.simulationBaseline = baselineMemory.simulation;
    if (!session.memory.worldStateBaseline) {
      session.memory.worldStateBaseline = structuredClone(session.memory.worldState || {});
    }
    return session;
  }

  applyTurn({ session, userMessage, assistantMessage, actionEnvelope, actionError }) {
    let adjudication = null;
    if (actionEnvelope) {
      const adjudicated = adjudicateActionEnvelope({ memory: session.memory, envelope: actionEnvelope });
      session.memory = adjudicated.memory;
      adjudication = adjudicated.result;
      assistantMessage.actionEnvelope = structuredClone(actionEnvelope);
      assistantMessage.adjudication = summarizeAdjudication(adjudication);
    }
    if (actionError) {
      assistantMessage.actionError = {
        code: actionError.code || 'ACTION_PARSE_FAILED',
        detail: String(actionError.detail || actionError.message || '')
      };
    }
    const swipeIndex = Number(assistantMessage.activeSwipeIndex || 0);
    const swipeMetadata = Array.isArray(assistantMessage.swipeMetadata) ? assistantMessage.swipeMetadata : [];
    while (swipeMetadata.length <= swipeIndex) swipeMetadata.push({});
    swipeMetadata[swipeIndex] = {
      actionEnvelope: assistantMessage.actionEnvelope ? structuredClone(assistantMessage.actionEnvelope) : null,
      actionError: assistantMessage.actionError ? structuredClone(assistantMessage.actionError) : null,
      adjudication: assistantMessage.adjudication ? structuredClone(assistantMessage.adjudication) : null,
      recommendedActions: Array.isArray(assistantMessage.recommendedActions) ? structuredClone(assistantMessage.recommendedActions) : []
    };
    assistantMessage.swipeMetadata = swipeMetadata;
    session.memory = appendTurnEvent({
      memory: session.memory,
      userMessage,
      assistantMessage,
      turnId: assistantMessage.id,
      adjudication,
      actionError
    });
    return { session, adjudication };
  }

  async getSnapshot(sessionId = 'main', { director = true } = {}) {
    const session = await this.sessionService.getSession(sessionId);
    this.prepareSession(session, sessionSeedFromSession(session));
    return projectSnapshot(session, { director });
  }

  async previewActions(sessionId = 'main', envelope, { director = true } = {}) {
    const session = await this.sessionService.getSession(sessionId);
    this.prepareSession(session, sessionSeedFromSession(session));
    const normalized = normalizeActionEnvelope(envelope);
    const adjudicated = adjudicateActionEnvelope({ memory: session.memory, envelope: normalized });
    return {
      committed: false,
      envelope: normalized,
      adjudication: summarizeAdjudication(adjudicated.result, { includeEffects: true }),
      snapshot: projectSnapshot({ ...session, memory: adjudicated.memory }, { director })
    };
  }

  async commitActions(sessionId = 'main', envelope, { actor = 'creator', kind = 'manual-action', director = true } = {}) {
    const session = await this.sessionService.getSession(sessionId);
    this.prepareSession(session, sessionSeedFromSession(session));
    const normalized = normalizeActionEnvelope(envelope);
    const adjudicated = adjudicateActionEnvelope({ memory: session.memory, envelope: normalized });
    session.memory = adjudicated.memory;
    session.memory = appendLedgerEvent(session.memory, createManualLedgerEvent({
      actor,
      summary: normalized.summary || `${actor}提交世界动作`,
      adjudication: adjudicated.result,
      kind
    }));
    checkpointMemory(session);
    session.updatedAt = new Date().toISOString();
    await this.sessionService.saveSession(session);
    return {
      committed: adjudicated.result.status !== 'rejected',
      envelope: normalized,
      adjudication: summarizeAdjudication(adjudicated.result, { includeEffects: true }),
      snapshot: projectSnapshot(session, { director })
    };
  }

  async saveActors(sessionId = 'main', actors, { director = true } = {}) {
    const session = await this.sessionService.getSession(sessionId);
    this.prepareSession(session, sessionSeedFromSession(session));
    const normalized = normalizeActors(actors);
    session.memory.simulation.actors = normalized;
    session.memory.simulation.settings = {
      ...session.memory.simulation.settings,
      rosterInitialized: true
    };
    session.memory.simulation.revision += 1;
    session.memory = appendLedgerEvent(session.memory, createManualLedgerEvent({
      actor: 'creator',
      summary: `更新 NPC 档案：${normalized.length} 人`,
      kind: 'actor-registry',
      adjudication: {
        status: 'accepted',
        revisionBefore: session.memory.simulation.revision - 1,
        revisionAfter: session.memory.simulation.revision,
        accepted: [],
        rejected: [],
        effects: [{
          actionId: 'actor-registry',
          type: 'actor.registry.replace',
          path: 'simulation.actors',
          before: [],
          after: normalized.map((item) => item.id),
          visibility: 'director',
          reason: '创作者更新 NPC 档案'
        }]
      }
    }));
    checkpointMemory(session);
    session.updatedAt = new Date().toISOString();
    await this.sessionService.saveSession(session);
    return projectSnapshot(session, { director });
  }

  async advance(sessionId = 'main', { minutes = 60, reason = '创作者推进时间', director = true } = {}) {
    const session = await this.sessionService.getSession(sessionId);
    this.prepareSession(session, sessionSeedFromSession(session));
    return this.commitActions(sessionId, {
      actorId: 'world-clock',
      summary: String(reason || '推进世界时间'),
      baseRevision: session.memory.simulation.revision,
      actions: [{ type: 'clock.advance', minutes, reason, visibility: 'public' }]
    }, { actor: 'world-clock', kind: 'simulation-tick', director });
  }

  async listEvents(sessionId = 'main', { director = true, limit = 200 } = {}) {
    const session = await this.sessionService.getSession(sessionId);
    return {
      events: projectEventLedger(session.memory?.eventLedger, { director, limit }),
      revision: Number(session.memory?.simulation?.revision || 0)
    };
  }
}

function projectSnapshot(session, { director }) {
  const memory = session.memory || {};
  return {
    sessionId: session.id,
    worldState: structuredClone(memory.worldState || {}),
    simulation: projectSimulation(memory.simulation, { director }),
    events: projectEventLedger(memory.eventLedger, { director, limit: 100 }),
    narrativeState: structuredClone(memory.narrativeState || {}),
    ruleSystem: structuredClone(memory.ruleSystem || null)
  };
}

function sessionSeedFromSession(session) {
  return {
    characterCard: session.config?.characterCard,
    groupMembers: session.config?.groupMembers || [],
    ...(Object.hasOwn(session.config || {}, 'characterPresets')
      ? { characterPresets: session.config.characterPresets }
      : {})
  };
}

function resolveSessionSeeds(session, seeds, resolveCharacterPresets) {
  const config = session.config && typeof session.config === 'object' ? session.config : {};
  const packId = String(
    config.contentPackId
    || session.memory?.ruleSystem?.contentPackId
    || session.memory?.narrativeState?.lockedGenre
    || session.memory?.worldState?.flags?.genre
    || ''
  ).trim();
  const hasSeedPresets = Object.hasOwn(seeds || {}, 'characterPresets');
  const hasConfigPresets = Object.hasOwn(config, 'characterPresets');
  const resolvedPresets = hasSeedPresets
    ? seeds.characterPresets
    : hasConfigPresets
      ? config.characterPresets
      : resolveCharacterPresets(packId);
  return {
    characterCard: seeds.characterCard || config.characterCard,
    groupMembers: Array.isArray(seeds.groupMembers) ? seeds.groupMembers : config.groupMembers,
    characterPresets: Array.isArray(resolvedPresets) ? resolvedPresets : []
  };
}

function checkpointMemory(session) {
  session.memory.worldStateBaseline = structuredClone(session.memory.worldState || {});
  session.memory.simulationBaseline = structuredClone(session.memory.simulation);
  const assistantMessages = (Array.isArray(session.messages) ? session.messages : []).filter((message) => message.role === 'assistant');
  session.memory.actionCheckpointMessageId = assistantMessages.at(-1)?.id || '';
}

function summarizeAdjudication(result, { includeEffects = false } = {}) {
  if (!result) return null;
  return {
    status: result.status,
    code: result.code || '',
    protocol: result.protocol || '',
    envelopeId: result.envelopeId || '',
    actorId: result.actorId || '',
    summary: result.summary || '',
    revisionBefore: result.revisionBefore,
    revisionAfter: result.revisionAfter,
    acceptedCount: result.accepted?.length || 0,
    rejectedCount: result.rejected?.length || 0,
    rejected: (result.rejected || []).map((item) => ({ id: item.action?.id, type: item.action?.type, code: item.code, detail: item.detail })),
    ...(includeEffects ? { effects: structuredClone(result.effects || []) } : {})
  };
}
