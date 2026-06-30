import { estimateTokens } from './token.js';
import { normalizeFactCards } from './factCards.js';
import { retrieveCards } from './memoryRetriever.js';

export function assemblePrompt({
  promptModules,
  characterCard,
  worldBook,
  memory,
  messages,
  userMessage,
  options = {}
}) {
  const safePromptModules = Array.isArray(promptModules) ? promptModules : [];
  const safeWorldBook = Array.isArray(worldBook) ? worldBook : [];
  const safeMessages = Array.isArray(messages) ? messages : [];
  const recentPairs = Number(options.recentPairs ?? 8);
  const maxInjectedCards = Number(options.maxInjectedCards ?? 5);
  const memoryCards = normalizeFactCards(Array.isArray(memory?.memoryCards) ? memory.memoryCards : [])
    .map((card) => {
      if (Array.isArray(card.keywords) && card.keywords.length) return card;
      return { ...card, keywords: inferFactKeywords(card) };
    });
  const query = [userMessage, ...safeMessages.slice(-recentPairs * 2).map((message) => message.content)].join('\n');
  const injectedCards = retrieveCards({ query, worldBook: safeWorldBook, memoryCards, maxCards: maxInjectedCards });
  const renderedPromptModules = getRenderablePromptModules(safePromptModules);

  const systemSections = [
    renderCharacterCard(characterCard),
    renderPromptModules(renderedPromptModules),
    renderWorldState(memory?.worldState),
    renderRollingSummary(memory?.rollingSummary),
    renderCards(injectedCards),
    renderRecommendationInstruction()
  ].filter(Boolean);

  const recentMessages = safeMessages.slice(-recentPairs * 2).map((message) => ({
    role: message.role,
    content: String(message.content || '')
  }));

  const assembledMessages = [
    { role: 'system', content: systemSections.join('\n\n') },
    ...recentMessages,
    { role: 'user', content: String(userMessage || '') }
  ];

  const tokenEstimate = estimateTokens(assembledMessages.map((message) => `${message.role}: ${message.content}`).join('\n'));
  return {
    messages: assembledMessages,
    tokenEstimate,
    injectedCards,
    sections: {
      promptModules: renderedPromptModules.map((module) => module.id),
      hasCharacterCard: Boolean(characterCard?.enabled !== false && String(characterCard?.name || '').trim()),
      hasWorldState: Boolean(memory?.worldState),
      hasRollingSummary: Boolean(memory?.rollingSummary),
      injectedCardIds: injectedCards.filter((card) => !card.__generatedId).map((card) => card.id)
    }
  };
}

function inferFactKeywords(card) {
  const text = String((card && card.content) || '');
  const terms = text.split(/[^\u4e00-\u9fffA-Za-z0-9]+/).map((term) => term.trim()).filter(Boolean);
  const keywords = new Set();

  for (const term of terms) {
    const trimmed = term.trim();
    if (!trimmed) continue;
    if (trimmed.length <= 2) {
      keywords.add(trimmed);
      continue;
    }
    for (let index = 0; index < trimmed.length - 1; index += 1) {
      keywords.add(trimmed.slice(index, index + 2));
      if (index >= 5) break;
    }
  }

  return Array.from(keywords).slice(0, 12);
}

function renderCharacterCard(card) {
  if (!card || card.enabled === false) return '';
  const lines = [
    '# 角色卡',
    `姓名：${card.name || '未命名主角'}`,
    `身份：${card.role || ''}`,
    `描述：${card.description || ''}`,
    `性格：${card.personality || ''}`,
    `当前情境：${card.scenario || ''}`
  ];
  if (card.firstMessage) lines.push(`开场语：${card.firstMessage}`);
  if (card.systemPrompt) lines.push(`角色系统提示：${card.systemPrompt}`);
  if (card.postHistoryInstructions) lines.push(`历史后置指令：${card.postHistoryInstructions}`);
  if (Array.isArray(card.alternateGreetings) && card.alternateGreetings.length) {
    lines.push(`备用开场：\n${card.alternateGreetings.join('\n')}`);
  }
  if (Array.isArray(card.exampleDialog) && card.exampleDialog.length) {
    lines.push(`示例对话：\n${card.exampleDialog.join('\n')}`);
  }
  if (Array.isArray(card.tags) && card.tags.length) lines.push(`标签：${card.tags.join('、')}`);
  return lines.filter((line) => !line.endsWith('：')).join('\n');
}

function renderPromptModules(promptModules = []) {
  if (!promptModules.length) return '';
  return ['# Prompt 模块', ...promptModules.map((module) => `## ${module.title}\n${module.content}`)].join('\n\n');
}

function getRenderablePromptModules(promptModules = []) {
  return promptModules.filter((module) => module.enabled !== false && String(module.content || '').trim());
}

function renderWorldState(worldState) {
  if (!worldState) return '';
  return `# 结构化世界状态\n${JSON.stringify(worldState, null, 2)}`;
}

function renderRollingSummary(summary) {
  if (!String(summary || '').trim()) return '';
  return `# 滚动摘要\n${summary}`;
}

function renderCards(cards) {
  if (!cards.length) return '';
  const groups = new Map();
  cards.forEach((card) => {
    const depth = normalizeDepth(card.depth ?? card.scanDepth ?? card.scan_depth);
    const key = `Depth ${depth}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(card);
  });

  const sections = ['# 本轮注入的世界书和记忆'];
  for (const [depthLabel, depthCards] of groups.entries()) {
    sections.push([
      `## ${depthLabel}`,
      ...depthCards.map((card) => `### ${card.title}\n${card.content}`)
    ].join('\n\n'));
  }
  return sections.join('\n\n');
}

function normalizeDepth(depth) {
  const number = Number(depth);
  if (!Number.isFinite(number) || number <= 0) return 4;
  return Math.floor(number);
}

function renderRecommendationInstruction() {
  return [
    '# 推荐选项输出规则',
    '每次回复正文之后，额外给出 2-4 个用户下一步行动建议。',
    '建议必须适合作为用户下一轮输入，简短、可点击、不要包含解释。',
    '请用如下独立标签输出，标签之外仍是正常回复正文：',
    '<recommended_actions>',
    '["行动选项一", "行动选项二", "行动选项三"]',
    '</recommended_actions>'
  ].join('\n');
}
