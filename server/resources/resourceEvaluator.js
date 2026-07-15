const DIMENSION_DEFINITIONS = [
  { id: 'structure', label: '结构完整', weight: 30 },
  { id: 'activation', label: '运行可用', weight: 30 },
  { id: 'consistency', label: '一致性', weight: 20 },
  { id: 'efficiency', label: '上下文效率', weight: 15 },
  { id: 'provenance', label: '来源信息', weight: 5 }
];

export function evaluateResourceCandidate(candidate, {
  conflicts = [],
  source = {},
  adapter = {}
} = {}) {
  const warnings = [];
  const missingFields = [];
  const blockingIssues = [];
  const riskFlags = detectExecutionRisks(candidate?.payload);
  const estimatedTokens = estimateResourceTokens(candidate?.payload);
  const context = {
    candidate,
    conflicts,
    source,
    adapter,
    warnings,
    missingFields,
    blockingIssues,
    riskFlags,
    estimatedTokens
  };

  let scores;
  let stats;
  if (candidate?.kind === 'character') {
    ({ scores, stats } = evaluateCharacter(context));
  } else if (candidate?.kind === 'worldbook') {
    ({ scores, stats } = evaluateWorldBook(context));
  } else if (candidate?.kind === 'prompt') {
    ({ scores, stats } = evaluatePrompt(context));
  } else {
    blockingIssues.push({ code: 'UNSUPPORTED_RESOURCE_KIND', message: '无法识别素材类型。' });
    scores = { structure: 0, activation: 0, consistency: 0, efficiency: 0, provenance: 0 };
    stats = {};
  }

  const exactDuplicates = conflicts.filter((item) => item.type === 'exact-duplicate').length;
  const sameTitles = conflicts.filter((item) => item.type === 'same-title').length;
  if (exactDuplicates) {
    warnings.push({ code: 'EXACT_DUPLICATE', message: '素材库中已有完全相同的内容，本次不会重复保存。' });
  }
  if (sameTitles) {
    warnings.push({ code: 'SAME_TITLE_DIFFERENT_CONTENT', message: '素材库中存在同名不同内容，将作为独立版本保留。' });
  }

  scores.consistency = clampScore(
    Number(scores.consistency || 0)
      - Math.min(36, sameTitles * 18)
      - Math.min(30, riskFlags.length * 15)
  );
  scores.provenance = scoreProvenance(source, adapter);

  const dimensions = DIMENSION_DEFINITIONS.map((definition) => createDimension(
    definition,
    scores[definition.id],
    dimensionSummary(definition.id, scores[definition.id], candidate?.kind, stats)
  ));
  const score = weightedDimensionScore(dimensions);
  const isExactDuplicate = exactDuplicates > 0;
  const verdict = resolveVerdict({ score, blockingIssues, isExactDuplicate });

  return {
    score,
    grade: gradeForScore(score),
    verdict: verdict.id,
    verdictLabel: verdict.label,
    recommendation: verdict.summary,
    canImport: blockingIssues.length === 0 && !isExactDuplicate,
    estimatedTokens,
    dimensions,
    stats,
    warnings,
    missingFields,
    blockingIssues,
    conflicts,
    riskFlags
  };
}

export function aggregateResourceEvaluations(evaluations = []) {
  const items = evaluations.filter(Boolean);
  const dimensions = DIMENSION_DEFINITIONS.map((definition) => {
    const matching = items
      .flatMap((item) => item.dimensions || [])
      .filter((dimension) => dimension.id === definition.id);
    const score = matching.length
      ? Math.round(matching.reduce((sum, item) => sum + Number(item.score || 0), 0) / matching.length)
      : 0;
    return createDimension(definition, score, aggregateDimensionSummary(definition.id, score));
  });
  const score = items.length ? weightedDimensionScore(dimensions) : 0;
  const blockingCount = items.reduce((sum, item) => sum + (item.blockingIssues?.length || 0), 0);
  const allDuplicates = items.length > 0 && items.every((item) => item.verdict === 'duplicate');
  const verdict = resolveVerdict({ score, blockingIssues: blockingCount ? [{}] : [], isExactDuplicate: allDuplicates });

  return {
    score,
    grade: gradeForScore(score),
    verdict: verdict.id,
    verdictLabel: verdict.label,
    summary: verdict.summary,
    canImport: items.length > 0 && blockingCount === 0 && !allDuplicates,
    estimatedTokens: items.reduce((sum, item) => sum + Number(item.estimatedTokens || 0), 0),
    dimensions,
    blockingCount,
    warningCount: items.reduce((sum, item) => sum + (item.warnings?.length || 0), 0),
    conflictCount: items.reduce((sum, item) => sum + (item.conflicts?.length || 0), 0),
    riskCount: items.reduce((sum, item) => sum + (item.riskFlags?.length || 0), 0)
  };
}

export function detectExecutionRisks(payload) {
  const text = JSON.stringify(payload || {}).toLowerCase();
  const patterns = [
    ['script-tag', '<script', '包含脚本标签；只会作为文本保存，不会执行。'],
    ['process-command', 'child_process', '包含进程执行描述；不会获得本机执行权限。'],
    ['mcp-command', 'mcpservers', '包含 MCP 配置片段；不会自动注册或连接。'],
    ['shell-command', 'shell_command', '包含 Shell 命令字段；不会自动执行。']
  ];
  return patterns
    .filter(([, marker]) => text.includes(marker))
    .map(([code, , message]) => ({ code, message }));
}

export function estimateResourceTokens(payload) {
  const text = JSON.stringify(payload || {});
  if (!text || text === '{}') return 0;
  const cjkCount = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const remainingLength = Math.max(0, text.length - cjkCount);
  return Math.max(1, Math.ceil(cjkCount + remainingLength / 4));
}

function evaluateCharacter(context) {
  const card = context.candidate.payload || {};
  const fields = [
    ['name', '角色名称'],
    ['description', '角色描述'],
    ['personality', '性格'],
    ['scenario', '当前场景'],
    ['firstMessage', '开场白']
  ];
  const presentCount = fields.reduce((count, [field, label]) => {
    if (String(card[field] || '').trim()) return count + 1;
    context.missingFields.push({ field, label });
    return count;
  }, 0);
  const narrativeFields = ['description', 'personality', 'scenario', 'firstMessage'];
  const narrativeCount = narrativeFields.filter((field) => String(card[field] || '').trim()).length;
  if (!String(card.name || '').trim()) {
    context.blockingIssues.push({ code: 'CHARACTER_WITHOUT_NAME', message: '角色卡缺少名称，无法建立稳定身份。' });
  }
  if (!narrativeCount) {
    context.blockingIssues.push({ code: 'CHARACTER_WITHOUT_NARRATIVE_CORE', message: '角色描述、性格、场景和开场白均为空。' });
  }

  const behaviorRule = String(card.systemPrompt || card.postHistoryInstructions || '').trim();
  const examples = Array.isArray(card.exampleDialog) ? card.exampleDialog.filter(Boolean) : [];
  if (!behaviorRule) {
    context.warnings.push({ code: 'CHARACTER_WITHOUT_BEHAVIOR_RULE', message: '缺少角色行为约束，长对话中更容易偏离人设。' });
  }
  if (!examples.length) {
    context.warnings.push({ code: 'CHARACTER_WITHOUT_DIALOG_EXAMPLE', message: '没有示例对话，语言风格主要依赖模型自行发挥。' });
  }

  const personaLength = String(card.description || '').length + String(card.personality || '').length;
  const personaDepth = scoreTextDepth(personaLength, [24, 90, 220]);
  const behaviorScore = (behaviorRule ? 100 : 45);
  const dialogueScore = Math.round((String(card.firstMessage || '').trim() ? 65 : 0) + (examples.length ? 35 : 0));
  const activation = Math.round(personaDepth * 0.4 + behaviorScore * 0.35 + dialogueScore * 0.25);

  return {
    scores: {
      structure: Math.round((presentCount / fields.length) * 100),
      activation,
      consistency: 100,
      efficiency: scoreTokenEfficiency(context.estimatedTokens, [2200, 5200, 10000]),
      provenance: 0
    },
    stats: {
      fieldCount: presentCount,
      requiredFieldCount: fields.length,
      exampleDialogCount: examples.length,
      personaCharacters: personaLength
    }
  };
}

function evaluateWorldBook(context) {
  const entries = Array.isArray(context.candidate.payload?.entries) ? context.candidate.payload.entries : [];
  if (!entries.length) {
    context.missingFields.push({ field: 'entries', label: '世界书条目' });
    context.blockingIssues.push({ code: 'WORLD_BOOK_WITHOUT_ENTRIES', message: '世界书没有可导入条目。' });
  }

  const withContent = entries.filter((entry) => String(entry.content || '').trim());
  const withTitle = entries.filter((entry) => String(entry.title || '').trim());
  const triggerable = entries.filter((entry) => entry.constant || (entry.keywords || []).length || (entry.regex || []).length);
  const inertEntries = entries.filter((entry) => !entry.constant && !(entry.keywords || []).length && !(entry.regex || []).length);
  const invalidRegexCount = entries.reduce((count, entry) => count + countInvalidRegex(entry.regex), 0);
  const duplicateTitles = findDuplicates(entries.map((entry) => normalizeKey(entry.title)).filter(Boolean));
  const duplicateTriggers = findDuplicates(entries.flatMap((entry) => [
    ...(entry.keywords || []),
    ...(entry.regex || [])
  ]).map(normalizeKey).filter(Boolean));
  const constantEntries = entries.filter((entry) => entry.constant);
  const constantTokens = constantEntries.reduce((sum, entry) => sum + estimateResourceTokens(entry.content), 0);

  if (inertEntries.length) {
    context.warnings.push({ code: 'WORLD_BOOK_INERT_ENTRIES', message: `${inertEntries.length} 条设定没有关键词、正则或常驻标记，可能永远不会触发。` });
  }
  if (duplicateTitles.length) {
    context.warnings.push({ code: 'WORLD_BOOK_DUPLICATE_TITLES', message: `存在 ${duplicateTitles.length} 组同名条目，建议确认覆盖关系。` });
  }
  if (duplicateTriggers.length) {
    context.warnings.push({ code: 'WORLD_BOOK_OVERLAPPING_TRIGGERS', message: `${duplicateTriggers.length} 个触发词被多条设定共用，触发时可能同时注入。` });
  }
  if (invalidRegexCount) {
    context.warnings.push({ code: 'WORLD_BOOK_INVALID_REGEX', message: `${invalidRegexCount} 条正则无法解析，建议导入后修正。` });
  }
  if (entries.length > 240) {
    context.warnings.push({ code: 'WORLD_BOOK_LARGE', message: '条目很多，建议用触发词和深度控制上下文用量。' });
  }

  const total = Math.max(1, entries.length);
  const structure = entries.length
    ? Math.round((withContent.length / total) * 75 + (withTitle.length / total) * 15 + 10)
    : 0;
  const activation = entries.length
    ? Math.round((triggerable.length / total) * 85 + Math.max(0, 15 - invalidRegexCount * 5))
    : 0;
  const consistency = clampScore(100 - duplicateTitles.length * 12 - duplicateTriggers.length * 3);
  const efficiency = clampScore(
    scoreTokenEfficiency(context.estimatedTokens, [5000, 14000, 32000])
      - Math.min(25, Math.max(0, constantTokens - 3200) / 200)
      - (entries.length > 240 ? 8 : 0)
  );

  return {
    scores: { structure, activation, consistency, efficiency, provenance: 0 },
    stats: {
      entryCount: entries.length,
      triggerableCount: triggerable.length,
      inertCount: inertEntries.length,
      constantCount: constantEntries.length,
      constantTokens,
      invalidRegexCount,
      duplicateTriggerCount: duplicateTriggers.length
    }
  };
}

function evaluatePrompt(context) {
  const prompt = context.candidate.payload || {};
  const title = String(prompt.title || '').trim();
  const content = String(prompt.content || '').trim();
  if (!title) context.missingFields.push({ field: 'title', label: 'Prompt 标题' });
  if (!content) {
    context.missingFields.push({ field: 'content', label: 'Prompt 内容' });
    context.blockingIssues.push({ code: 'PROMPT_WITHOUT_CONTENT', message: 'Prompt 没有可导入内容。' });
  }
  if (content && content.length < 40) {
    context.warnings.push({ code: 'PROMPT_TOO_SHORT', message: 'Prompt 很短，可能不足以稳定约束叙事行为。' });
  }
  const structure = Math.round((title ? 20 : 0) + (content ? 80 : 0));
  const activation = scoreTextDepth(content.length, [40, 180, 600]);
  return {
    scores: {
      structure,
      activation,
      consistency: 100,
      efficiency: scoreTokenEfficiency(context.estimatedTokens, [1200, 3000, 7000]),
      provenance: 0
    },
    stats: { contentCharacters: content.length }
  };
}

function scoreProvenance(source, adapter) {
  let score = 0;
  if (adapter?.id && !String(adapter.id).includes('generic')) score += 35;
  else if (adapter?.id) score += 20;
  if (source?.site || source?.sourceId) score += 25;
  if (source?.fileName || source?.url) score += 20;
  if (source?.author) score += 12;
  if (source?.version) score += 8;
  return clampScore(score);
}

function scoreTextDepth(length, [minimum, good, excellent]) {
  if (!length) return 0;
  if (length >= excellent) return 100;
  if (length >= good) return 84;
  if (length >= minimum) return 68;
  return 42;
}

function scoreTokenEfficiency(tokens, [ideal, review, heavy]) {
  if (!tokens) return 100;
  if (tokens <= ideal) return 100;
  if (tokens <= review) return 86;
  if (tokens <= heavy) return 70;
  return Math.max(35, 70 - Math.ceil((tokens - heavy) / Math.max(1, heavy / 8)) * 4);
}

function createDimension(definition, score, summary) {
  const normalizedScore = clampScore(score);
  return {
    id: definition.id,
    label: definition.label,
    weight: definition.weight,
    score: normalizedScore,
    status: normalizedScore >= 85 ? 'good' : normalizedScore >= 65 ? 'review' : 'weak',
    summary
  };
}

function weightedDimensionScore(dimensions) {
  const weight = dimensions.reduce((sum, item) => sum + Number(item.weight || 0), 0) || 1;
  return Math.round(dimensions.reduce((sum, item) => sum + item.score * item.weight, 0) / weight);
}

function gradeForScore(score) {
  return score >= 85 ? '完整' : score >= 65 ? '可用' : '待补全';
}

function resolveVerdict({ score, blockingIssues, isExactDuplicate }) {
  if (blockingIssues.length) {
    return { id: 'blocked', label: '暂不可入库', summary: '存在关键结构缺失，请修正后重新预览。' };
  }
  if (isExactDuplicate) {
    return { id: 'duplicate', label: '已在素材库', summary: '检测到完全相同的资源，无需重复保存。' };
  }
  if (score >= 85) {
    return { id: 'recommended', label: '建议入库', summary: '结构与运行信息较完整，可直接进入素材库。' };
  }
  if (score >= 65) {
    return { id: 'review', label: '审阅后入库', summary: '资源可以使用，但建议先查看提示项。' };
  }
  return { id: 'needs-work', label: '建议先完善', summary: '资源可保存，但稳定性和可触发性仍有明显缺口。' };
}

function dimensionSummary(id, score, kind, stats = {}) {
  if (id === 'structure') {
    if (kind === 'worldbook') return `${stats.entryCount || 0} 条设定，${stats.triggerableCount || 0} 条可触发`;
    if (kind === 'character') return `${stats.fieldCount || 0}/${stats.requiredFieldCount || 0} 个核心字段`;
    return `${stats.contentCharacters || 0} 字内容`;
  }
  if (id === 'activation') {
    if (kind === 'worldbook') return stats.inertCount ? `${stats.inertCount} 条尚未配置触发条件` : '触发条件已覆盖';
    if (kind === 'character') return `${stats.exampleDialogCount || 0} 组示例对话`;
    return score >= 85 ? '指令信息充足' : '指令信息偏少';
  }
  if (id === 'consistency') return score >= 85 ? '未发现明显冲突' : '存在重名、重叠或执行标记';
  if (id === 'efficiency') return score >= 85 ? '上下文体量适中' : '建议压缩常驻内容';
  if (id === 'provenance') return score >= 65 ? '来源可追溯' : '作者或版本信息不完整';
  return '';
}

function aggregateDimensionSummary(id, score) {
  const labels = {
    structure: '全部资源的结构覆盖',
    activation: '角色约束与世界书触发',
    consistency: '重名、重叠与冲突检查',
    efficiency: '预计上下文占用',
    provenance: '来源、作者与版本记录'
  };
  return `${labels[id] || '综合检查'} · ${score} 分`;
}

function countInvalidRegex(values) {
  return (Array.isArray(values) ? values : []).reduce((count, value) => {
    try {
      new RegExp(String(value || ''));
      return count;
    } catch {
      return count + 1;
    }
  }, 0);
}

function findDuplicates(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value || 0))));
}
