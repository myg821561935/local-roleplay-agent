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
    eventLedger: []
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

function summarizeTurn(userMessage, assistantMessage) {
  const user = String(userMessage.content || '').slice(0, 120);
  const assistant = String(assistantMessage.content || '').slice(0, 160);
  return `用户行动：${user}\n回应摘要：${assistant}`;
}
