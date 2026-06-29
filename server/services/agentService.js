import { assemblePrompt } from '../agent/promptAssembler.js';
import { appendTurnEvent, rebuildMemoryFromMessages } from '../agent/memoryUpdater.js';
import { buildSummaryPrompt, shouldSummarize } from '../agent/summaryScheduler.js';
import { applyFactExtractionResult, buildFactExtractionPrompt } from '../agent/factExtractor.js';

export class AgentService {
  constructor({ configService, sessionService, providerClient }) {
    this.configService = configService;
    this.sessionService = sessionService;
    this.providerClient = providerClient;
  }

  async sendMessage({ sessionId = 'main', content }) {
    const [config, session] = await Promise.all([
      this.configService.getAll(),
      this.sessionService.getSession(sessionId)
    ]);
    const provider = getActiveProvider(config);

    const userMessage = createMessage('user', content);
    const { assistantMessage, assembled } = await this.generateAssistantMessage({
      config,
      session,
      provider,
      userMessage
    });

    session.messages.push(userMessage, assistantMessage);
    session.memory = appendTurnEvent({
      memory: session.memory,
      userMessage,
      assistantMessage,
      turnId: assistantMessage.id
    });

    await this.runMemoryMaintenanceIfNeeded({ session, provider, assembled });

    session.updatedAt = new Date().toISOString();
    await this.sessionService.saveSession(session);
    return {
      session,
      reply: assistantMessage,
      debug: assembled
    };
  }

  async editMessage({ sessionId = 'main', messageId, content }) {
    const [config, session] = await Promise.all([
      this.configService.getAll(),
      this.sessionService.getSession(sessionId)
    ]);
    const index = findMessageIndex(session, messageId);
    const message = session.messages[index];

    if (message.role === 'assistant') {
      message.content = String(content || '');
      message.swipes = normalizeSwipes(message.swipes, message.content);
      message.activeSwipeIndex = Math.max(0, message.swipes.indexOf(message.content));
      message.updatedAt = new Date().toISOString();
      session.messages = session.messages.slice(0, index + 1);
      session.memory = rebuildMemoryFromMessages({ memory: session.memory, messages: session.messages });
      session.updatedAt = new Date().toISOString();
      await this.sessionService.saveSession(session);
      return { session, reply: message };
    }

    if (message.role !== 'user') throw new Error('UNSUPPORTED_MESSAGE_ROLE');

    const provider = getActiveProvider(config);
    message.content = String(content || '');
    message.updatedAt = new Date().toISOString();
    session.messages = session.messages.slice(0, index + 1);

    const { assistantMessage, assembled } = await this.generateAssistantMessage({
      promptModules: config.promptModules,
      config,
      session,
      provider,
      userMessage: message
    });

    session.messages.push(assistantMessage);
    session.memory = rebuildMemoryFromMessages({ memory: session.memory, messages: session.messages });
    await this.runMemoryMaintenanceIfNeeded({ session, provider, assembled });

    session.updatedAt = new Date().toISOString();
    await this.sessionService.saveSession(session);
    return { session, reply: assistantMessage, debug: assembled };
  }

  async regenerateAssistantMessage({ sessionId = 'main', messageId }) {
    const [config, session] = await Promise.all([
      this.configService.getAll(),
      this.sessionService.getSession(sessionId)
    ]);
    const provider = getActiveProvider(config);
    const index = findMessageIndex(session, messageId);
    const assistantMessage = session.messages[index];
    if (assistantMessage.role !== 'assistant') throw new Error('MESSAGE_NOT_ASSISTANT');

    const userMessage = session.messages[index - 1];
    if (!userMessage || userMessage.role !== 'user') throw new Error('MISSING_USER_MESSAGE');

    session.messages = session.messages.slice(0, index);
    const result = await this.generateAssistantMessage({ config, session, provider, userMessage });
    const nextSwipe = result.assistantMessage.content;
    const swipes = normalizeSwipes(assistantMessage.swipes, assistantMessage.content);
    swipes.push(nextSwipe);

    assistantMessage.content = nextSwipe;
    assistantMessage.swipes = swipes;
    assistantMessage.activeSwipeIndex = swipes.length - 1;
    assistantMessage.updatedAt = new Date().toISOString();
    session.messages.push(assistantMessage);
    session.memory = rebuildMemoryFromMessages({ memory: session.memory, messages: session.messages });
    await this.runMemoryMaintenanceIfNeeded({ session, provider, assembled: result.assembled });

    session.updatedAt = new Date().toISOString();
    await this.sessionService.saveSession(session);
    return { session, reply: assistantMessage, debug: result.assembled };
  }

  async generateAssistantMessage({ config, session, provider, userMessage }) {
    const assembled = assemblePrompt({
      promptModules: config.promptModules,
      characterCard: config.characterCard,
      worldBook: config.worldBook,
      memory: session.memory,
      messages: session.messages,
      userMessage: userMessage.content,
      options: session.settings
    });

    const assistantResult = await this.providerClient.complete({
      provider,
      messages: assembled.messages
    });
    const parsedReply = extractRecommendedActions(assistantResult.content);
    const assistantMessage = createMessage('assistant', parsedReply.content, {
      recommendedActions: parsedReply.recommendedActions
    });

    return { assistantMessage, assembled };
  }

  async runMemoryMaintenanceIfNeeded({ session, provider, assembled }) {
    const shouldRunMaintenance = shouldSummarize({
      unsummarizedTurnCount: session.memory.unsummarizedTurnCount,
      promptTokenEstimate: assembled.tokenEstimate,
      maxPromptTokens: session.settings.maxPromptTokens
    });
    if (shouldRunMaintenance) {
      await this.tryExtractFacts({ session, provider });
      await this.trySummarize({ session, provider });
    }
  }

  async tryExtractFacts({ session, provider }) {
    const unsummarizedTurnCount = Number(session.memory.unsummarizedTurnCount || 0);
    const messageWindow = Math.max(8, unsummarizedTurnCount * 2);
    const recent = session.messages.slice(-messageWindow);
    try {
      const result = await this.providerClient.complete({
        provider,
        messages: buildFactExtractionPrompt({
          worldState: session.memory.worldState,
          messages: recent
        })
      });
      session.memory = applyFactExtractionResult(session.memory, result.content);
    } catch (error) {
      session.memory.lastFactExtractionError = error.message;
    }
  }

  async trySummarize({ session, provider }) {
    const unsummarizedTurnCount = Number(session.memory.unsummarizedTurnCount || 0);
    const messageWindow = Math.max(8, unsummarizedTurnCount * 2);
    const recent = session.messages.slice(-messageWindow);
    try {
      const result = await this.providerClient.complete({
        provider,
        messages: buildSummaryPrompt({
          rollingSummary: session.memory.rollingSummary,
          messages: recent
        })
      });
      session.memory.rollingSummary = result.content;
      session.memory.unsummarizedTurnCount = 0;
      session.memory.lastSummaryError = '';
    } catch (error) {
      session.memory.lastSummaryError = error.message;
    }
  }
}

function createMessage(role, content, extras = {}) {
  const message = {
    id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content: String(content || ''),
    createdAt: new Date().toISOString()
  };
  if (role === 'assistant') {
    message.swipes = [message.content];
    message.activeSwipeIndex = 0;
  }
  if (Array.isArray(extras.recommendedActions) && extras.recommendedActions.length) {
    message.recommendedActions = extras.recommendedActions;
  }
  return message;
}

function getActiveProvider(config) {
  const provider = config.providers.providers.find((item) => item.id === config.providers.activeProviderId);
  if (!provider) throw new Error('NO_ACTIVE_PROVIDER');
  return provider;
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
  const cleanContent = content.replace(match[0], '').trim();
  return { content: cleanContent, recommendedActions };
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
