export function createDefaultMemory() {
  return {
    rollingSummary: '',
    unsummarizedTurnCount: 0,
    worldState: {
      protagonist: { name: '', realm: '', traits: [], injuries: [], inventory: [] },
      location: { current: '', knownPlaces: [] },
      relationships: [],
      quests: [],
      factions: [],
      flags: {},
      timeline: []
    },
    memoryCards: [],
    eventLedger: [],
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

export function appendTurnEvent({ memory, userMessage, assistantMessage, turnId }) {
  const next = structuredClone(memory || createDefaultMemory());
  next.eventLedger.push({
    id: `event-${turnId}`,
    turnId,
    timestamp: new Date().toISOString(),
    actor: 'system',
    summary: summarizeTurn(userMessage, assistantMessage),
    effects: [],
    sourceMessageId: assistantMessage.id,
    confidence: 0.5
  });
  next.unsummarizedTurnCount = Number(next.unsummarizedTurnCount || 0) + 1;
  return next;
}

export function rebuildMemoryFromMessages({ memory, messages }) {
  const previous = memory || createDefaultMemory();
  const next = {
    ...createDefaultMemory(),
    rollingSummary: previous.rollingSummary || '',
    worldState: structuredClone(previous.worldState || createDefaultMemory().worldState),
    memoryCards: Array.isArray(previous.memoryCards) ? structuredClone(previous.memoryCards) : [],
    ruleSystem: previous.ruleSystem ? structuredClone(previous.ruleSystem) : null,
    narrativeState: previous.narrativeState
      ? structuredClone(previous.narrativeState)
      : structuredClone(createDefaultMemory().narrativeState),
    consecutiveSummaryFailures: Number(previous.consecutiveSummaryFailures || 0),
    lastSummaryError: String(previous.lastSummaryError || ''),
    lastFactExtractionError: String(previous.lastFactExtractionError || '')
  };

  const safeMessages = Array.isArray(messages) ? messages.filter((message) => !message.excluded) : [];
  for (let index = 0; index < safeMessages.length - 1; index += 1) {
    const userMessage = safeMessages[index];
    const assistantMessage = safeMessages[index + 1];
    if (userMessage.role === 'user' && assistantMessage.role === 'assistant') {
      next.eventLedger.push({
        id: `event-${assistantMessage.id}`,
        turnId: assistantMessage.id,
        timestamp: assistantMessage.createdAt || new Date().toISOString(),
        actor: 'system',
        summary: summarizeTurn(userMessage, assistantMessage),
        effects: [],
        sourceMessageId: assistantMessage.id,
        confidence: 0.5
      });
      next.unsummarizedTurnCount += 1;
      index += 1;
    }
  }

  return next;
}

function summarizeTurn(userMessage, assistantMessage) {
  const user = String(userMessage.content || '').slice(0, 120);
  const assistant = String(assistantMessage.content || '').slice(0, 160);
  return `用户行动：${user}\n回应摘要：${assistant}`;
}
