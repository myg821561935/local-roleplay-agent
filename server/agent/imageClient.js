/**
 * 图像生成客户端：调用 OpenAI Compatible /v1/images/generations 接口
 */

const RESERVED_CUSTOM_HEADERS = new Set(['authorization', 'content-type']);

function filterHeaders(headers = {}) {
  if (!headers || typeof headers !== 'object') return {};
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !RESERVED_CUSTOM_HEADERS.has(name.toLowerCase()))
  );
}

/**
 * @param {{provider: any, prompt: string, size?: string, fetchImpl?: Function}} args
 * @returns {Promise<{urls: string[], b64: string[], raw: any}>}
 */
export async function generateImage({ provider, prompt, size = '1024x1024', fetchImpl = fetch }) {
  if (!provider || typeof provider !== 'object') {
    throw new Error('image provider must be an object');
  }
  const baseUrl = String(provider.baseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) throw new Error('Provider baseUrl is required for image generation');
  const apiKey = String(provider.apiKey || '').trim();
  if (!apiKey) throw new Error('Provider apiKey is required for image generation');
  const model = String(provider.imageModel || provider.model || '').trim();
  if (!model) throw new Error('Provider model (or imageModel) is required for image generation');

  const url = `${baseUrl}/images/generations`;
  const body = JSON.stringify({
    model,
    prompt: String(prompt || '').slice(0, 4000),
    n: 1,
    size
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
    throw new Error(`Image provider returned non-JSON response ${response.status}: ${text.slice(0, 160)}`);
  }

  if (!response.ok) {
    throw new Error(`Image provider error ${response.status}: ${JSON.stringify(payload).slice(0, 240)}`);
  }

  const data = Array.isArray(payload?.data) ? payload.data : [];
  const urls = data.map((item) => String(item.url || '').trim()).filter(Boolean);
  const b64 = data.map((item) => String(item.b64_json || '').trim()).filter(Boolean);

  if (urls.length === 0 && b64.length === 0) {
    throw new Error('Image response missing urls or b64_json');
  }

  return { urls, b64, raw: payload };
}
