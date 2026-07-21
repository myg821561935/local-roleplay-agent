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
  let reasoningObserved = false;
  let finishReason = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';
      for (const eventText of events) {
        const delta = readStreamDelta(eventText);
        if (!delta) continue;
        if (delta.reasoningObserved) reasoningObserved = true;
        if (delta.finishReason) finishReason = delta.finishReason;
        if (!delta.content) continue;
        content += delta.content;
        await onToken?.(delta.content);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  if (!content.trim()) {
    if (reasoningObserved) {
      throw new Error(`PROVIDER_REASONING_ONLY_RESPONSE${finishReason ? `:${finishReason}` : ''}`);
    }
    throw new Error('PROVIDER_EMPTY_RESPONSE');
  }

  return {
    content,
    raw: { finishReason, reasoningObserved }
  };
}

function readStreamDelta(eventText) {
  const lines = String(eventText || '').split('\n');
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6).trim();
    if (!data || data === '[DONE]') continue;
    const payload = JSON.parse(data);
    const choice = payload?.choices?.[0];
    const delta = choice?.delta || {};
    return {
      content: typeof delta.content === 'string' ? delta.content : '',
      reasoningObserved: typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0,
      finishReason: String(choice?.finish_reason || '')
    };
  }
  return null;
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

  const choice = payload?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content !== 'string' || content.length === 0) {
    if (typeof choice?.message?.reasoning_content === 'string' && choice.message.reasoning_content.length > 0) {
      throw new Error(`PROVIDER_REASONING_ONLY_RESPONSE${choice?.finish_reason ? `:${choice.finish_reason}` : ''}`);
    }
    throw new Error(`Provider response missing assistant content: ${JSON.stringify(payload).slice(0, 240)}`);
  }

  return {
    content,
    raw: payload
  };
}
