import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { JsonStore } from './lib/jsonStore.js';
import { readJson, writeJson } from './lib/http.js';
import { ConfigService } from './config/configService.js';
import { SessionService } from './services/sessionService.js';
import { AgentService } from './services/agentService.js';
import { callOpenAICompatible, streamOpenAICompatible } from './provider/openaiCompatible.js';
import { importCharacterCardFromPayload } from './character/characterCardImport.js';
import { createWorldBookEntryFromFact, normalizeFactCards, worldBookIdentity } from './agent/factCards.js';

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8']
]);

const MASKED_SECRET = '********';
const LOCAL_ORIGIN_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const SENSITIVE_HEADER_PATTERNS = [
  'authorization',
  'api-key',
  'apikey',
  'token',
  'secret',
  'credential',
  'auth'
];

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
    complete: ({ provider, messages }) => callOpenAICompatible({ provider, messages }),
    stream: ({ provider, messages, onToken }) => streamOpenAICompatible({ provider, messages, onToken })
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
    const promptModulePayload = body.promptModules ?? [];
    if (!Array.isArray(promptModulePayload)) {
      throw new ApiError(400, 'INVALID_PROMPT_MODULES');
    }
    const promptModules = await configService.savePromptModules(promptModulePayload);
    writeJson(res, 200, { promptModules });
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/world-book') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const worldBookPayload = body.worldBook ?? [];
    if (!Array.isArray(worldBookPayload)) {
      throw new ApiError(400, 'INVALID_WORLD_BOOK');
    }
    const worldBook = await configService.saveWorldBook(worldBookPayload);
    writeJson(res, 200, { worldBook });
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/memory/facts') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const result = await saveMemoryFacts({ sessionService, body });
    writeJson(res, 200, result);
    return;
  }

  const memoryFactPromoteRoute = matchMemoryFactPromoteRoute(url.pathname);
  if (memoryFactPromoteRoute && req.method === 'POST') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const result = await promoteMemoryFact({
      configService,
      sessionService,
      body,
      factId: memoryFactPromoteRoute.factId
    });
    writeJson(res, 200, result);
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/character-card') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const characterCardPayload = body.characterCard ?? {};
    if (!isPlainObject(characterCardPayload)) {
      throw new ApiError(400, 'INVALID_CHARACTER_CARD');
    }
    const characterCard = await configService.saveCharacterCard(characterCardPayload);
    writeJson(res, 200, { characterCard });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/character-card/import') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const imported = importCharacterCardFromPayload(body);
    const result = await configService.importCharacterCard(imported);
    writeJson(res, 200, result);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/chat') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const result = await sendChat({ agentService, body });
    writeJson(res, 200, result);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/chat/stream') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    await streamChat({ agentService, body, res });
    return;
  }

  const messageRoute = matchMessageRoute(url.pathname);
  if (messageRoute && req.method === 'PATCH' && messageRoute.action === 'edit') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const result = await editMessage({ agentService, body, messageId: messageRoute.messageId });
    writeJson(res, 200, result);
    return;
  }

  if (messageRoute && req.method === 'POST' && messageRoute.action === 'regenerate') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const result = await regenerateMessage({ agentService, body, messageId: messageRoute.messageId });
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
        apiKey: provider.apiKey ? MASKED_SECRET : '',
        headers: maskHeaders(provider.headers)
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
    const existingProvider = existingProviders.get(String(provider.id || ''));
    if (provider?.apiKey !== MASKED_SECRET) {
      return {
        ...provider,
        headers: resolveMaskedHeaders(provider.headers, existingProvider?.headers)
      };
    }
    return {
      ...provider,
      apiKey: existingProvider?.apiKey || '',
      headers: resolveMaskedHeaders(provider.headers, existingProvider?.headers)
    };
  }) : incoming.providers;

  return { ...incoming, providers };
}

function maskHeaders(headers) {
  if (!isPlainObject(headers)) return {};

  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [
    name,
    isSensitiveHeaderName(name) && value ? MASKED_SECRET : value
  ]));
}

function resolveMaskedHeaders(incomingHeaders, existingHeaders) {
  if (!isPlainObject(incomingHeaders)) return incomingHeaders;

  const existingHeadersByLowerName = isPlainObject(existingHeaders)
    ? new Map(Object.entries(existingHeaders).map(([name, value]) => [name.toLowerCase(), value]))
    : new Map();

  return Object.fromEntries(Object.entries(incomingHeaders).map(([name, value]) => {
    if (value === MASKED_SECRET && isSensitiveHeaderName(name)) {
      return [name, existingHeadersByLowerName.get(name.toLowerCase()) || ''];
    }
    return [name, value];
  }));
}

function isSensitiveHeaderName(name) {
  const lowerName = String(name || '').toLowerCase();
  return SENSITIVE_HEADER_PATTERNS.some((pattern) => lowerName.includes(pattern));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

async function streamChat({ agentService, body, res }) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive'
  });

  try {
    const result = await agentService.sendMessageStream({
      sessionId: body.sessionId || 'main',
      content: body.content,
      onToken: async (content) => writeSse(res, 'token', { content })
    });
    writeSse(res, 'done', result);
  } catch (error) {
    const code = error.message === 'NO_ACTIVE_PROVIDER' ? 'NO_ACTIVE_PROVIDER' : 'PROVIDER_ERROR';
    writeSse(res, 'error', { error: code });
  } finally {
    res.end();
  }
}

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function editMessage({ agentService, body, messageId }) {
  try {
    return await agentService.editMessage({
      sessionId: body.sessionId || 'main',
      messageId,
      content: body.content
    });
  } catch (error) {
    if (error.message === 'NO_ACTIVE_PROVIDER') throw new ApiError(409, 'NO_ACTIVE_PROVIDER');
    if (error.message === 'MESSAGE_NOT_FOUND') throw new ApiError(404, 'MESSAGE_NOT_FOUND');
    throw new ApiError(502, 'PROVIDER_ERROR');
  }
}

async function regenerateMessage({ agentService, body, messageId }) {
  try {
    return await agentService.regenerateAssistantMessage({
      sessionId: body.sessionId || 'main',
      messageId
    });
  } catch (error) {
    if (error.message === 'NO_ACTIVE_PROVIDER') throw new ApiError(409, 'NO_ACTIVE_PROVIDER');
    if (error.message === 'MESSAGE_NOT_FOUND') throw new ApiError(404, 'MESSAGE_NOT_FOUND');
    if (error.message === 'MESSAGE_NOT_ASSISTANT') throw new ApiError(400, 'MESSAGE_NOT_ASSISTANT');
    throw new ApiError(502, 'PROVIDER_ERROR');
  }
}

async function saveMemoryFacts({ sessionService, body }) {
  const factsPayload = body.facts ?? [];
  if (!Array.isArray(factsPayload)) throw new ApiError(400, 'INVALID_MEMORY_FACTS');
  const session = await getApiSession(sessionService, body.sessionId || 'main');
  const facts = normalizeFactCards(factsPayload);
  session.memory = {
    ...session.memory,
    memoryCards: facts
  };
  session.updatedAt = new Date().toISOString();
  await sessionService.saveSession(session);
  return { facts, session };
}

async function promoteMemoryFact({ configService, sessionService, body, factId }) {
  const session = await getApiSession(sessionService, body.sessionId || 'main');
  const facts = normalizeFactCards(session.memory?.memoryCards || []);
  const fact = facts.find((item) => item.id === factId);
  if (!fact) throw new ApiError(404, 'MEMORY_FACT_NOT_FOUND');

  const nextEntry = createWorldBookEntryFromFact(fact);
  const config = await configService.getAll();
  const existingWorldBook = Array.isArray(config.worldBook) ? config.worldBook : [];
  const existingKeys = new Set(existingWorldBook.map(worldBookIdentity));
  const nextWorldBook = existingKeys.has(worldBookIdentity(nextEntry))
    ? existingWorldBook
    : await configService.saveWorldBook([...existingWorldBook, nextEntry]);

  return { fact, worldBook: nextWorldBook };
}

async function getApiSession(sessionService, sessionId) {
  try {
    return await sessionService.getSession(sessionId);
  } catch (error) {
    if (error.message === 'Invalid session id') throw new ApiError(400, 'INVALID_SESSION_ID');
    throw error;
  }
}

function matchMessageRoute(pathname) {
  const editMatch = pathname.match(/^\/api\/messages\/([^/]+)$/);
  if (editMatch) return { action: 'edit', messageId: decodeURIComponent(editMatch[1]) };
  const regenerateMatch = pathname.match(/^\/api\/messages\/([^/]+)\/regenerate$/);
  if (regenerateMatch) return { action: 'regenerate', messageId: decodeURIComponent(regenerateMatch[1]) };
  return null;
}

function matchMemoryFactPromoteRoute(pathname) {
  const match = pathname.match(/^\/api\/memory\/facts\/([^/]+)\/promote$/);
  if (!match) return null;
  return { factId: decodeURIComponent(match[1]) };
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
