/**
 * Embedding 客户端：调用 OpenAI Compatible /v1/embeddings 接口
 * 支持用户已配置的 baseUrl + apiKey
 */

const RESERVED_CUSTOM_HEADERS = new Set(['authorization', 'content-type']);

function filterHeaders(headers = {}) {
  if (!headers || typeof headers !== 'object') return {};
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !RESERVED_CUSTOM_HEADERS.has(name.toLowerCase()))
  );
}

/**
 * @param {{provider: any, input: string|string[], fetchImpl?: Function}} args
 * @returns {Promise<{vectors: number[][], raw: any}>}
 */
export async function embed({ provider, input, fetchImpl = fetch }) {
  if (!provider || typeof provider !== 'object') {
    throw new Error('embedding provider must be an object');
  }
  const baseUrl = String(provider.baseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) throw new Error('Provider baseUrl is required for embeddings');
  const apiKey = String(provider.apiKey || '').trim();
  if (!apiKey) throw new Error('Provider apiKey is required for embeddings');
  const model = String(provider.embeddingModel || provider.model || '').trim();
  if (!model) throw new Error('Provider model (or embeddingModel) is required for embeddings');

  const url = `${baseUrl}/embeddings`;
  const body = JSON.stringify({
    model,
    input: Array.isArray(input) ? input : [input]
  });

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      ...filterHeaders(provider.headers)
    },
    body
  });

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Embedding provider returned non-JSON response ${response.status}: ${text.slice(0, 160)}`);
  }

  if (!response.ok) {
    throw new Error(`Embedding provider error ${response.status}: ${JSON.stringify(payload).slice(0, 240)}`);
  }

  const data = Array.isArray(payload?.data) ? payload.data : [];
  const vectors = data
    .sort((a, b) => (a.index || 0) - (b.index || 0))
    .map((item) => Array.isArray(item.embedding) ? item.embedding : [])
    .filter((v) => v.length > 0);

  if (vectors.length === 0) {
    throw new Error('Embedding response missing vectors');
  }

  return { vectors, raw: payload };
}

/**
 * 构建单条消息的 embedding 输入文本（包含 role + content 摘要）
 */
export function buildEmbeddingText(message) {
  if (!message || typeof message !== 'object') return '';
  const role = String(message.role || 'user');
  const content = String(message.content || '').trim();
  if (!content) return '';
  // 截断防止 token 爆炸
  const truncated = content.length > 1000 ? `${content.slice(0, 1000)}...` : content;
  return `[${role}] ${truncated}`;
}
