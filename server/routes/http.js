import { readJson } from '../lib/http.js';

const LOCAL_ORIGIN_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export class ApiError extends Error {
  constructor(statusCode, code, detail = '') {
    super(code);
    this.statusCode = statusCode;
    this.code = code;
    this.detail = String(detail || '');
  }
}

export async function readRequestJson(req) {
  try {
    return await readJson(req);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ApiError(400, 'INVALID_JSON');
    }
    throw error;
  }
}

export function validateMutatingRequest(req) {
  if (!isAllowedOrigin(req)) {
    throw new ApiError(403, 'FORBIDDEN_ORIGIN');
  }
  if (!isJsonRequest(req)) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE');
  }
}

export function isAllowedOrigin(req) {
  const origin = getHeader(req, 'origin');
  if (!origin) return true;

  try {
    const { hostname } = new URL(origin);
    return LOCAL_ORIGIN_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

export function getHeader(req, headerName) {
  const headers = req.headers || {};
  const lowerHeaderName = headerName.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerHeaderName) {
      return Array.isArray(value) ? String(value[0] || '') : String(value || '');
    }
  }
  return '';
}

function isJsonRequest(req) {
  const contentType = getHeader(req, 'content-type');
  return contentType.split(';', 1)[0].trim().toLowerCase() === 'application/json';
}
