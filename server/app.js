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

export function createApp({ rootDir }) {
  const appRoot = path.resolve(rootDir);
  const store = new JsonStore(path.join(appRoot, 'data'));
  const configService = new ConfigService(store);
  const sessionService = new SessionService(store);
  const providerClient = {
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
      writeJson(res, 500, { error: 'INTERNAL_ERROR', message: error.message });
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
    const body = await readJson(req);
    await configService.saveProviders(body);
    writeJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/prompt-modules') {
    const body = await readJson(req);
    const promptModules = await configService.savePromptModules(body.promptModules || []);
    writeJson(res, 200, { promptModules });
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/world-book') {
    const body = await readJson(req);
    const worldBook = await configService.saveWorldBook(body.worldBook || []);
    writeJson(res, 200, { worldBook });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/chat') {
    const body = await readJson(req);
    const result = await agentService.sendMessage({
      sessionId: body.sessionId || 'main',
      content: body.content
    });
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
        apiKey: provider.apiKey ? '********' : ''
      }))
    }
  };
}
