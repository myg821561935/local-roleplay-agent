const ROLEPLAY_BLOCKS = [
  'descriptive_analysis',
  'normal_status',
  'plot',
  'relationship_status',
  'special_status',
  'NextCharacterPanel'
];

const CONTROL_BLOCK_START = /<(?:recommended_actions|lra-actions)\b|```lra-actions\b/i;

export function parseRoleplayResponse(rawContent) {
  const source = String(rawContent || '');
  if (looksLikePartialProtocolPrefix(source)) {
    return { content: '', speaker: '', protocolDetected: true, panels: {} };
  }
  const protocolDetected = ROLEPLAY_BLOCKS.some((tag) => new RegExp(`<${tag}\\b`, 'i').test(source));
  const plotBlocks = extractBlocks(source, 'plot', { includePartial: true });
  const visibleSource = plotBlocks.length
    ? plotBlocks.join('\n\n')
    : protocolDetected
      ? stripProtocolBlocks(source)
      : truncateControlBlocks(source);
  const { content, speaker } = cleanVisibleText(visibleSource);

  return {
    content,
    speaker,
    protocolDetected,
    panels: compactPanels({
      sceneStatus: cleanPanelText(extractBlocks(source, 'normal_status').join('\n\n')),
      relationshipStatus: cleanPanelText(extractBlocks(source, 'relationship_status').join('\n\n')),
      characterStatus: cleanPanelText(extractBlocks(source, 'special_status').join('\n\n')),
      nextCharacter: cleanPanelText(extractBlocks(source, 'NextCharacterPanel').join('\n\n'))
    })
  };
}

function extractBlocks(source, tag, { includePartial = false } = {}) {
  const text = String(source || '');
  const lower = text.toLowerCase();
  const openPattern = new RegExp(`<${tag}\\b[^>]*>`, 'ig');
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
  ROLEPLAY_BLOCKS.forEach((tag) => {
    const complete = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'ig');
    const partial = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*$`, 'ig');
    const closing = new RegExp(`<\\/${tag}\\s*>`, 'ig');
    result = result.replace(complete, '\n').replace(partial, '\n').replace(closing, '\n');
  });
  return result;
}

function truncateControlBlocks(source) {
  const text = String(source || '');
  const match = text.match(CONTROL_BLOCK_START);
  return match ? text.slice(0, match.index) : text;
}

function cleanVisibleText(value) {
  let content = String(value || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*(?:正文内容|故事正文|正文)\s*[:：]\s*/i, '')
    .replace(/<\/?(?:plot|details|summary)\b[^>]*>/gi, '')
    .trim();
  const speakerMatch = content.match(/^【([^】\n]{1,30})】\s*/);
  const speaker = speakerMatch ? speakerMatch[1].trim() : '';
  if (speakerMatch) content = content.slice(speakerMatch[0].length).trim();
  return { content, speaker };
}

function cleanPanelText(value) {
  return String(value || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<summary\b[^>]*>[\s\S]*?<\/summary\s*>/gi, '')
    .replace(/<\/?details\b[^>]*>/gi, '')
    .replace(/^```(?:ya?ml|json|markdown|md)?\s*$/gim, '')
    .replace(/^```\s*$/gim, '')
    .replace(/<\/?(?:normal_status|relationship_status|special_status|NextCharacterPanel)\b[^>]*>/gi, '')
    .trim();
}

function compactPanels(panels) {
  return Object.fromEntries(Object.entries(panels).filter(([, value]) => Boolean(value)));
}

function looksLikePartialProtocolPrefix(source) {
  const value = String(source || '').trimStart().toLowerCase();
  if (!value.startsWith('<')) return false;
  const starts = [...ROLEPLAY_BLOCKS, 'recommended_actions', 'lra-actions']
    .map((tag) => `<${String(tag).toLowerCase()}`);
  return starts.some((start) => start.startsWith(value));
}
