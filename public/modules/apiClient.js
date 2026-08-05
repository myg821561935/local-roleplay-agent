import { truncateText } from './utils.js';

export function parseJsonResponse(text) {
  const source = String(text ?? '');
  if (!source.trim()) return undefined;
  try {
    return JSON.parse(source);
  } catch {
    return undefined;
  }
}

export function isJsonResponse(response) {
  return (response?.headers?.get?.('content-type') || '')
    .toLowerCase()
    .includes('application/json');
}

export function formatHttpError(response, text) {
  const status = `${response?.status ?? ''} ${response?.statusText || ''}`.trim();
  const snippet = truncateText(String(text ?? '').trim(), 160);
  return snippet ? `${status}: ${snippet}` : status;
}

export function createHttpError(response, text, payload = parseJsonResponse(text)) {
  const message = payload?.detail
    || payload?.message
    || payload?.error
    || formatHttpError(response, text);
  const error = new Error(message);
  error.code = payload?.error;
  error.status = response?.status;
  return error;
}

export function createApiRequest({ fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('fetchImpl must be a function');
  }

  return async function apiRequest(path, options = {}) {
    const fetchOptions = {
      method: options.method || 'GET',
      headers: options.headers ? { ...options.headers } : {}
    };

    if (options.rawBody !== undefined) {
      fetchOptions.body = options.rawBody;
    } else if (options.body !== undefined) {
      fetchOptions.headers['content-type'] = 'application/json';
      fetchOptions.body = JSON.stringify(options.body);
    }

    const response = await fetchImpl(path, fetchOptions);
    const responseText = await response.text();
    const payload = isJsonResponse(response)
      ? parseJsonResponse(responseText)
      : undefined;

    if (!response.ok) {
      throw createHttpError(response, responseText, payload);
    }
    if (payload === undefined) {
      throw new Error(`接口返回的不是 JSON：${formatHttpError(response, responseText)}`);
    }
    return payload;
  };
}
