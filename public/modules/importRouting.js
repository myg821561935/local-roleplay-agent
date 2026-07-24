const ORIGINAL_BASE_PACK_ID = '__original__';

const GENRE_HINTS = {
  xuanhuan: ['xuanhuan', '玄幻', '武道', '东方奇幻'],
  xianxia: ['xianxia', '仙侠', '修仙', '修真', '宗门'],
  lingyi: ['lingyi', '灵异', '怪谈', '恐怖', '民俗', '悬疑'],
  mingmo: ['mingmo', '明末', '历史', '古代', '朝堂'],
  yingxiongzhi: ['yingxiongzhi', '武侠', '江湖', '群像']
};

export const STORY_IMPORT_MODES = Object.freeze({
  ATTACH: 'attach-to-baseline',
  INDEPENDENT: 'independent-copy'
});

export function evaluateStoryImportRoute(preview = {}, {
  basePackId = '',
  basePackTitle = ''
} = {}) {
  const kind = String(preview.kind || '');
  const summary = preview.summary || {};
  if (kind === 'content-pack') {
    return {
      recommendedMode: STORY_IMPORT_MODES.INDEPENDENT,
      compatibility: 'self-contained',
      canAttach: false,
      reason: '这是自带规则与依赖的完整内容包，将按独立剧本安装，不会并入当前基线。'
    };
  }
  if (kind === 'plugin-manifest') {
    return {
      recommendedMode: STORY_IMPORT_MODES.ATTACH,
      compatibility: 'unsupported',
      canAttach: false,
      reason: '适配插件不是剧本素材，需先从扩展页安装。'
    };
  }
  if (kind === 'prompt-preset') {
    return {
      recommendedMode: STORY_IMPORT_MODES.ATTACH,
      compatibility: 'supplemental',
      canAttach: true,
      reason: 'Prompt 预设只负责提示词顺序、写作约束与生成参数，建议挂载到一个已有题材基线。'
    };
  }

  const normalizedBase = normalizeValue(basePackId);
  const declaredPacks = uniqueValues(summary.declaredContentPacks || summary.declaredContentPack);
  const genreHints = uniqueValues([
    summary.declaredGenre,
    ...(Array.isArray(summary.tags) ? summary.tags : [])
  ]);
  const declaredMismatch = declaredPacks.length > 0
    && normalizedBase !== ORIGINAL_BASE_PACK_ID
    && !declaredPacks.some((value) => normalizeValue(value) === normalizedBase);
  const hintedPacks = inferGenrePacks(genreHints);
  const genreMismatch = !declaredPacks.length
    && hintedPacks.length === 1
    && normalizedBase !== ORIGINAL_BASE_PACK_ID
    && !hintedPacks.includes(normalizedBase);
  const selfContained = summary.selfContained === true;

  if (normalizedBase === ORIGINAL_BASE_PACK_ID) {
    return {
      recommendedMode: STORY_IMPORT_MODES.INDEPENDENT,
      compatibility: 'independent',
      canAttach: true,
      reason: '当前选择的是原创空白基线，素材会作为独立剧本原件保存。'
    };
  }
  if (declaredMismatch || genreMismatch) {
    const declared = declaredPacks.length ? declaredPacks.join('、') : genreHints.join('、');
    return {
      recommendedMode: STORY_IMPORT_MODES.INDEPENDENT,
      compatibility: 'mismatch',
      canAttach: true,
      reason: `素材声明为“${declared || '其他题材'}”，与“${basePackTitle || basePackId || '当前基线'}”不一致，建议创建独立副本。`
    };
  }
  if (selfContained && !declaredPacks.some((value) => normalizeValue(value) === normalizedBase)) {
    return {
      recommendedMode: STORY_IMPORT_MODES.INDEPENDENT,
      compatibility: 'self-contained',
      canAttach: true,
      reason: '素材附带角色世界书或完整行为规则，独立副本能避免覆盖当前世界设定。'
    };
  }

  return {
    recommendedMode: STORY_IMPORT_MODES.ATTACH,
    compatibility: declaredPacks.length || hintedPacks.includes(normalizedBase) ? 'compatible' : 'unknown',
    canAttach: true,
    reason: declaredPacks.length || hintedPacks.includes(normalizedBase)
      ? `素材与“${basePackTitle || basePackId || '当前基线'}”题材相符，可作为补充素材挂载。`
      : '未发现明确题材冲突；可挂载到当前基线，也可手动创建独立副本。'
  };
}

function inferGenrePacks(values) {
  const text = values.join(' ').toLowerCase();
  if (!text) return [];
  return Object.entries(GENRE_HINTS)
    .filter(([, hints]) => hints.some((hint) => text.includes(hint.toLowerCase())))
    .map(([id]) => id);
}

function uniqueValues(values) {
  const list = Array.isArray(values) ? values : [values];
  return [...new Set(list.map((value) => String(value || '').trim()).filter(Boolean))];
}

function normalizeValue(value) {
  return String(value || '').trim().toLowerCase();
}
