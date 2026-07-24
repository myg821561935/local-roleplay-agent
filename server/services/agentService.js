import { assemblePrompt } from '../agent/promptAssembler.js';
import { rebuildMemoryFromMessages } from '../agent/memoryUpdater.js';
import { buildSummaryPrompt, shouldSummarize } from '../agent/summaryScheduler.js';
import { applyFactExtractionResult, buildFactExtractionPrompt, normalizeDynamicWorldBookEntries } from '../agent/factExtractor.js';
import { worldBookIdentity } from '../agent/factCards.js';
import { estimateTokens } from '../agent/token.js';
import { VectorMemoryService } from '../agent/vectorMemory.js';
import { resolveNarrativeContext } from '../agent/narrativeControl.js';
import { parseRoleplayResponse } from '../agent/roleplayResponse.js';
import { extractActionEnvelope } from '../simulation/actionProtocol.js';
import {
  applyMvuPatchEnvelope,
  extractMvuPatchEnvelope,
  normalizeMvuSnapshot
} from '../compat/mvuProtocol.js';
import { WorldSimulationService } from './worldSimulationService.js';

const MAX_CONSECUTIVE_SUMMARY_FAILURES = 3;
const INTERACTIVE_PROVIDER_TASKS = new Set(['chat', 'rewrite']);

export class AgentService {
  constructor({ configService, sessionService, providerClient, vectorMemoryService, worldSimulationService }) {
    this.configService = configService;
    this.sessionService = sessionService;
    this.providerClient = providerClient;
    this.vectorMemoryService = vectorMemoryService || new VectorMemoryService({ configService, fetchImpl: fetch });
    this.worldSimulationService = worldSimulationService || new WorldSimulationService({ sessionService });
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
    this.worldSimulationService.prepareSession(session, {
      characterCard: activeConfig.characterCard,
      groupMembers: globalConfig.groupMembers
    });
    const provider = getActiveProvider(globalConfig, session);
    const fallbackChain = getProviderChain(globalConfig, session, provider, 'chat').slice(1);

    const userMessage = createMessage('user', content, {
      kind: isJourneySetupContent(content) ? 'journey-setup' : 'chat'
    });
    const { vectorHits } = await this.maybeRetrieveVectorMemory({
      session,
      userMessage: userMessage.content
    });
    const { assistantMessage, assembled, actionEnvelope, actionError } = await this.generateAssistantMessage({
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
    this.worldSimulationService.applyTurn({
      session,
      userMessage,
      assistantMessage,
      actionEnvelope,
      actionError
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

  async sendMessageStream({ sessionId = 'main', content, targetSpeaker, hideUserMessage = false, onToken }) {
    const [globalConfig, session] = await Promise.all([
      this.configService.getAll(),
      this.sessionService.getSession(sessionId)
    ]);
    const activeConfig = await this.resolveSessionConfig(session);
    this.worldSimulationService.prepareSession(session, {
      characterCard: activeConfig.characterCard,
      groupMembers: globalConfig.groupMembers
    });
    const provider = getActiveProvider(globalConfig, session);
    const fallbackChain = getProviderChain(globalConfig, session, provider, 'chat').slice(1);
    const userMessage = createMessage('user', content, {
      kind: isJourneySetupContent(content) ? 'journey-setup' : 'chat',
      hiddenFromChat: hideUserMessage
    });
    const { vectorHits } = await this.maybeRetrieveVectorMemory({
      session,
      userMessage: userMessage.content
    });
    const assembled = assemblePrompt({
      promptModules: activeConfig.promptModules,
      characterCard: activeConfig.characterCard,
      worldBook: activeConfig.worldBook,
      memory: session.memory,
      authoring: session.authoring,
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

    const streamFilter = createHiddenBlockStreamFilter(onToken);
    const assistantResult = await this.completeAssistantContentStream({
      provider,
      messages: assembled.messages,
      onToken: streamFilter.push,
      fallbackChain,
      taskKey: 'chat'
    });
    await streamFilter.end();
    const parsedOutput = parseAssistantOutput(assistantResult.content);
    const mvuUpdate = applyAssistantMvuUpdate(session, parsedOutput);
    const speaker = parsedOutput.speaker;
    const parsedReply = parsedOutput.reply;
    const usage = buildUsageSnapshot({ provider, assembled, content: parsedReply.content, providerResult: assistantResult });
    const assistantMessage = createMessage('assistant', parsedReply.content, {
      recommendedActions: parsedReply.recommendedActions,
      usage,
      actionEnvelope: parsedOutput.actionEnvelope,
      actionError: parsedOutput.actionError,
      mvuPatches: mvuUpdate.patches,
      mvuError: mvuUpdate.error,
      roleplayPanels: parsedOutput.roleplayPanels,
      speaker
    });
    appendUsageLedgerEntry(session, {
      taskKey: 'chat',
      messageId: assistantMessage.id,
      usage,
      routing: assistantResult.routing
    });

    session.messages.push(userMessage, assistantMessage);
    this.worldSimulationService.applyTurn({
      session,
      userMessage,
      assistantMessage,
      actionEnvelope: parsedOutput.actionEnvelope,
      actionError: parsedOutput.actionError
    });
    await this.runMemoryMaintenanceIfNeeded({ session, provider, assembled, globalConfig });

    session.updatedAt = new Date().toISOString();
    await this.sessionService.saveSession(session);
    return { session, reply: assistantMessage, debug: assembled };
  }

  async completeAssistantContentStream({ provider, messages, onToken, fallbackChain = [], taskKey = 'chat' }) {
    if (typeof this.providerClient.stream === 'function') {
      const result = await this.streamWithFallback({
        primaryProvider: provider,
        fallbackChain,
        messages,
        onToken,
        taskKey
      });
      return result;
    }

    const result = await this.completeWithFallback({
      primaryProvider: provider,
      fallbackChain,
      messages,
      taskKey
    });
    const actionParsed = extractActionEnvelope(result.content);
    const parsed = extractRecommendedActions(actionParsed.content);
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
    this.worldSimulationService.prepareSession(session, {
      characterCard: activeConfig.characterCard,
      groupMembers: globalConfig.groupMembers
    });
    const index = findMessageIndex(session, messageId);
    const message = session.messages[index];

    if (message.role === 'assistant') {
      message.swipes = normalizeSwipes(message.swipes, message.content);
      const newContent = String(content || '');
      if (!message.swipes.includes(newContent)) message.swipes.push(newContent);
      message.content = newContent;
      message.activeSwipeIndex = Math.max(0, message.swipes.indexOf(message.content));
      message.swipeMetadata = normalizeSwipeMetadata(message, message.swipes);
      message.swipeMetadata[message.activeSwipeIndex] = emptySwipeMetadata();
      clearMessageWorldUpdate(message);
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
    const fallbackChain = getProviderChain(globalConfig, session, provider, 'chat').slice(1);
    message.swipes = normalizeSwipes(message.swipes, message.content);
    const newContent = String(content || '');
    if (!message.swipes.includes(newContent)) message.swipes.push(newContent);
    message.content = newContent;
    message.activeSwipeIndex = Math.max(0, message.swipes.indexOf(message.content));
    message.updatedAt = new Date().toISOString();
    session.messages = session.messages.slice(0, index + 1);
    this.invalidateVectorIndex(session);
    session.memory = rebuildMemoryFromMessages({ memory: session.memory, messages: session.messages });

    const { vectorHits } = await this.maybeRetrieveVectorMemory({
      session,
      userMessage: message.content
    });
    const { assistantMessage, assembled, actionEnvelope, actionError } = await this.generateAssistantMessage({
      config: activeConfig,
      session,
      provider,
      userMessage: message,
      groupMembers: globalConfig.groupMembers,
      templates: globalConfig.macroTemplates,
      customArrays: globalConfig.customArrays,
      fallbackChain,
      vectorHits
    });

    session.messages.push(assistantMessage);
    this.worldSimulationService.applyTurn({
      session,
      userMessage: message,
      assistantMessage,
      actionEnvelope,
      actionError
    });
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
    message.swipeMetadata = normalizeSwipeMetadata(message, swipes);
    message.activeSwipeIndex = targetIndex;
    message.content = swipes[targetIndex];
    applySwipeMetadata(message, message.swipeMetadata[targetIndex]);
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
    this.worldSimulationService.prepareSession(session, {
      characterCard: activeConfig.characterCard,
      groupMembers: globalConfig.groupMembers
    });
    const provider = getActiveProvider(globalConfig, session);
    const fallbackChain = getProviderChain(globalConfig, session, provider, 'chat').slice(1);
    const index = findMessageIndex(session, messageId);
    const assistantMessage = session.messages[index];
    if (assistantMessage.role !== 'assistant') throw new Error('MESSAGE_NOT_ASSISTANT');

    const userMessage = session.messages[index - 1];
    if (!userMessage || userMessage.role !== 'user') throw new Error('MISSING_USER_MESSAGE');

    session.messages = session.messages.slice(0, index);
    session.memory = rebuildMemoryFromMessages({ memory: session.memory, messages: session.messages });
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
      groupMembers: globalConfig.groupMembers,
      templates: globalConfig.macroTemplates,
      customArrays: globalConfig.customArrays,
      fallbackChain,
      vectorHits
    });
    const nextSwipe = result.assistantMessage.content;
    const swipes = normalizeSwipes(assistantMessage.swipes, assistantMessage.content);
    const swipeMetadata = normalizeSwipeMetadata(assistantMessage, swipes);
    swipes.push(nextSwipe);
    swipeMetadata.push(metadataFromMessage(result.assistantMessage));

    assistantMessage.content = nextSwipe;
    assistantMessage.swipes = swipes;
    assistantMessage.swipeMetadata = swipeMetadata;
    assistantMessage.activeSwipeIndex = swipes.length - 1;
    assistantMessage.usage = result.assistantMessage.usage;
    linkUsageLedgerEntry(session, assistantMessage.usage?.callId, assistantMessage.id);
    assistantMessage.updatedAt = new Date().toISOString();
    applySwipeMetadata(assistantMessage, swipeMetadata.at(-1));
    session.messages.push(assistantMessage);
    this.worldSimulationService.applyTurn({
      session,
      userMessage,
      assistantMessage,
      actionEnvelope: result.actionEnvelope,
      actionError: result.actionError
    });
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
      authoring: session.authoring,
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
      messages: assembled.messages,
      taskKey: 'chat'
    });
    const parsedOutput = parseAssistantOutput(assistantResult.content);
    const mvuUpdate = applyAssistantMvuUpdate(session, parsedOutput);
    const speaker = parsedOutput.speaker;
    const parsedReply = parsedOutput.reply;
    const usage = buildUsageSnapshot({ provider, assembled, content: parsedReply.content, providerResult: assistantResult });
    const assistantMessage = createMessage('assistant', parsedReply.content, {
      recommendedActions: parsedReply.recommendedActions,
      usage,
      actionEnvelope: parsedOutput.actionEnvelope,
      actionError: parsedOutput.actionError,
      mvuPatches: mvuUpdate.patches,
      mvuError: mvuUpdate.error,
      roleplayPanels: parsedOutput.roleplayPanels,
      speaker
    });
    appendUsageLedgerEntry(session, {
      taskKey: 'chat',
      messageId: assistantMessage.id,
      usage,
      routing: assistantResult.routing
    });

    return {
      assistantMessage,
      assembled,
      actionEnvelope: parsedOutput.actionEnvelope,
      actionError: parsedOutput.actionError
    };
  }

  async rewriteText({ sessionId = 'main', target = 'chat-input', text, instruction = '' }) {
    const sourceText = String(text || '').trim();
    if (!sourceText) throw new Error('EMPTY_REWRITE_TEXT');

    const [config, session] = await Promise.all([
      this.configService.getAll(),
      this.sessionService.getSession(sessionId)
    ]);
    const activeConfig = await this.resolveSessionConfig(session);
    const provider = getProviderForTask(config, session, 'rewrite');
    const fallbackChain = getProviderChain(config, session, provider, 'rewrite').slice(1);
    const messages = buildRewriteMessages({
      target,
      text: sourceText,
      instruction,
      context: normalizeRewriteTarget(target) === 'recommended-action'
        ? buildRecommendedActionContext({ session, characterCard: activeConfig.characterCard })
        : ''
    });
    const result = await this.completeWithFallback({
      primaryProvider: provider,
      fallbackChain,
      messages,
      taskKey: 'rewrite'
    });
    const usage = buildUsageSnapshot({ provider, messages, content: result.content, providerResult: result });
    appendUsageLedgerEntry(session, {
      taskKey: 'rewrite',
      usage,
      routing: result.routing
    });
    session.updatedAt = new Date().toISOString();
    await this.sessionService.saveSession(session);

    return {
      target: normalizeRewriteTarget(target),
      text: cleanRewriteText(result.content),
      providerId: usage.providerId,
      model: usage.model,
      routing: result.routing,
      usage
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
    const fallbackChain = getProviderChain(globalConfig, session, provider, 'chat').slice(1);

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

    const streamFilter = createHiddenBlockStreamFilter(onToken);
    const assistantResult = await this.completeAssistantContentStream({
      provider,
      messages: assembled.messages,
      onToken: streamFilter.push,
      fallbackChain,
      taskKey: 'chat'
    });
    await streamFilter.end();
    const parsedContinuation = parseAssistantOutput(assistantResult.content);
    const mvuUpdate = applyAssistantMvuUpdate(session, parsedContinuation);
    const usage = buildUsageSnapshot({
      provider,
      assembled,
      content: parsedContinuation.reply.content,
      providerResult: assistantResult
    });
    appendUsageLedgerEntry(session, {
      taskKey: 'chat',
      messageId: lastMessage.id,
      usage,
      routing: assistantResult.routing
    });
    const continuedContent = continuationContent + '\n' + String(parsedContinuation.reply.content || '').trim();
    const parsedReply = extractRecommendedActions(continuedContent);

    lastMessage.content = parsedReply.content;
    lastMessage.actionEnvelope = mergeActionEnvelopes(lastMessage.actionEnvelope, parsedContinuation.actionEnvelope);
    if (!lastMessage.actionEnvelope) delete lastMessage.actionEnvelope;
    if (parsedContinuation.actionError) {
      lastMessage.actionError = {
        code: parsedContinuation.actionError.code,
        detail: String(parsedContinuation.actionError.detail || parsedContinuation.actionError.message || '')
      };
    }
    lastMessage.mvuPatches = [
      ...(Array.isArray(lastMessage.mvuPatches) ? lastMessage.mvuPatches : []),
      ...mvuUpdate.patches
    ].slice(-64);
    if (!lastMessage.mvuPatches.length) delete lastMessage.mvuPatches;
    if (mvuUpdate.error) lastMessage.mvuError = structuredClone(mvuUpdate.error);
    delete lastMessage.adjudication;
    lastMessage.swipes = normalizeSwipes(lastMessage.swipes, lastMessage.content);
    lastMessage.activeSwipeIndex = Math.max(0, lastMessage.swipes.indexOf(lastMessage.content));
    lastMessage.swipeMetadata = normalizeSwipeMetadata(lastMessage, lastMessage.swipes);
    lastMessage.swipeMetadata[lastMessage.activeSwipeIndex] = metadataFromMessage(lastMessage);
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

    // fact/summary 可使用独立 provider，并按任务回退链或全局回退链重试。
    const config = globalConfig || await this.configService.getAll();
    const factProvider = getProviderForTask(config, session, 'fact');
    const factFallback = getProviderChain(config, session, factProvider, 'fact').slice(1);
    const summaryProvider = getProviderForTask(config, session, 'summary');
    const summaryFallback = getProviderChain(config, session, summaryProvider, 'summary').slice(1);
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
      const messages = buildFactExtractionPrompt({
        worldState: session.memory.worldState,
        messages: recent,
        narrativeContext
      });
      const result = await this.completeWithFallback({
        primaryProvider: provider,
        fallbackChain,
        messages,
        taskKey: 'fact'
      });
      const usage = buildUsageSnapshot({ provider, messages, content: result.content, providerResult: result });
      appendUsageLedgerEntry(session, {
        taskKey: 'fact',
        usage,
        routing: result.routing
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
      const messages = buildSummaryPrompt({
        rollingSummary: session.memory.rollingSummary,
        messages: recent,
        narrativeContext
      });
      const result = await this.completeWithFallback({
        primaryProvider: provider,
        fallbackChain,
        messages,
        taskKey: 'summary'
      });
      const usage = buildUsageSnapshot({ provider, messages, content: result.content, providerResult: result });
      appendUsageLedgerEntry(session, {
        taskKey: 'summary',
        usage,
        routing: result.routing
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
  async completeWithFallback({ primaryProvider, fallbackChain = [], messages, taskKey = 'chat' }) {
    const chain = [primaryProvider, ...fallbackChain].filter(Boolean);
    const startedAt = Date.now();
    const attempts = [];
    let lastError;
    for (let index = 0; index < chain.length; index += 1) {
      const provider = chain[index];
      const attemptStartedAt = Date.now();
      try {
        const result = await this.providerClient.complete({ provider, messages });
        attempts.push(buildRoutingAttempt({ provider, status: 'success', startedAt: attemptStartedAt }));
        return attachRoutingMetadata(result, {
          taskKey,
          primaryProvider,
          selectedProvider: provider,
          fallbackUsed: index > 0,
          attempts,
          startedAt
        });
      } catch (error) {
        lastError = error;
        attempts.push(buildRoutingAttempt({ provider, status: 'error', startedAt: attemptStartedAt, error }));
      }
    }
    if (lastError && typeof lastError === 'object') {
      lastError.routing = buildRoutingMetadata({
        taskKey,
        primaryProvider,
        selectedProvider: null,
        fallbackUsed: attempts.length > 1,
        attempts,
        startedAt
      });
    }
    throw lastError || new Error('ALL_PROVIDERS_FAILED');
  }

  /**
   * 带回退的 stream 调用
   */
  async streamWithFallback({ primaryProvider, fallbackChain = [], messages, onToken, taskKey = 'chat' }) {
    const chain = [primaryProvider, ...fallbackChain].filter(Boolean);
    const startedAt = Date.now();
    const attempts = [];
    let lastError;
    for (let index = 0; index < chain.length; index += 1) {
      const provider = chain[index];
      const attemptStartedAt = Date.now();
      try {
        const result = await this.providerClient.stream({ provider, messages, onToken });
        attempts.push(buildRoutingAttempt({ provider, status: 'success', startedAt: attemptStartedAt }));
        return attachRoutingMetadata(result, {
          taskKey,
          primaryProvider,
          selectedProvider: provider,
          fallbackUsed: index > 0,
          attempts,
          startedAt
        });
      } catch (error) {
        lastError = error;
        attempts.push(buildRoutingAttempt({ provider, status: 'error', startedAt: attemptStartedAt, error }));
      }
    }
    if (lastError && typeof lastError === 'object') {
      lastError.routing = buildRoutingMetadata({
        taskKey,
        primaryProvider,
        selectedProvider: null,
        fallbackUsed: attempts.length > 1,
        attempts,
        startedAt
      });
    }
    throw lastError || new Error('ALL_PROVIDERS_FAILED');
  }

  invalidateVectorIndex(session) {
    if (typeof this.vectorMemoryService?.dropIndex !== 'function') return;
    this.vectorMemoryService.dropIndex(session?.id || 'main');
  }
}

function attachRoutingMetadata(result, options) {
  const normalizedResult = isPlainObject(result) ? result : { content: String(result || '') };
  return {
    ...normalizedResult,
    routing: buildRoutingMetadata(options)
  };
}

function buildRoutingMetadata({ taskKey, primaryProvider, selectedProvider, fallbackUsed, attempts, startedAt }) {
  return {
    callId: `call-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    taskKey: String(taskKey || 'chat'),
    requestedProviderId: String(primaryProvider?.id || ''),
    providerId: String(selectedProvider?.id || ''),
    model: String(selectedProvider?.model || ''),
    fallbackUsed: fallbackUsed === true,
    attempts: Array.isArray(attempts) ? attempts.map((attempt) => ({ ...attempt })) : [],
    durationMs: Math.max(0, Date.now() - Number(startedAt || Date.now()))
  };
}

function buildRoutingAttempt({ provider, status, startedAt, error }) {
  return {
    providerId: String(provider?.id || ''),
    model: String(provider?.model || ''),
    status: status === 'success' ? 'success' : 'error',
    durationMs: Math.max(0, Date.now() - Number(startedAt || Date.now())),
    error: error ? String(error.message || error).slice(0, 300) : ''
  };
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
  if (extras.actionEnvelope && typeof extras.actionEnvelope === 'object') {
    message.actionEnvelope = structuredClone(extras.actionEnvelope);
  }
  if (extras.actionError) {
    message.actionError = {
      code: String(extras.actionError.code || 'ACTION_PARSE_FAILED'),
      detail: String(extras.actionError.detail || extras.actionError.message || '')
    };
  }
  if (Array.isArray(extras.mvuPatches) && extras.mvuPatches.length) {
    message.mvuPatches = structuredClone(extras.mvuPatches);
  }
  if (extras.mvuError) {
    message.mvuError = {
      code: String(extras.mvuError.code || 'MVU_PATCH_FAILED'),
      detail: String(extras.mvuError.detail || extras.mvuError.message || '')
    };
  }
  if (extras.kind) message.kind = String(extras.kind);
  if (extras.hiddenFromChat === true) message.hiddenFromChat = true;
  if (extras.speaker) message.speaker = String(extras.speaker).slice(0, 30);
  if (extras.roleplayPanels && typeof extras.roleplayPanels === 'object' && !Array.isArray(extras.roleplayPanels)) {
    message.roleplayPanels = structuredClone(extras.roleplayPanels);
  }
  message.swipeMetadata = [metadataFromMessage(message)];
  return message;
}

function buildRewriteMessages({ target, text, instruction, context = '' }) {
  const normalizedTarget = normalizeRewriteTarget(target);
  const recommendedActionRules = normalizedTarget === 'recommended-action'
    ? [
        '这是玩家已经选定的行动意图，请把它展开成当前主角真正会说、会做的一段行动。',
        '使用第一人称或与最近玩家消息一致的视角，控制在一至三句。',
        '体现角色的身份、性格、措辞和现场环境；需要询问时写出自然、明确的台词。',
        '只能补充动作、语气、观察和表达方式，不得新增行动结果、隐藏知识、NPC回应或新的核心决定。'
      ]
    : [];
  const system = [
    '# Magic Rewrite 改写器',
    '你负责把用户提供的文本改写得更适合沉浸式角色扮演创作。',
    '只输出改写后的文本，不要解释，不要加标题，不要使用 Markdown 代码块。',
    '保持原意、视角和用户已经决定的行动，不新增关键剧情事实，不替用户做新的核心选择。',
    '可以增强节奏、感官细节、语气、画面感和角色扮演可读性。',
    ...recommendedActionRules
  ].join('\n');
  const user = [
    `目标字段：${normalizedTarget}`,
    `改写要求：${String(instruction || '').trim() || '更有画面感，适合作为下一轮角色行动或旁白输入。'}`,
    context ? `\n当前扮演上下文：\n${context}` : '',
    '',
    normalizedTarget === 'recommended-action' ? '选定行动意图：' : '原文：',
    text
  ].filter((line) => line !== '').join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
}

function buildRecommendedActionContext({ session, characterCard }) {
  const card = characterCard && typeof characterCard === 'object' ? characterCard : {};
  const memory = session?.memory && typeof session.memory === 'object' ? session.memory : {};
  const worldState = memory.worldState && typeof memory.worldState === 'object' ? memory.worldState : {};
  const protagonist = worldState.protagonist && typeof worldState.protagonist === 'object'
    ? worldState.protagonist
    : {};
  const narrativeState = memory.narrativeState && typeof memory.narrativeState === 'object'
    ? memory.narrativeState
    : {};
  const explicitRole = card.role && card.role !== card.creator ? card.role : '';
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const recentMessages = messages.slice(-4).map((message) => {
    const speaker = message.role === 'user' ? '玩家' : (message.speaker || '旁白');
    return `${speaker}：${compactRewriteContext(message.content, 900)}`;
  });
  const latestAssistant = [...messages].reverse().find((message) => message?.role === 'assistant');
  const panels = latestAssistant?.roleplayPanels && typeof latestAssistant.roleplayPanels === 'object'
    ? latestAssistant.roleplayPanels
    : {};

  return [
    ['主角', protagonist.name || card.name],
    ['身份', explicitRole || protagonist.realm],
    ['性格与行动习惯', card.personality],
    ['人物背景', card.description],
    ['角色语言示例', card.exampleDialog],
    ['当前地点', worldState.location?.current || worldState.location],
    ['当前主线', narrativeState.activeArc || worldState.activeArc || worldState.quest],
    ['本幕环境', panels.sceneStatus],
    ['本幕人物状态', panels.characterStatus],
    ['最近对话', recentMessages.join('\n')]
  ]
    .map(([label, value]) => [label, compactRewriteContext(value, label === '最近对话' ? 2400 : 700)])
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}：${value}`)
    .join('\n');
}

function compactRewriteContext(value, maxLength = 700) {
  if (value === undefined || value === null || value === '') return '';
  const text = Array.isArray(value)
    ? value.map((item) => compactRewriteContext(item, maxLength)).filter(Boolean).join('；')
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}…` : compact;
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

  const taskProviders = isPlainObject(providersConfig.taskProviders) ? providersConfig.taskProviders : {};
  const sessionTaskProviders = isPlainObject(session.settings?.taskProviderOverrides)
    ? session.settings.taskProviderOverrides
    : {};
  const sessionTaskProviderId = String(sessionTaskProviders[taskKey] || '').trim();
  const sessionProviderId = INTERACTIVE_PROVIDER_TASKS.has(taskKey)
    ? String(session.settings?.providerId || '').trim()
    : '';
  const taskProviderId = String(
    taskProviders[taskKey]
    || (taskKey === 'rewrite' ? taskProviders.chat : '')
    || ''
  ).trim();
  const activeProviderId = String(providersConfig.activeProviderId || '').trim();

  // 会话模型只覆盖交互任务；后台 fact/summary 仍使用各自的任务路由。
  const preferredId = sessionTaskProviderId || sessionProviderId || taskProviderId || activeProviderId;
  const provider = providers.find((p) => p.id === preferredId)
    || providers.find((p) => p.id === activeProviderId)
    || providers[0];
  if (!provider) throw new Error('NO_ACTIVE_PROVIDER');
  return provider;
}

/**
 * 获取 provider 回退链：[主, ...回退]，去重
 */
function getProviderChain(config, session, primaryProvider, taskKey = 'chat') {
  const providersConfig = config.providers || {};
  const providers = Array.isArray(providersConfig.providers) ? providersConfig.providers : [];
  const sessionTaskFallbacks = isPlainObject(session.settings?.taskFallbackOverrides)
    ? session.settings.taskFallbackOverrides
    : {};
  const taskFallbackChains = isPlainObject(providersConfig.taskFallbackChains)
    ? providersConfig.taskFallbackChains
    : {};
  const taskFallbackIds = Array.isArray(sessionTaskFallbacks[taskKey]) && sessionTaskFallbacks[taskKey].length
    ? sessionTaskFallbacks[taskKey]
    : (Array.isArray(taskFallbackChains[taskKey]) && taskFallbackChains[taskKey].length
        ? taskFallbackChains[taskKey]
        : (taskKey === 'rewrite' && Array.isArray(taskFallbackChains.chat) ? taskFallbackChains.chat : []));
  const fallbackIds = taskFallbackIds.length
    ? taskFallbackIds
    : (Array.isArray(providersConfig.fallbackChain) ? providersConfig.fallbackChain : []);
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

function buildUsageSnapshot({ provider, assembled = {}, messages = [], content, providerResult }) {
  const providerUsage = providerResult?.usage || providerResult?.raw?.usage || {};
  const routing = isPlainObject(providerResult?.routing) ? providerResult.routing : {};
  const promptEstimate = Number.isFinite(Number(assembled?.tokenEstimate))
    ? Number(assembled.tokenEstimate)
    : estimateMessageTokens(messages);
  const promptTokens = normalizeTokenCount(providerUsage.prompt_tokens ?? providerUsage.promptTokens, promptEstimate);
  const completionTokens = normalizeTokenCount(
    providerUsage.completion_tokens ?? providerUsage.completionTokens,
    estimateTokens(content)
  );
  return {
    callId: String(routing.callId || ''),
    taskKey: String(routing.taskKey || 'chat'),
    requestedProviderId: String(routing.requestedProviderId || provider?.id || ''),
    providerId: String(routing.providerId || provider?.id || ''),
    model: String(routing.model || provider?.model || ''),
    fallbackUsed: routing.fallbackUsed === true,
    durationMs: normalizeTokenCount(routing.durationMs, 0),
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

function appendUsageLedgerEntry(session, { taskKey, messageId = '', usage, routing }) {
  if (!session || !isPlainObject(usage)) return;
  if (!Array.isArray(session.usageLedger)) session.usageLedger = [];
  const callId = String(usage.callId || routing?.callId || `call-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  if (session.usageLedger.some((entry) => entry?.callId === callId)) return;

  session.usageLedger.push({
    callId,
    messageId: String(messageId || ''),
    taskKey: String(taskKey || usage.taskKey || 'chat'),
    createdAt: new Date().toISOString(),
    requestedProviderId: String(usage.requestedProviderId || routing?.requestedProviderId || ''),
    providerId: String(usage.providerId || routing?.providerId || ''),
    model: String(usage.model || routing?.model || ''),
    fallbackUsed: usage.fallbackUsed === true || routing?.fallbackUsed === true,
    attempts: Array.isArray(routing?.attempts) ? routing.attempts.map((attempt) => ({ ...attempt })) : [],
    durationMs: normalizeTokenCount(usage.durationMs ?? routing?.durationMs, 0),
    promptTokens: normalizeTokenCount(usage.promptTokens, 0),
    completionTokens: normalizeTokenCount(usage.completionTokens, 0),
    totalTokens: normalizeTokenCount(usage.totalTokens, 0),
    injectedCards: normalizeTokenCount(usage.injectedCards, 0),
    promptModules: normalizeTokenCount(usage.promptModules, 0),
    estimated: usage.estimated !== false,
    status: 'success'
  });
}

function linkUsageLedgerEntry(session, callId, messageId) {
  if (!Array.isArray(session?.usageLedger) || !callId || !messageId) return;
  const entry = session.usageLedger.find((item) => item?.callId === callId);
  if (entry) entry.messageId = String(messageId);
}

function estimateMessageTokens(messages) {
  const text = (Array.isArray(messages) ? messages : [])
    .map((message) => String(message?.content || ''))
    .join('\n');
  return estimateTokens(text);
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

function parseAssistantOutput(rawContent) {
  const mvuParsed = extractMvuPatchEnvelope(rawContent);
  const actionParsed = extractActionEnvelope(mvuParsed.content);
  const reply = extractRecommendedActions(actionParsed.content);
  const presentation = parseRoleplayResponse(reply.content);
  reply.content = presentation.content;
  if (!String(reply.content || '').trim()) throw new Error('PROVIDER_EMPTY_RESPONSE');
  return {
    reply,
    speaker: presentation.speaker || extractSpeaker(actionParsed.content),
    roleplayPanels: presentation.panels,
    actionEnvelope: actionParsed.envelope,
    actionError: actionParsed.error,
    mvuEnvelope: mvuParsed.envelope,
    mvuError: mvuParsed.error
  };
}

function applyAssistantMvuUpdate(session, parsedOutput) {
  const parsedError = parsedOutput?.mvuError;
  if (!parsedOutput?.mvuEnvelope) {
    return { patches: [], error: parsedError ? serializeMvuError(parsedError) : null };
  }

  const memory = session.memory || (session.memory = {});
  const current = normalizeMvuSnapshot(memory.lightFrontendState);
  if (!current.enabled) {
    return {
      patches: [],
      error: { code: 'MVU_RUNTIME_DISABLED', detail: '当前会话未启用轻前端 MVU 状态。' }
    };
  }
  if (!memory.lightFrontendBaseline || typeof memory.lightFrontendBaseline !== 'object') {
    memory.lightFrontendBaseline = structuredClone(current);
  }

  try {
    const applied = applyMvuPatchEnvelope(current, parsedOutput.mvuEnvelope);
    memory.lightFrontendState = structuredClone(applied.state);
    memory.lightFrontendReplayErrors = [];
    return { patches: [applied.envelope], error: null };
  } catch (error) {
    return { patches: [], error: serializeMvuError(error) };
  }
}

function serializeMvuError(error) {
  return {
    code: String(error?.code || error?.message || 'MVU_PATCH_FAILED'),
    detail: String(error?.detail || error?.message || '')
  };
}

function mergeActionEnvelopes(left, right) {
  if (!left && !right) return null;
  if (!left) return structuredClone(right);
  if (!right) return structuredClone(left);
  return {
    spec: left.spec || right.spec || 'lra.action/v1',
    id: left.id || right.id,
    actorId: right.actorId || left.actorId || 'narrator',
    summary: [left.summary, right.summary].filter(Boolean).join('；').slice(0, 240),
    baseRevision: null,
    actions: [
      ...(Array.isArray(left.actions) ? structuredClone(left.actions) : []),
      ...(Array.isArray(right.actions) ? structuredClone(right.actions) : [])
    ].slice(0, 20)
  };
}

function createHiddenBlockStreamFilter(onToken) {
  let buffer = '';
  let emitted = '';
  const emit = async (value) => {
    if (value) await onToken?.(value);
  };
  return {
    push: async (chunk) => {
      buffer += String(chunk || '');
      const visible = parseRoleplayResponse(buffer).content;
      if (visible.startsWith(emitted)) {
        await emit(visible.slice(emitted.length));
        emitted = visible;
      }
    },
    end: async () => {
      const visible = parseRoleplayResponse(buffer).content;
      if (visible.startsWith(emitted)) await emit(visible.slice(emitted.length));
      buffer = '';
      emitted = '';
    }
  };
}

function normalizeSwipeMetadata(message, swipes) {
  const metadata = Array.isArray(message?.swipeMetadata)
    ? message.swipeMetadata.map(normalizeSwipeMetadataEntry)
    : [];
  while (metadata.length < swipes.length) metadata.push(emptySwipeMetadata());
  const activeIndex = Number(message?.activeSwipeIndex || 0);
  if (metadata[activeIndex]
    && !metadata[activeIndex].actionEnvelope
    && !metadata[activeIndex].mvuPatches?.length
    && (message?.actionEnvelope || message?.mvuPatches?.length)) {
    metadata[activeIndex] = metadataFromMessage(message);
  }
  return metadata.slice(0, swipes.length);
}

function normalizeSwipeMetadataEntry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptySwipeMetadata();
  return {
    actionEnvelope: value.actionEnvelope ? structuredClone(value.actionEnvelope) : null,
    actionError: value.actionError ? structuredClone(value.actionError) : null,
    mvuPatches: Array.isArray(value.mvuPatches) ? structuredClone(value.mvuPatches) : [],
    mvuError: value.mvuError ? structuredClone(value.mvuError) : null,
    adjudication: value.adjudication ? structuredClone(value.adjudication) : null,
    recommendedActions: Array.isArray(value.recommendedActions) ? structuredClone(value.recommendedActions) : [],
    roleplayPanels: value.roleplayPanels ? structuredClone(value.roleplayPanels) : null,
    speaker: value.speaker ? String(value.speaker).slice(0, 30) : ''
  };
}

function metadataFromMessage(message) {
  return normalizeSwipeMetadataEntry({
    actionEnvelope: message?.actionEnvelope,
    actionError: message?.actionError,
    mvuPatches: message?.mvuPatches,
    mvuError: message?.mvuError,
    adjudication: message?.adjudication,
    recommendedActions: message?.recommendedActions,
    roleplayPanels: message?.roleplayPanels,
    speaker: message?.speaker
  });
}

function emptySwipeMetadata() {
  return {
    actionEnvelope: null,
    actionError: null,
    mvuPatches: [],
    mvuError: null,
    adjudication: null,
    recommendedActions: [],
    roleplayPanels: null,
    speaker: ''
  };
}

function applySwipeMetadata(message, metadata) {
  clearMessageWorldUpdate(message);
  const normalized = normalizeSwipeMetadataEntry(metadata);
  if (normalized.actionEnvelope) message.actionEnvelope = normalized.actionEnvelope;
  if (normalized.actionError) message.actionError = normalized.actionError;
  if (normalized.mvuPatches.length) message.mvuPatches = normalized.mvuPatches;
  if (normalized.mvuError) message.mvuError = normalized.mvuError;
  if (normalized.adjudication) message.adjudication = normalized.adjudication;
  if (normalized.recommendedActions.length) message.recommendedActions = normalized.recommendedActions;
  else delete message.recommendedActions;
  if (normalized.roleplayPanels) message.roleplayPanels = normalized.roleplayPanels;
  if (normalized.speaker) message.speaker = normalized.speaker;
}

function clearMessageWorldUpdate(message) {
  delete message.actionEnvelope;
  delete message.actionError;
  delete message.mvuPatches;
  delete message.mvuError;
  delete message.adjudication;
  delete message.roleplayPanels;
  delete message.speaker;
}

function isJourneySetupContent(content) {
  return /^\s*\[\s*命途设定\s*[：:]?/u.test(String(content || ''));
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
