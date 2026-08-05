const ROLEPLAY_BLOCKS = [
  'descriptive_analysis',
  'normal_status',
  'plot',
  'relationship_status',
  'special_status',
  'NextCharacterPanel'
];

// Keep this list aligned with the server parser. The misspelled <planing> tag
// is widespread in imported community presets and must also be safe for saved
// messages created before the server-side parser learned about it.
const ANALYSIS_BLOCKS = ['descriptive_analysis', 'think', 'thinking', 'analysis', 'planning', 'planing'];
const TRANSPARENT_WRAPPERS = ['ai_last_output', 'dream_plot', 'StatusBlock'];
const CONTENT_BLOCKS = ['content', '正文', 'msg', 'dream_body'];
const TOOL_ACTIVITY_BLOCKS = ['web_search', 'web_search_results', 'search_results', 'tool_result', 'tool_results'];
const COMMUNITY_PANEL_BLOCKS = ['bginfor', 'catsay', 'dream_scene', 'dream_summary', 'dream_discuss', 'dream_big_discuss'];
const STATUS_PANEL_BLOCKS = ['CharacterStatus'];
const COMMUNITY_ACTION_BLOCKS = ['w2g', 'dream_option'];
const PRESENTATION_BLOCKS = [
  ...ROLEPLAY_BLOCKS,
  ...ANALYSIS_BLOCKS,
  ...CONTENT_BLOCKS,
  ...TOOL_ACTIVITY_BLOCKS,
  ...COMMUNITY_PANEL_BLOCKS,
  ...STATUS_PANEL_BLOCKS,
  ...COMMUNITY_ACTION_BLOCKS
];
const CONTROL_BLOCK_START = /<(?:recommended_actions|lra-actions|lra-mvu-patch|mvu_patch)\b|```(?:lra-actions|lra-mvu-patch)\b/i;
const CONTROL_PREFIXES = [
  ...PRESENTATION_BLOCKS.map((tag) => `<${String(tag).toLowerCase()}`),
  ...TRANSPARENT_WRAPPERS.map((tag) => `<${String(tag).toLowerCase()}`),
  '<recommended_actions',
  '<lra-actions',
  '<lra-mvu-patch',
  '<mvu_patch',
  '```lra-actions',
  '```lra-mvu-patch'
];

export function extractRoleplayPresentation(rawContent) {
  const source = String(rawContent || '');
  if (looksLikePartialProtocolPrefix(source)) {
    return { content: '', speaker: '', protocolDetected: true, panels: {}, recommendedActions: [] };
  }
  const normalizedSource = unwrapTransparentBlocks(source);
  const presentationSource = stripRecommendedActionBlocks(normalizedSource);
  const protocolDetected = [...PRESENTATION_BLOCKS, ...TRANSPARENT_WRAPPERS]
    .some((tag) => new RegExp(`<${escapeRegExp(tag)}(?=[\\s>/])`, 'i').test(source));
  const plotBlocks = extractBlocks(presentationSource, 'plot', { includePartial: true });
  const contentBlocks = CONTENT_BLOCKS.flatMap((tag) => extractBlocks(presentationSource, tag, { includePartial: true }));
  const visibleSource = plotBlocks.length
    ? plotBlocks.join('\n\n')
    : contentBlocks.length
      ? contentBlocks.join('\n\n')
      : protocolDetected
        ? stripProtocolBlocks(presentationSource)
        : truncateControlBlocks(presentationSource);
  const { content, speaker } = cleanVisibleText(visibleSource);
  const directorNotes = ANALYSIS_BLOCKS
    .map((tag) => cleanPanelText(extractBlocks(normalizedSource, tag).join('\n\n')))
    .filter(Boolean)
    .join('\n\n');

  return {
    content,
    speaker,
    protocolDetected,
    recommendedActions: sanitizeRecommendedActions([
      ...extractRecommendedActions(normalizedSource),
      ...extractCommunityActions(normalizedSource)
    ], 6),
    panels: compactPanels({
      directorNotes,
      sceneStatus: cleanPanelText([
        ...extractBlocks(normalizedSource, 'normal_status'),
        ...extractBlocks(normalizedSource, 'bginfor'),
        ...extractBlocks(normalizedSource, 'dream_scene'),
        ...extractBlocks(normalizedSource, 'dream_summary')
      ].join('\n\n')),
      relationshipStatus: cleanPanelText(extractBlocks(normalizedSource, 'relationship_status').join('\n\n')),
      characterStatus: cleanPanelText([
        ...extractBlocks(normalizedSource, 'special_status'),
        ...STATUS_PANEL_BLOCKS.flatMap((tag) => extractBlocks(normalizedSource, tag))
      ].join('\n\n')),
      nextCharacter: cleanPanelText(extractBlocks(normalizedSource, 'NextCharacterPanel').join('\n\n')),
      communityComment: cleanPanelText([
        ...extractBlocks(normalizedSource, 'catsay'),
        ...extractBlocks(normalizedSource, 'dream_discuss'),
        ...extractBlocks(normalizedSource, 'dream_big_discuss')
      ].join('\n\n')),
      toolActivity: cleanPanelText(TOOL_ACTIVITY_BLOCKS
        .flatMap((tag) => extractBlocks(normalizedSource, tag))
        .join('\n\n'))
    })
  };
}

function stripRecommendedActionBlocks(source) {
  return String(source || '').replace(
    /<recommended_actions\b[^>]*>[\s\S]*?<\/recommended_actions\s*>/ig,
    '\n'
  );
}

function extractRecommendedActions(source) {
  const actions = [];
  const pattern = /<recommended_actions\b[^>]*>\s*([\s\S]*?)\s*<\/recommended_actions\s*>/ig;
  let match;
  while ((match = pattern.exec(String(source || '')))) {
    actions.push(...parseRecommendedActions(match[1]));
  }
  return sanitizeRecommendedActions(actions);
}

function extractCommunityActions(source) {
  return COMMUNITY_ACTION_BLOCKS.flatMap((tag) => extractBlocks(source, tag)).flatMap((block) => String(block || '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<!--([\s\S]*?)-->/g, '')
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(?:[A-FＡ-Ｆ]|\d{1,2})\s*[:：.)、-]\s*(.+?)\s*$/i)?.[1] || '')
    .map((line) => line.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean));
}

function parseRecommendedActions(value) {
  try {
    const parsed = JSON.parse(String(value || '').trim());
    if (!Array.isArray(parsed)) return [];
    return sanitizeRecommendedActions(parsed);
  } catch {
    return sanitizeRecommendedActions(String(value || '')
      .split('\n')
      .map((line) => line.replace(/^[-*\d.、\s]+/, '').trim()));
  }
}

function sanitizeRecommendedActions(values = [], maxActions = 4) {
  const protocolLeak = /(?:<\/?(?:think|analysis|plot|normal_status|relationship_status|special_status|NextCharacterPanel|recommended_actions)\b|recommended_actions|Ira-actions|正文前(?:注释|格式)|天机选项块|step\s*\d+|--?>|《end》|<\/think>)/i;
  const instructionLeak = /(?:如果稳定变化需要输出|结束需要|输出格式|格式为|正文前|正文后|以下标签|x\s*3)/i;
  const actions = Array.from(new Set((Array.isArray(values) ? values : [values])
    .map((item) => String(item || '').replace(/\s+/g, ' ').trim())
    .filter((item) => item.length >= 2 && item.length <= 120)
    .filter((item) => !protocolLeak.test(item) && !instructionLeak.test(item))
    .filter((item) => !/^[;；<>{}\[\]()\/\\|=_-]+/.test(item))
    .filter((item) => /[\p{L}\p{N}]/u.test(item))));
  return actions.length >= 2 ? actions.slice(0, maxActions) : [];
}

export function splitCharacterStatus(value, protagonistNames = []) {
  const text = String(value || '').trim();
  if (!text) return { protagonist: '', interactive: '' };
  const names = protagonistNames.map((name) => String(name || '').trim()).filter(Boolean);
  const chunks = text.split(/(?=^[『【\[][^\n』】\]]+(?:状态|档案)[』】\]])/gm).filter(Boolean);
  if (chunks.length < 2 || !names.length) return { protagonist: '', interactive: text };

  const protagonist = [];
  const interactive = [];
  chunks.forEach((chunk) => {
    const belongsToProtagonist = names.some((name) => chunk.includes(name));
    (belongsToProtagonist ? protagonist : interactive).push(chunk.trim());
  });
  return {
    protagonist: protagonist.join('\n\n'),
    interactive: interactive.join('\n\n')
  };
}

function extractBlocks(source, tag, { includePartial = false } = {}) {
  const text = String(source || '');
  const lower = text.toLowerCase();
  const openPattern = new RegExp(`<${escapeRegExp(tag)}(?=[\\s>/])[^>]*>`, 'ig');
  const closeTag = `</${String(tag).toLowerCase()}>`;
  const values = [];
  let match;
  while ((match = openPattern.exec(text))) {
    const contentStart = openPattern.lastIndex;
    const closeIndex = lower.indexOf(closeTag, contentStart);
    if (closeIndex < 0) {
      if (includePartial) values.push(text.slice(contentStart));
      break;
    }
    values.push(text.slice(contentStart, closeIndex));
    openPattern.lastIndex = closeIndex + closeTag.length;
  }
  return values;
}

function stripProtocolBlocks(source) {
  let result = truncateControlBlocks(source);
  PRESENTATION_BLOCKS.forEach((tag) => {
    const escapedTag = escapeRegExp(tag);
    result = result
      .replace(new RegExp(`<${escapedTag}(?=[\\s>/])[^>]*>[\\s\\S]*?<\\/${escapedTag}\\s*>`, 'ig'), '\n')
      .replace(new RegExp(`<${escapedTag}(?=[\\s>/])[^>]*>[\\s\\S]*$`, 'ig'), '\n')
      .replace(new RegExp(`<\\/${escapedTag}\\s*>`, 'ig'), '\n');
  });
  return result;
}

function unwrapTransparentBlocks(source) {
  let result = String(source || '');
  TRANSPARENT_WRAPPERS.forEach((tag) => {
    result = result
      .replace(new RegExp(`<${tag}\\b[^>]*>`, 'ig'), '')
      .replace(new RegExp(`<\\/${tag}\\s*>`, 'ig'), '');
  });
  return result;
}

function truncateControlBlocks(source) {
  const text = String(source || '');
  const match = text.match(CONTROL_BLOCK_START);
  let cutIndex = match ? Number(match.index) : text.length;
  const lower = text.toLowerCase();
  for (const prefix of CONTROL_PREFIXES) {
    for (let length = 1; length < prefix.length; length += 1) {
      const partial = prefix.slice(0, length);
      if (!lower.endsWith(partial)) continue;
      const index = text.length - partial.length;
      const previous = index > 0 ? text[index - 1] : '';
      if (index === 0 || /\s/.test(previous)) cutIndex = Math.min(cutIndex, index);
    }
  }
  return text.slice(0, cutIndex);
}

function cleanVisibleText(value) {
  let content = String(value || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/^\s*(?:正文内容|故事正文|正文)\s*[:：]\s*/i, '')
    .replace(/<\/?(?:plot|details|summary)\b[^>]*>/gi, '')
    .trim();
  const speakerMatch = content.match(/^【([^】\n]{1,30})】\s*/);
  const speaker = speakerMatch ? speakerMatch[1].trim() : '';
  if (speakerMatch) content = content.slice(speakerMatch[0].length).trim();
  return { content, speaker };
}

function cleanPanelText(value) {
  const panelTags = [...PRESENTATION_BLOCKS, ...TRANSPARENT_WRAPPERS]
    .map((tag) => escapeRegExp(tag))
    .join('|');
  return String(value || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<summary\b[^>]*>[\s\S]*?<\/summary\s*>/gi, '')
    .replace(/<\/?details\b[^>]*>/gi, '')
    .replace(/^```(?:ya?ml|json|markdown|md)?\s*$/gim, '')
    .replace(/^```\s*$/gim, '')
    .replace(new RegExp(`<\\/?(?:${panelTags})(?=[\\s>/])[^>]*>`, 'gi'), '')
    .trim();
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compactPanels(panels) {
  return Object.fromEntries(Object.entries(panels).filter(([, value]) => Boolean(value)));
}

function looksLikePartialProtocolPrefix(source) {
  const value = String(source || '').trimStart().toLowerCase();
  if (!value) return false;
  return CONTROL_PREFIXES.some((start) => start.startsWith(value));
}
