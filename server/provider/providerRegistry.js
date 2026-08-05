import { callAnthropic, streamAnthropic } from './anthropic.js';
import { callGemini, streamGemini } from './gemini.js';
import { callOpenAICompatible, streamOpenAICompatible } from './openaiCompatible.js';

export function buildProviderClient() {
  return {
    complete: ({ provider, messages, fetchImpl, tools }) => callProvider({ provider, messages, fetchImpl, tools }),
    stream: ({ provider, messages, onToken, fetchImpl }) => streamProvider({ provider, messages, onToken, fetchImpl })
  };
}

async function callProvider({ provider, messages, fetchImpl = fetch, tools = null }) {
  const kind = providerKind(provider);
  if (kind === 'anthropic') return callAnthropic({ provider, messages, fetchImpl });
  if (kind === 'gemini') return callGemini({ provider, messages, fetchImpl });
  return callOpenAICompatible({ provider, messages, fetchImpl, tools });
}

async function streamProvider({ provider, messages, onToken, fetchImpl = fetch }) {
  const kind = providerKind(provider);
  if (kind === 'anthropic') {
    return streamAnthropic({ provider, messages, onToken, fetchImpl });
  }
  if (kind === 'gemini') {
    return streamGemini({ provider, messages, onToken, fetchImpl });
  }
  if (kind === 'openai-compatible') {
    return streamOpenAICompatible({ provider, messages, onToken, fetchImpl });
  }

  const result = await callProvider({ provider, messages, fetchImpl });
  for (const token of chunkText(result.content)) {
    await onToken?.(token);
  }
  return result;
}

function providerKind(provider) {
  const kind = String(provider?.kind || 'openai-compatible').toLowerCase();
  return ['openai-compatible', 'anthropic', 'gemini'].includes(kind) ? kind : 'openai-compatible';
}

function chunkText(text) {
  const value = String(text || '');
  const chunks = [];
  for (let index = 0; index < value.length; index += 16) {
    chunks.push(value.slice(index, index + 16));
  }
  return chunks;
}
