const ROLEPLAY_BLOCKS = [
  'descriptive_analysis',
  'normal_status',
  'plot',
  'relationship_status',
  'special_status',
  'NextCharacterPanel'
];

// Community presets commonly use both the correct <planning> spelling and the
// legacy SillyTavern typo <planing>. Treat both as control-plane output so the
// model's private generation plan never becomes story prose.
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

export function parseRoleplayResponse(rawContent) {
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
    recommendedActions: extractCommunityActions(normalizedSource),
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

function extractCommunityActions(source) {
  const actions = COMMUNITY_ACTION_BLOCKS.flatMap((tag) => extractBlocks(source, tag)).flatMap((block) => String(block || '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<!--([\s\S]*?)-->/g, '')
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(?:[A-FＡ-Ｆ]|\d{1,2})\s*[:：.)、-]\s*(.+?)\s*$/i)?.[1] || '')
    .map((line) => line.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 2 && line.length <= 240));
  const unique = Array.from(new Set(actions));
  return unique.length >= 2 ? unique.slice(0, 6) : [];
}

function stripRecommendedActionBlocks(source) {
  return String(source || '').replace(
    /<recommended_actions\b[^>]*>[\s\S]*?<\/recommended_actions\s*>/ig,
    '\n'
  );
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
    const complete = new RegExp(`<${escapedTag}(?=[\\s>/])[^>]*>[\\s\\S]*?<\\/${escapedTag}\\s*>`, 'ig');
    const partial = new RegExp(`<${escapedTag}(?=[\\s>/])[^>]*>[\\s\\S]*$`, 'ig');
    const closing = new RegExp(`<\\/${escapedTag}\\s*>`, 'ig');
    result = result.replace(complete, '\n').replace(partial, '\n').replace(closing, '\n');
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
