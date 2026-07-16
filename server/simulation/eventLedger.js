import crypto from 'node:crypto';

export function appendLedgerEvent(memory, event, { maxEntries = 1000 } = {}) {
  const next = structuredClone(memory && typeof memory === 'object' ? memory : {});
  const ledger = Array.isArray(next.eventLedger) ? next.eventLedger : [];
  ledger.push(normalizeLedgerEvent(event));
  next.eventLedger = ledger.slice(-Math.max(50, maxEntries));
  return next;
}

export function createTurnLedgerEvent({ userMessage, assistantMessage, turnId, adjudication, actionError, now = () => new Date() } = {}) {
  const effects = Array.isArray(adjudication?.effects) ? adjudication.effects : [];
  return normalizeLedgerEvent({
    id: `event-${turnId || assistantMessage?.id || crypto.randomUUID()}`,
    kind: 'turn',
    turnId: turnId || assistantMessage?.id || '',
    timestamp: assistantMessage?.createdAt || now().toISOString(),
    actor: assistantMessage?.speaker || adjudication?.actorId || 'narrator',
    summary: summarizeTurn(userMessage, assistantMessage),
    status: adjudication?.status || (actionError ? 'rejected' : 'observed'),
    effects,
    actions: summarizeActions(adjudication),
    error: actionError ? { code: actionError.code || 'ACTION_PARSE_FAILED', detail: String(actionError.detail || actionError.message || '') } : null,
    sourceMessageId: assistantMessage?.id || '',
    confidence: adjudication ? 1 : 0.5,
    visibility: effects.some((effect) => effect.visibility !== 'public') ? 'mixed' : 'public',
    revisionBefore: adjudication?.revisionBefore,
    revisionAfter: adjudication?.revisionAfter
  });
}

export function createManualLedgerEvent({ actor = 'creator', summary, adjudication, kind = 'manual-action', now = () => new Date() } = {}) {
  const effects = Array.isArray(adjudication?.effects) ? adjudication.effects : [];
  return normalizeLedgerEvent({
    id: `event-${crypto.randomUUID()}`,
    kind,
    timestamp: now().toISOString(),
    actor,
    summary: String(summary || adjudication?.summary || kind).slice(0, 500),
    status: adjudication?.status || 'observed',
    effects,
    actions: summarizeActions(adjudication),
    confidence: 1,
    visibility: effects.some((effect) => effect.visibility !== 'public') ? 'mixed' : 'public',
    revisionBefore: adjudication?.revisionBefore,
    revisionAfter: adjudication?.revisionAfter
  });
}

export function projectEventLedger(input, { director = false, limit = 200 } = {}) {
  const ledger = (Array.isArray(input) ? input : []).slice(-Math.max(1, Number(limit) || 200));
  return ledger.map((entry) => projectEvent(entry, director));
}

export function summarizeTurn(userMessage, assistantMessage) {
  const user = String(userMessage?.content || '').slice(0, 120);
  const assistant = String(assistantMessage?.content || '').slice(0, 160);
  return `用户行动：${user}\n回应摘要：${assistant}`;
}

function summarizeActions(adjudication) {
  const accepted = (adjudication?.accepted || []).map((item) => ({
    id: item.action?.id,
    type: item.action?.type,
    status: 'accepted',
    reason: item.action?.reason || ''
  }));
  const rejected = (adjudication?.rejected || []).map((item) => ({
    id: item.action?.id,
    type: item.action?.type,
    status: 'rejected',
    reason: item.action?.reason || '',
    code: item.code || ''
  }));
  return [...accepted, ...rejected];
}

function projectEvent(entry, director) {
  const projected = structuredClone(entry);
  projected.effects = (projected.effects || []).filter((effect) => director || effect.visibility === 'public');
  if (!director) {
    projected.actions = (projected.actions || []).filter((action) => {
      const effect = (entry.effects || []).find((item) => item.actionId === action.id);
      return !effect || effect.visibility === 'public';
    });
    if (entry.visibility !== 'public' && !projected.effects.length) projected.summary = '幕后事件（尚未公开）';
    delete projected.error;
  }
  return projected;
}

function normalizeLedgerEvent(event) {
  return {
    id: String(event?.id || `event-${crypto.randomUUID()}`),
    kind: String(event?.kind || 'event'),
    turnId: String(event?.turnId || ''),
    timestamp: String(event?.timestamp || new Date().toISOString()),
    actor: String(event?.actor || 'system'),
    summary: String(event?.summary || '').slice(0, 1000),
    status: String(event?.status || 'observed'),
    effects: Array.isArray(event?.effects) ? structuredClone(event.effects) : [],
    actions: Array.isArray(event?.actions) ? structuredClone(event.actions) : [],
    error: event?.error ? structuredClone(event.error) : null,
    sourceMessageId: String(event?.sourceMessageId || ''),
    confidence: Number.isFinite(Number(event?.confidence)) ? Number(event.confidence) : 0.5,
    visibility: String(event?.visibility || 'public'),
    revisionBefore: Number.isSafeInteger(Number(event?.revisionBefore)) ? Number(event.revisionBefore) : null,
    revisionAfter: Number.isSafeInteger(Number(event?.revisionAfter)) ? Number(event.revisionAfter) : null
  };
}
