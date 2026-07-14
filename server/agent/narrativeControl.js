import { getGenreNarrativeProfile } from '../config/narrativeProfiles.js';

const NARRATIVE_MODES = new Set(['free', 'stable', 'strict']);

export function normalizeNarrativeMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return NARRATIVE_MODES.has(mode) ? mode : 'stable';
}

export function resolveNarrativeContext({ memory, mode } = {}) {
  const safeMemory = memory && typeof memory === 'object' ? memory : {};
  const worldState = safeMemory.worldState && typeof safeMemory.worldState === 'object' ? safeMemory.worldState : {};
  const flags = worldState.flags && typeof worldState.flags === 'object' ? worldState.flags : {};
  const ruleSystem = safeMemory.ruleSystem && typeof safeMemory.ruleSystem === 'object' ? safeMemory.ruleSystem : {};
  const narrativeState = safeMemory.narrativeState && typeof safeMemory.narrativeState === 'object' ? safeMemory.narrativeState : {};
  const genre = String(narrativeState.lockedGenre || ruleSystem.contentPackId || flags.genre || 'custom').trim() || 'custom';
  const profile = getGenreNarrativeProfile(genre);
  const contract = profile
    ? {
        label: profile.label,
        pillars: profile.corePillars,
        supporting: profile.supportingElements,
        forbiddenDominance: profile.forbiddenDominance,
        defaultArc: profile.activeArc,
        routeReturnRule: profile.routeReturnRule
      }
    : fallbackContract(ruleSystem);
  const activeQuests = getActiveQuestTitles(worldState.quests);
  const explicitArc = String(narrativeState.activeArc || '').trim();
  const currentNode = String(flags.currentNode || '').trim();
  const activeArc = explicitArc || activeQuests[0] || currentNode || contract.defaultArc;

  return {
    mode: normalizeNarrativeMode(mode),
    genre,
    label: contract.label,
    pillars: preferList(narrativeState.corePillars, contract.pillars),
    supporting: preferList(narrativeState.supportingElements, contract.supporting),
    forbiddenDominance: preferList(narrativeState.forbiddenDominance, contract.forbiddenDominance),
    supportingArcs: normalizeList(narrativeState.supportingArcs),
    referenceFocus: normalizeList(narrativeState.referenceFocus),
    activeArc,
    activeQuests,
    currentPhase: String(flags.currentPhase || '').trim(),
    boundary: String(ruleSystem.boundary || '').trim(),
    routeReturnRule: String(narrativeState.routeReturnRule || contract.routeReturnRule || '').trim()
  };
}

export function buildNarrativeControlPrompt({ memory, mode } = {}) {
  const context = resolveNarrativeContext({ memory, mode });
  if (context.mode === 'free') {
    return [
      '# 叙事路线（自由模式）',
      `当前起始类型：${context.label}。`,
      '允许用户主动跨类型或更换主线，但已经建立的世界规则、角色关系和因果后果仍须保持一致。'
    ].join('\n');
  }

  const strict = context.mode === 'strict';
  const maxDetourTurns = strict ? 1 : 2;
  const lines = [
    `# 叙事路线锁（${strict ? '严格模式' : '稳定模式'}）`,
    '这是高优先级常驻契约，不得因最近几轮场景、随机灵感或滚动摘要而自行改写。',
    `主类型：${context.label}。`,
    `当前主线：${context.activeArc}。`,
    `题材支柱：${context.pillars.join('；')}。`,
    `允许作为辅线：${context.supporting.join('；')}。`,
    `不得成为主轴：${context.forbiddenDominance.join('；')}。`,
    `探索、解密、生存、恋爱或其他辅线可以充分展开，但最多连续 ${maxDetourTurns} 轮就必须回流至少一个题材支柱，并推进当前主线、稳定关系、资源代价或关键证据。`,
    '不能因为场景发生在荒野、遗迹或密室，就把故事改写成纯探险、纯解谜或另一种题材。',
    '除非用户明确提出“更换题材”“更换主线”或确认接受转向，否则不得修改主类型和当前主线。'
  ];
  if (strict) lines.push('每轮正文必须明确推进当前主线或一个题材支柱；无法推进时，应提供回归主线的自然机会，而不是继续扩张新支线。');
  if (context.routeReturnRule) lines.push(`本剧本回流规则：${context.routeReturnRule}`);
  if (context.supportingArcs.length) lines.push(`已登记的从属支线：${context.supportingArcs.join('；')}。这些支线不得自行升级为新主线。`);
  if (context.activeQuests.length > 1) lines.push(`仍在进行的任务：${context.activeQuests.join('；')}。`);
  if (context.currentPhase) lines.push(`当前阶段：${context.currentPhase}。`);
  if (context.boundary) lines.push(`内容包边界：${context.boundary}`);
  return lines.join('\n');
}

export function buildNarrativeMaintenanceAnchor(context) {
  if (!context || typeof context !== 'object') return '';
  const mode = normalizeNarrativeMode(context.mode);
  if (mode === 'free') return `起始类型：${context.label || context.genre || '自定义'}；用户可以主动转向。`;
  return [
    `锁定主类型：${context.label || context.genre || '自定义'}`,
    `当前主线：${context.activeArc || '尚未指定'}`,
    `题材支柱：${normalizeList(context.pillars).join('；') || '遵守当前内容包'}`,
    `辅线只能从属：${normalizeList(context.supporting).join('；') || '未声明'}`,
    `不得喧宾夺主：${normalizeList(context.forbiddenDominance).join('；') || '未声明'}`,
    normalizeList(context.supportingArcs).length ? `已登记从属支线：${normalizeList(context.supportingArcs).join('；')}` : '',
    '摘要和事实不得把一次性探索、解密或生存场景提升为新的主类型或主线。只有用户明确确认转向，才能修改这些锚点。'
  ].filter(Boolean).join('\n');
}

function getActiveQuestTitles(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((quest) => quest && typeof quest === 'object')
    .filter((quest) => !['done', 'completed', 'closed', 'failed'].includes(String(quest.status || '').toLowerCase()))
    .map((quest) => String(quest.title || quest.name || quest.id || '').trim())
    .filter(Boolean);
}

function fallbackContract(ruleSystem) {
  return {
    label: String(ruleSystem.title || '自定义剧本').trim() || '自定义剧本',
    pillars: ['当前角色目标', '已建立的世界规则', '人物关系与因果', '正在进行的任务'],
    supporting: ['探索', '解密', '生存', '战斗', '情感关系'],
    forbiddenDominance: ['未由用户确认的新题材取代当前剧本', '随机支线无限扩张', '一次性场景被误写为世界底层规则'],
    defaultArc: '当前剧本的主要任务',
    routeReturnRule: '支线必须回流当前角色目标、关系、资源或已建立任务。'
  };
}

function preferList(value, fallback) {
  const normalized = normalizeList(value);
  return normalized.length ? normalized : normalizeList(fallback);
}

function normalizeList(value) {
  return Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : [];
}
