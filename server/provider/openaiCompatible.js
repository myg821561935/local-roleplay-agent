export function buildOpenAICompatibleRequest({ provider, messages }) {
  const baseUrl = String(provider.baseUrl || '').replace(/\/+$/, '');
  const url = `${baseUrl}/chat/completions`;
  const body = {
    model: provider.model,
    messages,
    temperature: Number(provider.temperature ?? 0.9),
    max_tokens: Number(provider.maxTokens ?? 2000)
  };

  return {
    url,
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${provider.apiKey}`,
        ...(provider.headers || {})
      },
      body: JSON.stringify(body)
    }
  };
}

export async function callOpenAICompatible({ provider, messages, fetchImpl = fetch }) {
  const { url, init } = buildOpenAICompatibleRequest({ provider, messages });
  const response = await fetchImpl(url, init);
  return readOpenAICompatibleResponse(response);
}

export async function readOpenAICompatibleResponse(response) {
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Provider returned non-JSON response: ${text.slice(0, 160)}`);
  }

  if (!response.ok) {
    throw new Error(`Provider error ${response.status}: ${JSON.stringify(payload).slice(0, 240)}`);
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`Provider response missing assistant content: ${JSON.stringify(payload).slice(0, 240)}`);
  }

  return {
    content,
    raw: payload
  };
}
