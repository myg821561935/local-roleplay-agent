import { appendLedgerEvent, createTurnLedgerEvent } from '../simulation/eventLedger.js';
import { createSimulationState } from '../simulation/npcSimulation.js';
import { replayActionHistory } from '../simulation/worldStateArbiter.js';

export function createDefaultMemory() {
  const worldState = {
    protagonist: { name: '', realm: '', traits: [], injuries: [], inventory: [] },
    location: { current: '', knownPlaces: [] },
    relationships: [],
    quests: [],
    factions: [],
    flags: {},
    timeline: []
  };
  const simulation = createSimulationState();
  return {
    rollingSummary: '',
    unsummarizedTurnCount: 0,
    worldState,
    worldStateBaseline: structuredClone(worldState),
    memoryCards: [],
    eventLedger: [],
    simulation,
    simulationBaseline: structuredClone(simulation),
    actionCheckpointMessageId: '',
    ruleSystem: null,
    narrativeState: {
      activeArc: '',
      corePillars: [],
      supportingElements: [],
      forbiddenDominance: [],
      supportingArcs: [],
      routeReturnRule: '',
      lockedGenre: '',
      referenceFocus: [],
      lastConfirmedBy: ''
    }
  };
}

export function appendTurnEvent({ memory, userMessage, assistantMessage, turnId, adjudication, actionError }) {
  let next = structuredClone(memory || createDefaultMemory());
  next = appendLedgerEvent(next, createTurnLedgerEvent({
    userMessage,
    assistantMessage,
    turnId,
    adjudication,
    actionError
  }));
  next.unsummarizedTurnCount = Number(next.unsummarizedTurnCount || 0) + 1;
  return next;
}

export function rebuildMemoryFromMessages({ memory, messages }) {
  const previous = memory || createDefaultMemory();
  const safeMessages = Array.isArray(messages) ? messages.filter((message) => !message.excluded) : [];
  const replayed = replayActionHistory({ memory: previous, messages: safeMessages });
  const persistentEvents = (Array.isArray(previous.eventLedger) ? previous.eventLedger : [])
    .filter((event) => event?.kind && event.kind !== 'turn');
  const next = {
    ...createDefaultMemory(),
    rollingSummary: previous.rollingSummary || '',
    worldState: structuredClone(replayed.memory.worldState || createDefaultMemory().worldState),
    worldStateBaseline: structuredClone(replayed.memory.worldStateBaseline || previous.worldStateBaseline || previous.worldState || createDefaultMemory().worldState),
    memoryCards: Array.isArray(previous.memoryCards) ? structuredClone(previous.memoryCards) : [],
    eventLedger: structuredClone(persistentEvents),
    simulation: structuredClone(replayed.memory.simulation || createSimulationState()),
    simulationBaseline: structuredClone(replayed.memory.simulationBaseline || previous.simulationBaseline || previous.simulation || createSimulationState()),
    actionCheckpointMessageId: String(previous.actionCheckpointMessageId || ''),
    ruleSystem: previous.ruleSystem ? structuredClone(previous.ruleSystem) : null,
    narrativeState: previous.narrativeState
      ? structuredClone(previous.narrativeState)
      : structuredClone(createDefaultMemory().narrativeState),
    consecutiveSummaryFailures: Number(previous.consecutiveSummaryFailures || 0),
    lastSummaryError: String(previous.lastSummaryError || ''),
    lastFactExtractionError: String(previous.lastFactExtractionError || '')
  };

  for (let index = 0; index < safeMessages.length - 1; index += 1) {
    const userMessage = safeMessages[index];
    const assistantMessage = safeMessages[index + 1];
    if (userMessage.role === 'user' && assistantMessage.role === 'assistant') {
      next.eventLedger.push(createTurnLedgerEvent({
        userMessage,
        assistantMessage,
        turnId: assistantMessage.id,
        adjudication: replayed.results.get(assistantMessage.id),
        actionError: assistantMessage.actionError
      }));
      next.unsummarizedTurnCount += 1;
      index += 1;
    }
  }

  return next;
}
