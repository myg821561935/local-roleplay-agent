export function summarizeWorldBookRuntimeBudget(worldBooks = []) {
  const resources = Array.isArray(worldBooks) ? worldBooks : [];
  const runtimeTokenSum = resources.reduce((sum, resource) => (
    sum + Number(resource?.diagnostics?.estimatedTokens || 0)
  ), 0);
  const sharedTokenCap = resources.reduce((cap, resource) => Math.max(
    cap,
    Number(resource?.diagnostics?.worldBookRuntime?.perTurnTokenCap || 0)
  ), 0);
  const estimatedTokens = sharedTokenCap > 0
    ? Math.min(sharedTokenCap, runtimeTokenSum)
    : runtimeTokenSum;
  const storedTokens = resources.reduce((sum, resource) => (
    sum + Number(resource?.diagnostics?.storedPayloadEstimatedTokens
      ?? resource?.diagnostics?.worldBookRuntime?.source?.estimatedTokens
      ?? resource?.diagnostics?.estimatedTokens
      ?? 0)
  ), 0);
  return { estimatedTokens, storedTokens, sharedTokenCap };
}

export function formatWorldBookRuntimeTokenLabel(resource, formatTokenCount = String) {
  const runtimeTokens = Number(resource?.diagnostics?.estimatedTokens || 0);
  const storedTokens = Number(resource?.diagnostics?.storedPayloadEstimatedTokens || 0);
  if (storedTokens > runtimeTokens && runtimeTokens > 0) {
    return `素材 ${formatTokenCount(storedTokens)} · 每轮≤${formatTokenCount(runtimeTokens)} tokens`;
  }
  return runtimeTokens ? `${formatTokenCount(runtimeTokens)} tokens` : '';
}

export function formatWorldBookResourceMeta(resource, {
  companion = false,
  formatTokenCount = String
} = {}) {
  return [
    companion ? '角色卡附带' : '',
    Number(resource?.payload?.entries?.length || 0) ? `${resource.payload.entries.length} 条` : '',
    Number(resource?.diagnostics?.score || 0) ? `${resource.diagnostics.score}分` : '',
    formatWorldBookRuntimeTokenLabel(resource, formatTokenCount),
    resource?.source?.site || '本地'
  ].filter(Boolean).join(' · ');
}

export function createWorldBookRuntimeBudgetRow(readiness = {}, formatTokenCount = String) {
  return [
    '每轮上下文上限',
    readiness.estimatedTokens ? `${formatTokenCount(readiness.estimatedTokens)} tokens` : '使用基线体量',
    readiness.worldBookStoredTokens > readiness.worldBookEstimatedTokens
      ? `世界书素材 ${formatTokenCount(readiness.worldBookStoredTokens)} · 动态注入`
      : readiness.estimatedTokens > 60000
        ? '检查预设与 Provider 预算'
        : '预算可控'
  ];
}
