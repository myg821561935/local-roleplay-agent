import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { JsonStore } from './lib/jsonStore.js';
import { readJson, writeJson } from './lib/http.js';
import { ConfigService } from './config/configService.js';
import { SessionService } from './services/sessionService.js';
import { AgentService } from './services/agentService.js';
import { callOpenAICompatible } from './provider/openaiCompatible.js';

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8']
]);

const MASKED_SECRET = '********';
const LOCAL_ORIGIN_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

class ApiError extends Error {
  constructor(statusCode, code) {
    super(code);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function createApp({ rootDir = process.cwd(), providerClient: providerClientOverride } = {}) {
  const appRoot = path.resolve(rootDir);
  const store = new JsonStore(path.join(appRoot, 'data'));
  const configService = new ConfigService(store);
  const sessionService = new SessionService(store);
  const providerClient = providerClientOverride || {
    complete: ({ provider, messages }) => callOpenAICompatible({ provider, messages })
  };
  const agentService = new AgentService({ configService, sessionService, providerClient });

  return async function app(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        await handleApi({ req, res, url, configService, sessionService, agentService });
        return;
      }

      await serveStatic({ rootDir: appRoot, pathname: url.pathname, res });
    } catch (error) {
      writeApiError(res, error);
    }
  };
}

async function handleApi({ req, res, url, configService, sessionService, agentService }) {
  if (req.method === 'GET' && url.pathname === '/api/health') {
    writeJson(res, 200, { ok: true, app: 'local-roleplay-agent' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/state') {
    const [config, session] = await Promise.all([
      configService.getAll(),
      sessionService.getSession('main')
    ]);
    writeJson(res, 200, { config: maskConfig(config), session });
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/providers') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const providers = await resolveProviderSecrets({ configService, incoming: body });
    await configService.saveProviders(providers);
    writeJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/prompt-modules') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const promptModules = await configService.savePromptModules(body.promptModules || []);
    writeJson(res, 200, { promptModules });
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/world-book') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const worldBook = await configService.saveWorldBook(body.worldBook || []);
    writeJson(res, 200, { worldBook });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/chat') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const result = await sendChat({ agentService, body });
    writeJson(res, 200, result);
    return;
  }

  writeJson(res, 404, { error: 'NOT_FOUND' });
}

async function serveStatic({ rootDir, pathname, res }) {
  const publicDir = path.resolve(rootDir, 'public');
  const staticPathname = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(publicDir, `.${staticPathname}`);

  if (!isPathInside(filePath, publicDir)) {
    writeJson(res, 404, { error: 'NOT_FOUND' });
    return;
  }

  try {
    const body = await readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'content-type': contentTypes.get(ext) || 'application/octet-stream' });
    res.end(body);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') {
      writeJson(res, 404, { error: 'NOT_FOUND' });
      return;
    }
    throw error;
  }
}

function isPathInside(filePath, parentDir) {
  const relative = path.relative(parentDir, filePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function maskConfig(config) {
  return {
    ...config,
    providers: {
      ...config.providers,
      providers: (config.providers.providers || []).map((provider) => ({
        ...provider,
        apiKey: provider.apiKey ? MASKED_SECRET : ''
      }))
    }
  };
}

async function resolveProviderSecrets({ configService, incoming }) {
  const config = await configService.getAll();
  const existingProviders = new Map(
    (config.providers.providers || []).map((provider) => [String(provider.id || ''), provider])
  );
  const providers = Array.isArray(incoming.providers) ? incoming.providers.map((provider) => {
    if (provider?.apiKey !== MASKED_SECRET) return provider;
    const existingProvider = existingProviders.get(String(provider.id || ''));
    return {
      ...provider,
      apiKey: existingProvider?.apiKey || ''
    };
  }) : incoming.providers;

  return { ...incoming, providers };
}

async function sendChat({ agentService, body }) {
  try {
    return await agentService.sendMessage({
      sessionId: body.sessionId || 'main',
      content: body.content
    });
  } catch (error) {
    if (error.message === 'NO_ACTIVE_PROVIDER') {
      throw new ApiError(409, 'NO_ACTIVE_PROVIDER');
    }
    throw new ApiError(502, 'PROVIDER_ERROR');
  }
}

async function readRequestJson(req) {
  try {
    return await readJson(req);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ApiError(400, 'INVALID_JSON');
    }
    throw error;
  }
}

function validateMutatingRequest(req) {
  if (!isAllowedOrigin(req)) {
    throw new ApiError(403, 'FORBIDDEN_ORIGIN');
  }
  if (!isJsonRequest(req)) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE');
  }
}

function isJsonRequest(req) {
  const contentType = getHeader(req, 'content-type');
  return contentType.split(';', 1)[0].trim().toLowerCase() === 'application/json';
}

function isAllowedOrigin(req) {
  const origin = getHeader(req, 'origin');
  if (!origin) return true;

  try {
    const { hostname } = new URL(origin);
    return LOCAL_ORIGIN_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

function getHeader(req, headerName) {
  const headers = req.headers || {};
  const lowerHeaderName = headerName.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerHeaderName) {
      return Array.isArray(value) ? String(value[0] || '') : String(value || '');
    }
  }
  return '';
}

function writeApiError(res, error) {
  if (error instanceof ApiError) {
    writeJson(res, error.statusCode, { error: error.code });
    return;
  }
  writeJson(res, 500, { error: 'INTERNAL_ERROR' });
}
