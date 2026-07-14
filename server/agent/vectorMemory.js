/**
 * 向量记忆服务：管理消息向量索引 + 检索相关历史片段
 * 单例，所有 session 共享一个内存索引（按 sessionId 隔离元数据）
 */

import { VectorStore } from './vectorStore.js';
import { embed, buildEmbeddingText } from './embeddingClient.js';

export class VectorMemoryService {
  constructor({ configService, fetchImpl }) {
    this.configService = configService;
    this.fetchImpl = fetchImpl || fetch;
    /** @type {Map<string, {messageIds: Set<string>, vectorStore: VectorStore}>} */
    this.sessionIndexes = new Map();
    this.lastError = '';
  }

  /**
   * 获取或创建 session 的索引
   * @param {string} sessionId
   */
  getIndex(sessionId) {
    let index = this.sessionIndexes.get(sessionId);
    if (!index) {
      index = { messageIds: new Set(), vectorStore: new VectorStore() };
      this.sessionIndexes.set(sessionId, index);
    }
    return index;
  }

  /**
   * 从 session.messages 重建向量索引（增量：只处理新消息）
   * @param {{sessionId: string, messages: any[]}} args
   */
  async indexMessages({ sessionId, messages }) {
    if (!Array.isArray(messages) || messages.length === 0) return { indexed: 0 };
    const index = this.getIndex(sessionId);
    const config = await this.configService.getAll();
    const provider = resolveEmbeddingProvider(config);
    if (!provider) {
      this.lastError = 'NO_EMBEDDING_PROVIDER';
      return { indexed: 0, error: this.lastError };
    }

    const newMessages = messages.filter((msg) => msg && msg.id && !index.messageIds.has(msg.id) && !msg.excluded);
    if (newMessages.length === 0) return { indexed: 0 };

    const texts = newMessages.map(buildEmbeddingText).filter(Boolean);
    if (texts.length === 0) return { indexed: 0 };

    try {
      const { vectors } = await embed({
        provider,
        input: texts,
        fetchImpl: this.fetchImpl
      });
      let vectorIdx = 0;
      let added = 0;
      for (const msg of newMessages) {
        const text = buildEmbeddingText(msg);
        if (!text) continue;
        const vector = vectors[vectorIdx++];
        if (!vector) continue;
        const recordId = `msg-${msg.id}`;
        index.vectorStore.add(recordId, vector, {
          sessionId,
          messageId: msg.id,
          role: msg.role,
          content: String(msg.content || '').slice(0, 500),
          createdAt: msg.createdAt
        });
        index.messageIds.add(msg.id);
        added++;
      }
      this.lastError = '';
      return { indexed: added };
    } catch (error) {
      this.lastError = error.message;
      return { indexed: 0, error: error.message };
    }
  }

  /**
   * 检索相关历史片段
   * @param {{sessionId: string, query: string, topK?: number, excludeMessageIds?: string[]}} args
   * @returns {Promise<Array<{messageId: string, role: string, content: string, score: number}>>}
   */
  async search({ sessionId, query, topK = 5, excludeMessageIds = [] }) {
    if (!query || !String(query).trim()) return [];
    const index = this.sessionIndexes.get(sessionId);
    if (!index || index.vectorStore.size === 0) return [];

    const config = await this.configService.getAll();
    const provider = resolveEmbeddingProvider(config);
    if (!provider) return [];

    try {
      const { vectors } = await embed({
        provider,
        input: String(query).slice(0, 1000),
        fetchImpl: this.fetchImpl
      });
      const queryVector = vectors[0];
      if (!queryVector) return [];

      const excludeSet = new Set(excludeMessageIds);
      const results = index.vectorStore.search(queryVector, topK, (metadata) => {
        if (excludeSet.has(metadata.messageId)) return false;
        return true;
      });
      return results.map((r) => ({
        messageId: r.metadata.messageId,
        role: r.metadata.role,
        content: r.metadata.content,
        score: r.score
      }));
    } catch (error) {
      this.lastError = error.message;
      return [];
    }
  }

  /**
   * 删除 session 索引（消息被 edit/regenerate/delete 时）
   * @param {string} sessionId
   */
  dropIndex(sessionId) {
    this.sessionIndexes.delete(sessionId);
  }

  /**
   * 删除某条消息的向量
   */
  removeMessage(sessionId, messageId) {
    const index = this.sessionIndexes.get(sessionId);
    if (!index) return;
    index.vectorStore.remove(`msg-${messageId}`);
    index.messageIds.delete(messageId);
  }

  /**
   * 获取索引统计
   */
  getStats(sessionId) {
    const index = this.sessionIndexes.get(sessionId);
    if (!index) return { indexed: 0, enabled: false };
    return { indexed: index.vectorStore.size, enabled: true };
  }

  /**
   * 是否启用（基于配置）
   */
  async isEnabled(session) {
    const config = await this.configService.getAll();
    const sessionOverride = session?.settings?.vectorMemoryEnabled;
    const enabled = sessionOverride !== undefined ? sessionOverride : (config.vectorMemory?.enabled ?? false);
    return Boolean(enabled) && Boolean(resolveEmbeddingProvider(config));
  }

  async getTopK(session) {
    const config = await this.configService.getAll();
    return Number(session?.settings?.vectorTopK ?? config.vectorMemory?.topK ?? 5);
  }
}

/**
 * 从配置中解析 embedding provider
 * 优先级：vectorMemory.providerId > providers 中第一个支持 embedding 的 > activeProvider
 */
export function resolveEmbeddingProvider(config) {
  const providersConfig = config?.providers || {};
  const providers = Array.isArray(providersConfig.providers) ? providersConfig.providers : [];

  // 1. 显式配置的 embedding providerId
  const embeddingProviderId = String(config?.vectorMemory?.providerId || '').trim();
  if (embeddingProviderId) {
    const found = providers.find((p) => p.id === embeddingProviderId);
    if (found) return found;
  }

  // 2. 默认 activeProvider
  const activeProviderId = String(providersConfig.activeProviderId || '').trim();
  if (activeProviderId) {
    const found = providers.find((p) => p.id === activeProviderId);
    if (found) return found;
  }

  // 3. 第一个 provider
  return providers[0] || null;
}
