import { estimateTokens } from './token.js';
import { retrieveCards } from './memoryRetriever.js';

export function assemblePrompt({
  promptModules,
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
  const memoryCards = Array.isArray(memory?.memoryCards) ? memory.memoryCards : [];
  const query = [userMessage, ...safeMessages.slice(-recentPairs * 2).map((message) => message.content)].join('\n');
  const injectedCards = retrieveCards({ query, worldBook: safeWorldBook, memoryCards, maxCards: maxInjectedCards });
  const renderedPromptModules = getRenderablePromptModules(safePromptModules);

  const systemSections = [
    renderPromptModules(renderedPromptModules),
    renderWorldState(memory?.worldState),
    renderRollingSummary(memory?.rollingSummary),
    renderCards(injectedCards)
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
      hasWorldState: Boolean(memory?.worldState),
      hasRollingSummary: Boolean(memory?.rollingSummary),
      injectedCardIds: injectedCards.map((card) => card.id)
    }
  };
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
  return ['# 本轮注入的世界书和记忆', ...cards.map((card) => `## ${card.title}\n${card.content}`)].join('\n\n');
}
