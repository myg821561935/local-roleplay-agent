const ROLEPLAY_BLOCKS = [
  'descriptive_analysis',
  'normal_status',
  'plot',
  'relationship_status',
  'special_status',
  'NextCharacterPanel'
];

const CONTROL_BLOCK_START = /<(?:recommended_actions|lra-actions|lra-mvu-patch|mvu_patch)\b|```(?:lra-actions|lra-mvu-patch)\b/i;
const CONTROL_PREFIXES = [
  ...ROLEPLAY_BLOCKS.map((tag) => `<${String(tag).toLowerCase()}`),
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
    recommendedActions: extractRecommendedActions(source),
    panels: compactPanels({
      sceneStatus: cleanPanelText(extractBlocks(source, 'normal_status').join('\n\n')),
      relationshipStatus: cleanPanelText(extractBlocks(source, 'relationship_status').join('\n\n')),
      characterStatus: cleanPanelText(extractBlocks(source, 'special_status').join('\n\n')),
      nextCharacter: cleanPanelText(extractBlocks(source, 'NextCharacterPanel').join('\n\n'))
    })
  };
}

function extractRecommendedActions(source) {
  const actions = [];
  const pattern = /<recommended_actions\b[^>]*>\s*([\s\S]*?)\s*<\/recommended_actions\s*>/ig;
  let match;
  while ((match = pattern.exec(String(source || '')))) {
    actions.push(...parseRecommendedActions(match[1]));
  }
  return Array.from(new Set(actions)).slice(0, 4);
}

function parseRecommendedActions(value) {
  try {
    const parsed = JSON.parse(String(value || '').trim());
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 4);
  } catch {
    return String(value || '')
      .split('\n')
      .map((line) => line.replace(/^[-*\d.、\s]+/, '').trim())
      .filter(Boolean)
      .slice(0, 4);
  }
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
    result = result
      .replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'ig'), '\n')
      .replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*$`, 'ig'), '\n')
      .replace(new RegExp(`<\\/${tag}\\s*>`, 'ig'), '\n');
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
  if (!value) return false;
  return CONTROL_PREFIXES.some((start) => start.startsWith(value));
}
