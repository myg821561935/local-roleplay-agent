import { assemblePrompt } from '../agent/promptAssembler.js';
import { appendTurnEvent, rebuildMemoryFromMessages } from '../agent/memoryUpdater.js';
import { buildSummaryPrompt, shouldSummarize } from '../agent/summaryScheduler.js';
import { applyFactExtractionResult, buildFactExtractionPrompt, normalizeDynamicWorldBookEntries } from '../agent/factExtractor.js';
import { worldBookIdentity } from '../agent/factCards.js';
import { estimateTokens } from '../agent/token.js';
import { VectorMemoryService } from '../agent/vectorMemory.js';
import { resolveNarrativeContext } from '../agent/narrativeControl.js';

const MAX_CONSECUTIVE_SUMMARY_FAILURES = 3;

export class AgentService {
  constructor({ configService, sessionService, providerClient, vectorMemoryService }) {
    this.configService = configService;
    this.sessionService = sessionService;
    this.providerClient = providerClient;
    this.vectorMemoryService = vectorMemoryService || new VectorMemoryService({ configService, fetchImpl: fetch });
  }

  /**
   * 在 assemblePrompt 前调用：增量索引 session.messages + 用 userMessage 做向量检索
   * 返回 { vectorHits, vectorEnabled }
   */
  async maybeRetrieveVectorMemory({ session, userMessage, excludeMessageIds = [] }) {
    if (!this.vectorMemoryService) return { vectorHits: [], vectorEnabled: false };
    const enabled = await this.vectorMemoryService.isEnabled(session);
    if (!enabled) return { vectorHits: [], vectorEnabled: false };
    // 增量索引现有消息
    await this.vectorMemoryService.indexMessages({ sessionId: session.id || 'main', messages: session.messages });
    // 用当前 userMessage 做检索
    const query = String(userMessage?.content || userMessage || '').trim();
    if (!query) return { vectorHits: [], vectorEnabled: true };
    const topK = await this.vectorMemoryService.getTopK(session);
    const hits = await this.vectorMemoryService.search({
      sessionId: session.id || 'main',
      query,
      topK,
      excludeMessageIds
    });
    return { vectorHits: hits, vectorEnabled: true };
  }

  async resolveSessionConfig(session) {
    if (session.config) return session.config;
    const globalConfig = await this.configService.getAll();
    session.config = {
      characterCard: globalConfig.characterCard,
      promptModules: globalConfig.promptModules,
      worldBook: globalConfig.worldBook,
      persona: globalConfig.persona
    };
    await this.sessionService.saveSession(session);
    return session.config;
  }

  async sendMessage({ sessionId = 'main', content, targetSpeaker }) {
    const [globalConfig, session] = await Promise.all([
      this.configService.getAll(),
      this.sessionService.getSession(sessionId)
    ]);
    const activeConfig = await this.resolveSessionConfig(session);
    const provider = getActiveProvider(globalConfig, session);
    const fallbackChain = getProviderChain(globalConfig, session, provider).slice(1);

    const userMessage = createMessage('user', content);
    const { vectorHits } = await this.maybeRetrieveVectorMemory({
      session,
      userMessage: userMessage.content
    });
    const { assistantMessage, assembled } = await this.generateAssistantMessage({
      config: activeConfig,
      session,
      provider,
      userMessage,
      groupMembers: globalConfig.groupMembers,
      targetSpeaker,
      templates: globalConfig.macroTemplates,
      customArrays: globalConfig.customArrays,
      fallbackChain,
      vectorHits
    });

    session.messages.push(userMessage, assistantMessage);
    session.memory = appendTurnEvent({
      memory: session.memory,
      userMessage,
      assistantMessage,
      turnId: assistantMessage.id
    });

    await this.runMemoryMaintenanceIfNeeded({ session, provider, assembled, globalConfig });

    session.updatedAt = new Date().toISOString();
    await this.sessionService.saveSession(session);
    return {
      session,
      reply: assistantMessage,
      debug: assembled
    };
  }

  async sendMessageStream({ sessionId = 'main', content, targetSpeaker, onToken }) {
    const [globalConfig, session] = await Promise.all([
      this.configService.getAll(),
      this.sessionService.getSession(sessionId)
    ]);
    const activeConfig = await this.resolveSessionConfig(session);
    const provider = getActiveProvider(globalConfig, session);
    const fallbackChain = getProviderChain(globalConfig, session, provider).slice(1);
    const userMessage = createMessage('user', content);
    const { vectorHits } = await this.maybeRetrieveVectorMemory({
      session,
      userMessage: userMessage.content
    });
    const assembled = assemblePrompt({
      promptModules: activeConfig.promptModules,
      characterCard: activeConfig.characterCard,
      worldBook: activeConfig.worldBook,
      memory: session.memory,
      messages: session.messages,
      userMessage: userMessage.content,
      persona: activeConfig.persona,
      groupMembers: globalConfig.groupMembers,
      targetSpeaker,
      templates: globalConfig.macroTemplates,
      customArrays: globalConfig.customArrays,
      vectorHits,
      options: session.settings
    });

    const assistantResult = await this.completeAssistantContentStream({ provider, messages: assembled.messages, onToken, fallbackChain });
    const assistantContent = assistantResult.content;
    const speaker = extractSpeaker(assistantContent);
    const parsedReply = extractRecommendedActions(assistantContent);
    const assistantMessage = createMessage('assistant', parsedReply.content, {
      recommendedActions: parsedReply.recommendedActions,
      usage: buildUsageSnapshot({ provider, assembled, content: parsedReply.content, providerResult: assistantResult })
    });
    if (speaker) assistantMessage.speaker = speaker;

    session.messages.push(userMessage, assistantMessage);
    session.memory = appendTurnEvent({
      memory: session.memory,
      userMessage,
      assistantMessage,
      turnId: assistantMessage.id
    });
    await this.runMemoryMaintenanceIfNeeded({ session, provider, assembled, globalConfig });

    session.updatedAt = new Date().toISOString();
    await this.sessionService.saveSession(session);
    return { session, reply: assistantMessage, debug: assembled };
  }

  async completeAssistantContentStream({ provider, messages, onToken, fallbackChain = [] }) {
    if (typeof this.providerClient.stream === 'function') {
      const result = await this.streamWithFallback({
        primaryProvider: provider,
        fallbackChain,
        messages,
        onToken
      });
      return result;
    }

    const result = await this.completeWithFallback({
      primaryProvider: provider,
      fallbackChain,
      messages
    });
    const parsed = extractRecommendedActions(result.content);
    for (const token of chunkText(parsed.content)) {
      await onToken?.(token);
    }
    return result;
  }

  async editMessage({ sessionId = 'main', messageId, content }) {
    const [globalConfig, session] = await Promise.all([
      this.configService.getAll(),
      this.sessionService.getSession(sessionId)
    ]);
    const activeConfig = await this.resolveSessionConfig(session);
    const index = findMessageIndex(session, messageId);
    const message = session.messages[index];

    if (message.role === 'assistant') {
      message.swipes = normalizeSwipes(message.swipes, message.content);
      const newContent = String(content || '');
      if (!message.swipes.includes(newContent)) message.swipes.push(newContent);
      message.content = newContent;
      message.activeSwipeIndex = Math.max(0, message.swipes.indexOf(message.content));
      message.updatedAt = new Date().toISOString();
      session.messages = session.messages.slice(0, index + 1);
      this.invalidateVectorIndex(session);
      session.memory = rebuildMemoryFromMessages({ memory: session.memory, messages: session.messages });
      session.updatedAt = new Date().toISOString();
      await this.sessionService.saveSession(session);
      return { session, reply: message };
    }

    if (message.role !== 'user') throw new Error('UNSUPPORTED_MESSAGE_ROLE');

    const provider = getActiveProvider(globalConfig, session);
    const fallbackChain = getProviderChain(globalConfig, session, provider).slice(1);
    message.swipes = normalizeSwipes(message.swipes, message.content);
    const newContent = String(content || '');
    if (!message.swipes.includes(newContent)) message.swipes.push(newContent);
    message.content = newContent;
    message.activeSwipeIndex = Math.max(0, message.swipes.indexOf(message.content));
    message.updatedAt = new Date().toISOString();
    session.messages = session.messages.slice(0, index + 1);
    this.invalidateVectorIndex(session);

    const { vectorHits } = await this.maybeRetrieveVectorMemory({
      session,
      userMessage: message.content
    });
    const { assistantMessage, assembled } = await this.generateAssistantMessage({
      config: activeConfig,
      session,
      provider,
      userMessage: message,
      templates: globalConfig.macroTemplates,
      customArrays: globalConfig.customArrays,
      fallbackChain,
      vectorHits
    });

    session.messages.push(assistantMessage);
    session.memory = rebuildMemoryFromMessages({ memory: session.memory, messages: session.messages });
    await this.runMemoryMaintenanceIfNeeded({ session, provider, assembled, globalConfig });

    session.updatedAt = new Date().toISOString();
    await this.sessionService.saveSession(session);
    return { session, reply: assistantMessage, debug: assembled };
  }

  async switchMessageSwipe({ sessionId = 'main', messageId, swipeIndex }) {
    const session = await this.sessionService.getSession(sessionId);
    const index = findMessageIndex(session, messageId);
    const message = session.messages[index];
    const swipes = normalizeSwipes(message.swipes, message.content);
    if (!swipes.length) throw new Error('NO_SWIPES_AVAILABLE');
    const targetIndex = Number(swipeIndex);
    if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= swipes.length) {
      throw new Error('INVALID_SWIPE_INDEX');
    }
    message.swipes = swipes;
    message.activeSwipeIndex = targetIndex;
    message.content = swipes[targetIndex];
    message.updatedAt = new Date().toISOString();
    session.memory = rebuildMemoryFromMessages({ memory: session.memory, messages: session.messages });
    session.updatedAt = new Date().toISOString();
    this.invalidateVectorIndex(session);
    await this.sessionService.saveSession(session);
    return { session };
  }

  async regenerateAssistantMessage({ sessionId = 'main', messageId }) {
    const [globalConfig, session] = await Promise.all([
      this.configService.getAll(),
      this.sessionService.getSession(sessionId)
    ]);
    const activeConfig = await this.resolveSessionConfig(session);
    const provider = getActiveProvider(globalConfig, session);
    const fallbackChain = getProviderChain(globalConfig, session, provider).slice(1);
    const index = findMessageIndex(session, messageId);
    const assistantMessage = session.messages[index];
    if (assistantMessage.role !== 'assistant') throw new Error('MESSAGE_NOT_ASSISTANT');

    const userMessage = session.messages[index - 1];
    if (!userMessage || userMessage.role !== 'user') throw new Error('MISSING_USER_MESSAGE');

    session.messages = session.messages.slice(0, index);
    this.invalidateVectorIndex(session);
    const { vectorHits } = await this.maybeRetrieveVectorMemory({
      session,
      userMessage: userMessage.content
    });
    const result = await this.generateAssistantMessage({
      config: activeConfig,
      session,
      provider,
      userMessage,
      templates: globalConfig.macroTemplates,
      customArrays: globalConfig.customArrays,
      fallbackChain,
      vectorHits
    });
    const nextSwipe = result.assistantMessage.content;
    const swipes = normalizeSwipes(assistantMessage.swipes, assistantMessage.content);
    swipes.push(nextSwipe);

    assistantMessage.content = nextSwipe;
    assistantMessage.swipes = swipes;
    assistantMessage.activeSwipeIndex = swipes.length - 1;
    assistantMessage.updatedAt = new Date().toISOString();
    session.messages.push(assistantMessage);
    session.memory = rebuildMemoryFromMessages({ memory: session.memory, messages: session.messages });
    await this.runMemoryMaintenanceIfNeeded({ session, provider, assembled: result.assembled, globalConfig });

    session.updatedAt = new Date().toISOString();
    await this.sessionService.saveSession(session);
    return { session, reply: assistantMessage, debug: result.assembled };
  }

  async generateAssistantMessage({ config, session, provider, userMessage, groupMembers, targetSpeaker, templates, customArrays, fallbackChain = [], vectorHits = [] }) {
    const assembled = assemblePrompt({
      promptModules: config.promptModules,
      characterCard: config.characterCard,
      worldBook: config.worldBook,
      memory: session.memory,
      messages: session.messages,
      userMessage: userMessage.content,
      persona: config.persona,
      groupMembers,
      targetSpeaker,
      templates,
      customArrays,
      vectorHits,
      options: session.settings
    });

    const assistantResult = await this.completeWithFallback({
      primaryProvider: provider,
      fallbackChain,
      messages: assembled.messages
    });
    const speaker = extractSpeaker(assistantResult.content);
    const parsedReply = extractRecommendedActions(assistantResult.content);
    const assistantMessage = createMessage('assistant', parsedReply.content, {
      recommendedActions: parsedReply.recommendedActions,
      usage: buildUsageSnapshot({ provider, assembled, content: parsedReply.content, providerResult: assistantResult })
    });
    if (speaker) assistantMessage.speaker = speaker;

    return { assistantMessage, assembled };
  }

  async rewriteText({ sessionId = 'main', target = 'chat-input', text, instruction = '' }) {
    const sourceText = String(text || '').trim();
    if (!sourceText) throw new Error('EMPTY_REWRITE_TEXT');

    const [config, session] = await Promise.all([
      this.configService.getAll(),
      this.sessionService.getSession(sessionId)
    ]);
    const provider = getActiveProvider(config, session);
    const fallbackChain = getProviderChain(config, session, provider).slice(1);
    const result = await this.completeWithFallback({
      primaryProvider: provider,
      fallbackChain,
      messages: buildRewriteMessages({
        target,
        text: sourceText,
        instruction
      })
    });

    return {
      target: normalizeRewriteTarget(target),
      text: cleanRewriteText(result.content),
      providerId: String(provider.id || ''),
      model: String(provider.model || '')
    };
  }

  async toggleMessageVisibility({ sessionId = 'main', messageId }) {
    const session = await this.sessionService.getSession(sessionId);
    const index = findMessageIndex(session, messageId);
    const message = session.messages[index];
    message.excluded = !message.excluded;
    message.updatedAt = new Date().toISOString();
    session.memory = rebuildMemoryFromMessages({ memory: session.memory, messages: session.messages });
    session.updatedAt = new Date().toISOString();
    this.invalidateVectorIndex(session);
    await this.sessionService.saveSession(session);
    return { session };
  }

  async toggleMessageBookmark({ sessionId = 'main', messageId, label }) {
    const session = await this.sessionService.getSession(sessionId);
    const index = findMessageIndex(session, messageId);
    const message = session.messages[index];
    if (message.bookmarked) {
      message.bookmarked = false;
      message.bookmarkLabel = '';
    } else {
      message.bookmarked = true;
      message.bookmarkLabel = String(label || '').trim().slice(0, 40) || `书签 ${session.messages.filter((m) => m.bookmarked).length + 1}`;
    }
    message.updatedAt = new Date().toISOString();
    session.updatedAt = new Date().toISOString();
    await this.sessionService.saveSession(session);
    return { session };
  }

  async continueMessage({ sessionId = 'main', onToken }) {
    const [globalConfig, session] = await Promise.all([
      this.configService.getAll(),
      this.sessionService.getSession(sessionId)
    ]);
    const activeConfig = await this.resolveSessionConfig(session);
    const provider = getActiveProvider(globalConfig, session);
    const fallbackChain = getProviderChain(globalConfig, session, provider).slice(1);

    const messages = Array.isArray(session.messages) ? session.messages : [];
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'assistant') throw new Error('LAST_MESSAGE_NOT_ASSISTANT');

    const continuationContent = String(lastMessage.content || '').trim();
    if (!continuationContent) throw new Error('EMPTY_ASSISTANT_CONTENT');

    const { vectorHits } = await this.maybeRetrieveVectorMemory({
      session,
      userMessage: continuationContent,
      excludeMessageIds: [lastMessage.id]
    });
    const assembled = assemblePrompt({
      promptModules: activeConfig.promptModules,
      characterCard: activeConfig.characterCard,
      worldBook: activeConfig.worldBook,
      memory: session.memory,
      messages: session.messages,
      userMessage: '',
      persona: activeConfig.persona,
      groupMembers: globalConfig.groupMembers,
      templates: globalConfig.macroTemplates,
      customArrays: globalConfig.customArrays,
      vectorHits,
      options: session.settings
    });

    assembled.messages.push({ role: 'assistant', content: continuationContent });

    const assistantResult = await this.completeAssistantContentStream({ provider, messages: assembled.messages, onToken, fallbackChain });
    const continuedContent = continuationContent + '\n' + String(assistantResult.content || '').trim();
    const parsedReply = extractRecommendedActions(continuedContent);

    lastMessage.content = parsedReply.content;
    lastMessage.swipes = normalizeSwipes(lastMessage.swipes, lastMessage.content);
    lastMessage.activeSwipeIndex = Math.max(0, lastMessage.swipes.indexOf(lastMessage.content));
    lastMessage.updatedAt = new Date().toISOString();

    session.memory = rebuildMemoryFromMessages({ memory: session.memory, messages: session.messages });
    await this.runMemoryMaintenanceIfNeeded({ session, provider, assembled, globalConfig });
    session.updatedAt = new Date().toISOString();
    this.invalidateVectorIndex(session);
    await this.sessionService.saveSession(session);
    return { session, reply: lastMessage, debug: assembled };
  }

  async runMemoryMaintenanceIfNeeded({ session, provider, assembled, globalConfig }) {
    const shouldRunMaintenance = shouldSummarize({
      unsummarizedTurnCount: session.memory.unsummarizedTurnCount,
      promptTokenEstimate: assembled.tokenEstimate,
      maxPromptTokens: session.settings.maxPromptTokens
    });
    if (!shouldRunMaintenance) return;

    const consecutiveFailures = Number(session.memory.consecutiveSummaryFailures || 0);
    if (consecutiveFailures >= MAX_CONSECUTIVE_SUMMARY_FAILURES) {
      session.memory.lastSummaryError = session.memory.lastSummaryError || 'summary paused after repeated failures';
      return;
    }

    // fact/summary 可使用独立 provider（任务路由），失败时回退到 chat provider
    const config = globalConfig || await this.configService.getAll();
    const factProvider = getProviderForTask(config, session, 'fact');
    const factFallback = getProviderChain(config, session, factProvider).slice(1);
    const summaryProvider = getProviderForTask(config, session, 'summary');
    const summaryFallback = getProviderChain(config, session, summaryProvider).slice(1);
    const narrativeContext = resolveNarrativeContext({
      memory: session.memory,
      mode: session.settings?.narrativeMode
    });
    await this.tryExtractFacts({ session, provider: factProvider, fallbackChain: factFallback, narrativeContext });
    await this.trySummarize({ session, provider: summaryProvider, fallbackChain: summaryFallback, narrativeContext });
  }

  async tryExtractFacts({ session, provider, fallbackChain = [], narrativeContext }) {
    const unsummarizedTurnCount = Number(session.memory.unsummarizedTurnCount || 0);
    const messageWindow = Math.min(40, Math.max(8, unsummarizedTurnCount * 2));
    const recent = session.messages.slice(-messageWindow);
    try {
      const result = await this.completeWithFallback({
        primaryProvider: provider,
        fallbackChain,
        messages: buildFactExtractionPrompt({
          worldState: session.memory.worldState,
          messages: recent,
          narrativeContext
        })
      });
      session.memory = applyFactExtractionResult(session.memory, result.content, { narrativeContext });
      await this.appendDynamicWorldBookEntries({ session, content: result.content, narrativeContext });
    } catch (error) {
      session.memory.lastFactExtractionError = error.message;
    }
  }

  async appendDynamicWorldBookEntries({ session, content, narrativeContext }) {
    const entries = normalizeDynamicWorldBookEntries(content, { narrativeContext });
    if (!entries.length) return;
    const activeConfig = await this.resolveSessionConfig(session);
    const existing = Array.isArray(activeConfig.worldBook) ? activeConfig.worldBook : [];
    const existingKeys = new Set(existing.map(worldBookIdentity));
    const nextEntries = entries.filter((entry) => !existingKeys.has(worldBookIdentity(entry)));
    if (!nextEntries.length) return;
    activeConfig.worldBook = [...existing, ...nextEntries];
    session.config = activeConfig;
  }

  async trySummarize({ session, provider, fallbackChain = [], narrativeContext }) {
    const unsummarizedTurnCount = Number(session.memory.unsummarizedTurnCount || 0);
    const messageWindow = Math.min(40, Math.max(8, unsummarizedTurnCount * 2));
    const recent = session.messages.slice(-messageWindow);
    try {
      const result = await this.completeWithFallback({
        primaryProvider: provider,
        fallbackChain,
        messages: buildSummaryPrompt({
          rollingSummary: session.memory.rollingSummary,
          messages: recent,
          narrativeContext
        })
      });
      session.memory.rollingSummary = result.content;
      session.memory.unsummarizedTurnCount = 0;
      session.memory.lastSummaryError = '';
      session.memory.consecutiveSummaryFailures = 0;
    } catch (error) {
      session.memory.lastSummaryError = error.message;
      session.memory.consecutiveSummaryFailures = Number(session.memory.consecutiveSummaryFailures || 0) + 1;
    }
  }

  /**
   * 带回退的 complete 调用：主 provider 失败时按顺序尝试 fallbackChain
   * 全部失败时抛出最后一个错误
   */
  async completeWithFallback({ primaryProvider, fallbackChain = [], messages }) {
    const chain = [primaryProvider, ...fallbackChain].filter(Boolean);
    let lastError;
    for (const provider of chain) {
      try {
        return await this.providerClient.complete({ provider, messages });
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('ALL_PROVIDERS_FAILED');
  }

  /**
   * 带回退的 stream 调用
   */
  async streamWithFallback({ primaryProvider, fallbackChain = [], messages, onToken }) {
    const chain = [primaryProvider, ...fallbackChain].filter(Boolean);
    let lastError;
    for (const provider of chain) {
      try {
        return await this.providerClient.stream({ provider, messages, onToken });
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('ALL_PROVIDERS_FAILED');
  }

  invalidateVectorIndex(session) {
    if (typeof this.vectorMemoryService?.dropIndex !== 'function') return;
    this.vectorMemoryService.dropIndex(session?.id || 'main');
  }
}

function createMessage(role, content, extras = {}) {
  const message = {
    id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content: String(content || ''),
    createdAt: new Date().toISOString()
  };
  message.swipes = [message.content];
  message.activeSwipeIndex = 0;
  if (Array.isArray(extras.recommendedActions) && extras.recommendedActions.length) {
    message.recommendedActions = extras.recommendedActions;
  }
  if (extras.usage && typeof extras.usage === 'object' && !Array.isArray(extras.usage)) {
    message.usage = extras.usage;
  }
  return message;
}

function buildRewriteMessages({ target, text, instruction }) {
  const system = [
    '# Magic Rewrite 改写器',
    '你负责把用户提供的文本改写得更适合沉浸式角色扮演创作。',
    '只输出改写后的文本，不要解释，不要加标题，不要使用 Markdown 代码块。',
    '保持原意、视角和用户已经决定的行动，不新增关键剧情事实，不替用户做新的核心选择。',
    '可以增强节奏、感官细节、语气、画面感和角色扮演可读性。'
  ].join('\n');
  const user = [
    `目标字段：${normalizeRewriteTarget(target)}`,
    `改写要求：${String(instruction || '').trim() || '更有画面感，适合作为下一轮角色行动或旁白输入。'}`,
    '',
    '原文：',
    text
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
}

function normalizeRewriteTarget(target) {
  const value = String(target || '').trim();
  return value || 'chat-input';
}

function cleanRewriteText(content) {
  const text = String(content || '').trim();
  const fenced = text.match(/^```(?:\w+)?\s*([\s\S]*?)\s*```$/);
  const unfenced = fenced ? fenced[1].trim() : text;
  return unfenced
    .replace(/^(改写后|润色后|结果|输出)[:：]\s*/i, '')
    .trim();
}

function getActiveProvider(config, session = {}) {
  return getProviderForTask(config, session, 'chat');
}

/**
 * 按任务获取 provider
 * @param {string} taskKey - chat | fact | summary
 */
function getProviderForTask(config, session = {}, taskKey = 'chat') {
  const providersConfig = config.providers || {};
  const providers = Array.isArray(providersConfig.providers) ? providersConfig.providers : [];

  const sessionProviderId = String(session.settings?.providerId || '').trim();
  const taskProviders = isPlainObject(providersConfig.taskProviders) ? providersConfig.taskProviders : {};
  const taskProviderId = String(taskProviders[taskKey] || '').trim();
  const activeProviderId = String(providersConfig.activeProviderId || '').trim();

  // 优先级：会话覆盖 > 任务专用 > 全局默认 > 列表首位
  const preferredId = sessionProviderId || taskProviderId || activeProviderId;
  const provider = providers.find((p) => p.id === preferredId) || providers[0];
  if (!provider) throw new Error('NO_ACTIVE_PROVIDER');
  return provider;
}

/**
 * 获取 provider 回退链：[主, ...回退]，去重
 */
function getProviderChain(config, session, primaryProvider) {
  const providersConfig = config.providers || {};
  const providers = Array.isArray(providersConfig.providers) ? providersConfig.providers : [];
  const fallbackIds = Array.isArray(providersConfig.fallbackChain) ? providersConfig.fallbackChain : [];
  const chain = [primaryProvider];
  fallbackIds.forEach((id) => {
    const p = providers.find((x) => x.id === id);
    if (p && !chain.some((c) => c.id === p.id)) chain.push(p);
  });
  return chain;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function buildUsageSnapshot({ provider, assembled, content, providerResult }) {
  const providerUsage = providerResult?.usage || providerResult?.raw?.usage || {};
  const promptTokens = normalizeTokenCount(providerUsage.prompt_tokens ?? providerUsage.promptTokens, assembled.tokenEstimate);
  const completionTokens = normalizeTokenCount(
    providerUsage.completion_tokens ?? providerUsage.completionTokens,
    estimateTokens(content)
  );
  return {
    providerId: String(provider?.id || ''),
    model: String(provider?.model || ''),
    promptTokens,
    completionTokens,
    totalTokens: normalizeTokenCount(
      providerUsage.total_tokens ?? providerUsage.totalTokens,
      promptTokens + completionTokens
    ),
    injectedCards: Array.isArray(assembled.injectedCards) ? assembled.injectedCards.length : 0,
    promptModules: Array.isArray(assembled.sections?.promptModules) ? assembled.sections.promptModules.length : 0,
    estimated: !hasNumericUsage(providerUsage)
  };
}

function normalizeTokenCount(value, fallback) {
  const number = Number(value);
  if (Number.isFinite(number) && number >= 0) return Math.ceil(number);
  return Math.max(0, Math.ceil(Number(fallback) || 0));
}

function hasNumericUsage(usage) {
  return Boolean(usage) && [
    usage.prompt_tokens,
    usage.promptTokens,
    usage.completion_tokens,
    usage.completionTokens,
    usage.total_tokens,
    usage.totalTokens
  ].some((value) => Number.isFinite(Number(value)));
}

function findMessageIndex(session, messageId) {
  const index = (session.messages || []).findIndex((message) => message.id === messageId);
  if (index < 0) throw new Error('MESSAGE_NOT_FOUND');
  return index;
}

function normalizeSwipes(swipes, fallbackContent) {
  const values = Array.isArray(swipes) ? swipes.map((item) => String(item || '')).filter(Boolean) : [];
  const fallback = String(fallbackContent || '');
  if (fallback && !values.includes(fallback)) values.push(fallback);
  return values;
}

function extractRecommendedActions(rawContent) {
  const content = String(rawContent || '');
  const match = content.match(/<recommended_actions>\s*([\s\S]*?)\s*<\/recommended_actions>/i);
  if (!match) return { content, recommendedActions: [] };

  const recommendedActions = parseRecommendedActions(match[1]);
  let cleanContent = content.replace(match[0], '').trim();
  const speakerMatch = cleanContent.match(/^【([^】]+)】\s*/);
  if (speakerMatch) {
    cleanContent = cleanContent.slice(speakerMatch[0].length).trim();
  }
  return { content: cleanContent, recommendedActions };
}

function extractSpeaker(rawContent) {
  const content = String(rawContent || '').trim();
  const match = content.match(/^【([^】]+)】\s*/);
  return match ? match[1].trim().slice(0, 30) : '';
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

function chunkText(text) {
  const value = String(text || '');
  const chunks = value.match(/[\s\S]{1,24}/g);
  return chunks || [];
}
