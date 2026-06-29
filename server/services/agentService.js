import { assemblePrompt } from '../agent/promptAssembler.js';
import { appendTurnEvent } from '../agent/memoryUpdater.js';
import { buildSummaryPrompt, shouldSummarize } from '../agent/summaryScheduler.js';

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
    const provider = config.providers.providers.find((item) => item.id === config.providers.activeProviderId);
    if (!provider) throw new Error('NO_ACTIVE_PROVIDER');

    const userMessage = createMessage('user', content);
    const assembled = assemblePrompt({
      promptModules: config.promptModules,
      worldBook: config.worldBook,
      memory: session.memory,
      messages: session.messages,
      userMessage: content,
      options: session.settings
    });

    const assistantResult = await this.providerClient.complete({
      provider,
      messages: assembled.messages
    });
    const assistantMessage = createMessage('assistant', assistantResult.content);

    session.messages.push(userMessage, assistantMessage);
    session.memory = appendTurnEvent({
      memory: session.memory,
      userMessage,
      assistantMessage,
      turnId: assistantMessage.id
    });

    if (shouldSummarize({
      unsummarizedTurnCount: session.memory.unsummarizedTurnCount,
      promptTokenEstimate: assembled.tokenEstimate,
      maxPromptTokens: session.settings.maxPromptTokens
    })) {
      await this.trySummarize({ session, provider });
    }

    session.updatedAt = new Date().toISOString();
    await this.sessionService.saveSession(session);
    return {
      session,
      reply: assistantMessage,
      debug: assembled
    };
  }

  async trySummarize({ session, provider }) {
    const recent = session.messages.slice(-8);
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

function createMessage(role, content) {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content: String(content || ''),
    createdAt: new Date().toISOString()
  };
}
