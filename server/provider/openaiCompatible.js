const RESERVED_CUSTOM_HEADERS = new Set(['authorization', 'content-type']);

function requireNonEmptyString(value, message) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(message);
  }
  return value.trim();
}

function filterProviderHeaders(headers = {}) {
  if (!headers || typeof headers !== 'object') {
    return {};
  }

  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !RESERVED_CUSTOM_HEADERS.has(name.toLowerCase()))
  );
}

function validateOpenAICompatibleRequest({ provider, messages }) {
  if (!provider || typeof provider !== 'object' || Array.isArray(provider)) {
    throw new Error('provider must be an object');
  }

  return {
    baseUrl: requireNonEmptyString(provider.baseUrl, 'Provider baseUrl is required'),
    model: requireNonEmptyString(provider.model, 'Provider model is required'),
    apiKey: requireNonEmptyString(provider.apiKey, 'Provider apiKey is required'),
    messages
  };
}

export function buildOpenAICompatibleRequest({ provider, messages }) {
  const validated = validateOpenAICompatibleRequest({ provider, messages });
  if (!Array.isArray(validated.messages)) {
    throw new Error('messages must be an array');
  }

  const baseUrl = validated.baseUrl.replace(/\/+$/, '');
  const url = `${baseUrl}/chat/completions`;
  const body = {
    model: validated.model,
    messages: validated.messages,
    temperature: Number(provider.temperature ?? 0.9),
    max_tokens: Number(provider.maxTokens ?? 2000)
  };

  return {
    url,
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${validated.apiKey}`,
        ...filterProviderHeaders(provider.headers)
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
    throw new Error(`Provider returned non-JSON response ${response.status}: ${text.slice(0, 160)}`);
  }

  if (!response.ok) {
    throw new Error(`Provider error ${response.status}: ${JSON.stringify(payload).slice(0, 240)}`);
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error(`Provider response missing assistant content: ${JSON.stringify(payload).slice(0, 240)}`);
  }

  return {
    content,
    raw: payload
  };
}
