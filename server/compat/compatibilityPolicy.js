export const TAVERN_COMPATIBILITY_CONTRACT_VERSION = 2;

export const COMPATIBILITY_OUTCOMES = Object.freeze({
  FULL_MAPPING: 'full-mapping',
  SAFE_DEGRADATION: 'safe-degradation',
  REVIEW_REQUIRED: 'review-required',
  BLOCKED: 'blocked'
});

const OUTCOME_LABELS = Object.freeze({
  [COMPATIBILITY_OUTCOMES.FULL_MAPPING]: '完整映射',
  [COMPATIBILITY_OUTCOMES.SAFE_DEGRADATION]: '安全降级',
  [COMPATIBILITY_OUTCOMES.REVIEW_REQUIRED]: '待人工审核',
  [COMPATIBILITY_OUTCOMES.BLOCKED]: '阻断运行'
});

export function buildCompatibilityAcceptance(requirements = []) {
  const normalized = Array.isArray(requirements) ? requirements : [];
  const blockers = normalized.filter((item) => item?.status === 'missing');
  const reviews = normalized.filter((item) => item?.status === 'review');
  const degraded = normalized.filter((item) => item?.status === 'degraded');
  const outcome = blockers.length
    ? COMPATIBILITY_OUTCOMES.BLOCKED
    : reviews.length
      ? COMPATIBILITY_OUTCOMES.REVIEW_REQUIRED
      : degraded.length
        ? COMPATIBILITY_OUTCOMES.SAFE_DEGRADATION
        : COMPATIBILITY_OUTCOMES.FULL_MAPPING;

  return {
    schemaVersion: 1,
    contractVersion: TAVERN_COMPATIBILITY_CONTRACT_VERSION,
    outcome,
    label: OUTCOME_LABELS[outcome],
    canStore: true,
    canRun: outcome !== COMPATIBILITY_OUTCOMES.BLOCKED,
    executesThirdPartyCode: false,
    differences: degraded.map(toDifference),
    reviews: reviews.map(toDifference),
    blockers: blockers.map(toDifference)
  };
}

function toDifference(item = {}) {
  return {
    id: String(item.id || 'unknown-capability'),
    label: String(item.label || item.id || '未知能力'),
    impact: String(item.impact || ''),
    recommendation: String(item.recommendation || ''),
    evidence: Array.isArray(item.evidence) ? item.evidence.map(String).slice(0, 6) : []
  };
}
