const DEFAULT_TIMEOUT_MS = 15_000;

export async function testProviderConnection({
  provider,
  providerClient,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = () => Date.now()
}) {
  if (!provider || typeof provider !== 'object' || Array.isArray(provider)) {
    throw new Error('PROVIDER_TEST_INVALID_CONFIG');
  }
  if (!providerClient?.complete) throw new Error('PROVIDER_TEST_CLIENT_UNAVAILABLE');

  const startedAt = now();
  const timeoutFetch = createTimeoutFetch(fetchImpl, timeoutMs);
  const result = await providerClient.complete({
    provider: {
      ...provider,
      temperature: 0,
      maxTokens: Math.min(16, Math.max(1, Number(provider.maxTokens || 8)))
    },
    messages: [{ role: 'user', content: 'Reply with OK only.' }],
    fetchImpl: timeoutFetch
  });

  return {
    ok: true,
    providerId: String(provider.id || ''),
    kind: String(provider.kind || 'openai-compatible'),
    model: String(provider.model || ''),
    latencyMs: Math.max(0, now() - startedAt),
    responsePreview: String(result?.content || '').trim().slice(0, 80),
    testedAt: new Date().toISOString()
  };
}

function createTimeoutFetch(fetchImpl, timeoutMs) {
  return async (url, init = {}) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('PROVIDER_TEST_TIMEOUT')), timeoutMs);
    timeout.unref?.();
    const parentSignal = init.signal;
    const handleParentAbort = () => controller.abort(parentSignal.reason);
    parentSignal?.addEventListener?.('abort', handleParentAbort, { once: true });
    try {
      return await fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted && !parentSignal?.aborted) throw new Error('PROVIDER_TEST_TIMEOUT');
      throw error;
    } finally {
      clearTimeout(timeout);
      parentSignal?.removeEventListener?.('abort', handleParentAbort);
    }
  };
}

export function sanitizeProviderTestError(error, provider) {
  let message = String(error?.message || 'Provider connection failed');
  const apiKey = String(provider?.apiKey || '');
  if (apiKey) message = message.split(apiKey).join('********');
  return message.replace(/[\r\n\t]+/g, ' ').slice(0, 320);
}
