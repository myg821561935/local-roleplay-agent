export function summarizeSessionUsage(session = {}) {
  const rows = usageRowsFromSession(session);
  return buildUsageSummary({
    scope: 'session',
    sessionId: String(session.id || 'main'),
    rows
  });
}

export function summarizeAllUsage(sessions = []) {
  const rows = sessions.flatMap((session) => usageRowsFromSession(session));
  return buildUsageSummary({
    scope: 'all',
    sessionId: '',
    rows
  });
}

function usageRowsFromSession(session = {}) {
  const sessionId = String(session.id || 'main');
  const messages = Array.isArray(session.messages) ? session.messages : [];
  return messages
    .filter((message) => message?.role === 'assistant' && isPlainObject(message.usage))
    .map((message, index) => normalizeUsageRow({ sessionId, message, index }));
}

function normalizeUsageRow({ sessionId, message, index }) {
  const usage = message.usage || {};
  const promptTokens = normalizeTokenNumber(usage.promptTokens ?? usage.prompt_tokens);
  const completionTokens = normalizeTokenNumber(usage.completionTokens ?? usage.completion_tokens);
  const totalTokens = normalizeTokenNumber(usage.totalTokens ?? usage.total_tokens, promptTokens + completionTokens);
  return {
    sessionId,
    messageId: String(message.id || `assistant-${index}`),
    createdAt: String(message.createdAt || ''),
    providerId: String(usage.providerId || usage.provider_id || ''),
    model: String(usage.model || ''),
    promptTokens,
    completionTokens,
    totalTokens,
    injectedCards: normalizeTokenNumber(usage.injectedCards),
    estimated: usage.estimated !== false
  };
}

function buildUsageSummary({ scope, sessionId, rows }) {
  const totals = rows.reduce((acc, row) => {
    acc.calls += 1;
    acc.promptTokens += row.promptTokens;
    acc.completionTokens += row.completionTokens;
    acc.totalTokens += row.totalTokens;
    if (row.estimated) acc.estimatedCalls += 1;
    else acc.providerReportedCalls += 1;
    return acc;
  }, createEmptyTotals());

  return {
    scope,
    sessionId,
    generatedAt: new Date().toISOString(),
    totals,
    byProvider: aggregateByProvider(rows),
    recent: rows.slice().sort(compareRecentUsage).slice(0, 20)
  };
}

function aggregateByProvider(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.providerId || 'unknown'}\n${row.model || 'unknown'}`;
    if (!groups.has(key)) {
      groups.set(key, {
        providerId: row.providerId || 'unknown',
        model: row.model || 'unknown',
        calls: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCalls: 0,
        providerReportedCalls: 0
      });
    }
    const group = groups.get(key);
    group.calls += 1;
    group.promptTokens += row.promptTokens;
    group.completionTokens += row.completionTokens;
    group.totalTokens += row.totalTokens;
    if (row.estimated) group.estimatedCalls += 1;
    else group.providerReportedCalls += 1;
  }
  return Array.from(groups.values()).sort((a, b) => b.totalTokens - a.totalTokens || b.calls - a.calls);
}

function compareRecentUsage(a, b) {
  const at = Date.parse(a.createdAt || '') || 0;
  const bt = Date.parse(b.createdAt || '') || 0;
  if (bt !== at) return bt - at;
  return String(b.messageId).localeCompare(String(a.messageId));
}

function createEmptyTotals() {
  return {
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    estimatedCalls: 0,
    providerReportedCalls: 0
  };
}

function normalizeTokenNumber(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.floor(number);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
