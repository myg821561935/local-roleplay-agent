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

export function buildOpenAICompatibleRequest({ provider, messages, stream = false }) {
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
  if (stream) body.stream = true;

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

export async function streamOpenAICompatible({ provider, messages, onToken, fetchImpl = fetch }) {
  const { url, init } = buildOpenAICompatibleRequest({ provider, messages, stream: true });
  const response = await fetchImpl(url, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Provider stream error ${response.status}: ${text.slice(0, 240)}`);
  }
  if (!response.body?.getReader) {
    throw new Error('Provider stream response missing readable body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';
    for (const eventText of events) {
      const token = readStreamToken(eventText);
      if (!token) continue;
      content += token;
      await onToken?.(token);
    }
  }

  return { content, raw: null };
}

function readStreamToken(eventText) {
  const lines = String(eventText || '').split('\n');
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6).trim();
    if (!data || data === '[DONE]') continue;
    const payload = JSON.parse(data);
    const token = payload?.choices?.[0]?.delta?.content;
    if (typeof token === 'string') return token;
  }
  return '';
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
