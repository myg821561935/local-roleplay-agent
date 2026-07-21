import { readFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { JsonStore } from './lib/jsonStore.js';
import { readJson, writeJson } from './lib/http.js';
import { ConfigService } from './config/configService.js';
import { SessionService } from './services/sessionService.js';
import { AgentService } from './services/agentService.js';
import { AssetService } from './services/assetService.js';
import { ImportSourceError, ImportSourceService, listImportSources } from './services/importSourceService.js';
import { summarizeAllUsage, summarizeSessionUsage } from './services/usageService.js';
import { buildProviderClient } from './provider/providerRegistry.js';
import { importCharacterCardFromPayload } from './character/characterCardImport.js';
import { exportCharacterCardPng } from './character/characterCardExport.js';
import { previewImportPayload } from './character/importPreview.js';
import { createWorldBookEntryFromFact, normalizeFactCards, worldBookIdentity } from './agent/factCards.js';
import { retrieveCards } from './agent/memoryRetriever.js';
import { expandMacros } from './agent/macroEngine.js';
import { getContentPack, getRuleSystemForGenre, listContentPackCharacters, listContentPackSummaries } from './config/contentPacks.js';
import { McpRegistry } from './mcp/mcpRegistry.js';
import { StdioMcpClient } from './mcp/stdioTransport.js';
import { BackupError, BackupService } from './services/backupService.js';
import { readDataSchemaStatus } from './data/migrations.js';
import { APP_NAME, APP_VERSION, DATA_SCHEMA_VERSION, RELEASE_CHANNEL } from './releaseInfo.js';
import { sanitizeProviderTestError, testProviderConnection } from './services/providerTestService.js';
import { ResourceLibraryService } from './services/resourceLibraryService.js';
import { WorldSimulationService } from './services/worldSimulationService.js';
import { StoryProjectService, summarizeStoryProject } from './services/storyProjectService.js';
import { AuthoringService } from './services/authoringService.js';
import { listAgentProfiles, normalizeAgentProfileId } from './authoring/agentProfiles.js';

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png']
]);

const MASKED_SECRET = '********';
const PROVIDER_TASK_KEYS = new Set(['chat', 'rewrite', 'fact', 'summary']);
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
  constructor(statusCode, code, detail = '') {
    super(code);
    this.statusCode = statusCode;
    this.code = code;
    this.detail = String(detail || '');
  }
}

export function createApp({ rootDir = process.cwd(), providerClient: providerClientOverride, fetchImpl } = {}) {
  const appRoot = path.resolve(rootDir);
  const store = new JsonStore(path.join(appRoot, 'data'));
  const configService = new ConfigService(store);
  const sessionService = new SessionService(store);
  const storyProjectService = new StoryProjectService(store);
  const authoringService = new AuthoringService({ sessionService });
  const assetService = new AssetService(store);
  const resourceLibraryService = new ResourceLibraryService(store, {
    appVersion: APP_VERSION,
    resolveBuiltInPack: getContentPack,
    listBuiltInPacks: listContentPackSummaries
  });
  const importSourceService = new ImportSourceService({ fetchImpl });
  const providerClient = providerClientOverride || buildProviderClient();
  const worldSimulationService = new WorldSimulationService({
    sessionService,
    resolveCharacterPresets: (packId) => getContentPack(packId)?.characterPresets || []
  });
  const agentService = new AgentService({
    configService,
    sessionService,
    providerClient,
    worldSimulationService
  });
  const backupService = new BackupService({ rootDir: appRoot });
  const mcpRegistry = new McpRegistry({
    transportFactory: async (config) => {
      if (config.transport === 'stdio') {
        const client = new StdioMcpClient({
          command: config.command,
          args: config.args,
          env: config.env
        });
        await client.connect();
        return client;
      }
      throw new Error(`Unsupported MCP transport: ${config.transport}`);
    }
  });
  // 启动时加载已保存的 MCP server 配置（不自动连接，由 API 触发）
  configService.getAll().then((config) => {
    const servers = Array.isArray(config.mcpServers) ? config.mcpServers : [];
    servers.forEach((server) => {
      try { mcpRegistry.upsertConfig(server); } catch {}
    });
  }).catch(() => {});

  return async function app(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        await handleApi({
          req,
          res,
          url,
          appRoot,
          configService,
          sessionService,
          storyProjectService,
          authoringService,
          agentService,
          worldSimulationService,
          assetService,
          resourceLibraryService,
          importSourceService,
          mcpRegistry,
          backupService,
          providerClient,
          fetchImpl: fetchImpl || globalThis.fetch
        });
        return;
      }

      await serveStatic({ rootDir: appRoot, pathname: url.pathname, res });
    } catch (error) {
      writeApiError(res, error);
    }
  };
}

async function handleApi({ req, res, url, appRoot, configService, sessionService, storyProjectService, authoringService, agentService, worldSimulationService, assetService, resourceLibraryService, importSourceService, mcpRegistry, backupService, providerClient, fetchImpl }) {
  if (req.method === 'GET' && url.pathname === '/api/health') {
    const dataSchema = await readDataSchemaStatus(appRoot);
    writeJson(res, 200, {
      ok: dataSchema.ready,
      app: APP_NAME,
      version: APP_VERSION,
      releaseChannel: RELEASE_CHANNEL,
      dataSchemaVersion: dataSchema.currentVersion,
      targetDataSchemaVersion: DATA_SCHEMA_VERSION
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/backups') {
    if (!isAllowedOrigin(req)) throw new ApiError(403, 'FORBIDDEN_ORIGIN');
    writeJson(res, 200, await backupService.listBackups());
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/backups') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const backup = await backupService.createBackup({ reason: body.reason || 'manual' });
    writeJson(res, 200, { backup });
    return;
  }

  const backupDownloadRoute = url.pathname.match(/^\/api\/backups\/([^/]+)\/download$/);
  if (backupDownloadRoute && req.method === 'GET') {
    if (!isAllowedOrigin(req)) throw new ApiError(403, 'FORBIDDEN_ORIGIN');
    const backupId = decodeURIComponent(backupDownloadRoute[1]);
    const file = await backupService.getBackupFile(backupId);
    const body = await readFile(file.filePath);
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${file.fileName}"`,
      'cache-control': 'no-store'
    });
    res.end(body);
    return;
  }

  const backupRestoreRoute = url.pathname.match(/^\/api\/backups\/([^/]+)\/restore$/);
  if (backupRestoreRoute && req.method === 'POST') {
    validateMutatingRequest(req);
    await readRequestJson(req);
    const backupId = decodeURIComponent(backupRestoreRoute[1]);
    const result = await backupService.restoreBackup(backupId);
    writeJson(res, 200, result);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/proxy-image') {
    if (!isAllowedOrigin(req)) {
      throw new ApiError(403, 'FORBIDDEN_ORIGIN');
    }
    const targetUrl = url.searchParams.get('url');
    const parsedTarget = parseProxyImageUrl(targetUrl);
    const proxyResponse = await fetchImpl(parsedTarget.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': `${parsedTarget.protocol}//${parsedTarget.host}/`
      }
    });
    if (!proxyResponse.ok) {
      throw new ApiError(proxyResponse.status, 'PROXY_FAILED');
    }
    const contentType = proxyResponse.headers.get('content-type') || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400'
    });
    const arrayBuffer = await proxyResponse.arrayBuffer();
    res.end(Buffer.from(arrayBuffer));
    return;
  }

  const characterImageRoute = url.pathname.match(/^\/api\/character-images\/([a-f0-9]{64})\.png$/);
  if (characterImageRoute && req.method === 'GET') {
    const image = await assetService.readCharacterPortrait(characterImageRoute[1]);
    if (!image) throw new ApiError(404, 'CHARACTER_IMAGE_NOT_FOUND');
    res.writeHead(200, {
      'content-type': 'image/png',
      'content-length': image.length,
      'cache-control': 'public, max-age=31536000, immutable'
    });
    res.end(image);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/state') {
    const sessionId = url.searchParams.get('sessionId') || 'main';
    const [globalConfig, session] = await Promise.all([
      configService.getAll(),
      getApiSession(sessionService, sessionId)
    ]);
    writeJson(res, 200, { config: maskConfig(buildSessionScopedConfig(globalConfig, session)), session: withRuleSystem(session) });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/assets') {
    const assets = await assetService.listAssets();
    writeJson(res, 200, { assets });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/resource-library/adapters') {
    writeJson(res, 200, { adapters: await resourceLibraryService.listAdapters() });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/plugins') {
    const plugins = await resourceLibraryService.listPlugins();
    writeJson(res, 200, {
      plugins,
      summary: {
        total: plugins.length,
        core: plugins.filter((item) => item.origin === 'core').length,
        local: plugins.filter((item) => item.origin === 'local').length,
        incompatible: plugins.filter((item) => !item.compatible).length
      }
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/plugins/inspect') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    writeJson(res, 200, { inspection: await resourceLibraryService.pluginRegistry.inspectManifest(body.manifest || body) });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/plugins') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    try {
      writeJson(res, 200, await resourceLibraryService.installPluginManifest(body.manifest || body));
    } catch (error) {
      throw new ApiError(422, 'PLUGIN_MANIFEST_INVALID', error.message);
    }
    return;
  }

  const pluginRoute = matchPluginRoute(url.pathname);
  if (pluginRoute && req.method === 'PATCH') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    try {
      const plugin = await resourceLibraryService.setPluginEnabled(pluginRoute.pluginId, body.enabled === true);
      if (!plugin) throw new ApiError(404, 'PLUGIN_NOT_FOUND');
      writeJson(res, 200, { plugin });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error.message === 'CORE_PLUGIN_IMMUTABLE') throw new ApiError(409, 'CORE_PLUGIN_IMMUTABLE');
      throw error;
    }
    return;
  }

  if (pluginRoute && req.method === 'DELETE') {
    validateMutatingRequest(req);
    const removed = await resourceLibraryService.removePlugin(pluginRoute.pluginId);
    if (!removed) throw new ApiError(404, 'PLUGIN_NOT_FOUND');
    writeJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/resource-library/resources') {
    const resources = await resourceLibraryService.listResources({
      kind: url.searchParams.get('kind') || '',
      query: url.searchParams.get('q') || ''
    });
    writeJson(res, 200, { resources });
    return;
  }

  if (req.method === 'PATCH' && url.pathname === '/api/resource-library/resources') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.resourceIds)) {
      throw new ApiError(400, 'RESOURCE_BATCH_METADATA_INVALID');
    }
    const result = await resourceLibraryService.updateResourcesMetadata(body.resourceIds, body);
    writeJson(res, 200, result);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/resource-library/resources/export') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.resourceIds)) {
      throw new ApiError(400, 'RESOURCE_EXPORT_INVALID');
    }
    writeJson(res, 200, { bundle: await resourceLibraryService.exportResourceBundle(body.resourceIds) });
    return;
  }

  if (req.method === 'DELETE' && url.pathname === '/api/resource-library/resources') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.resourceIds)) {
      throw new ApiError(400, 'RESOURCE_BATCH_DELETE_INVALID');
    }
    writeJson(res, 200, await resourceLibraryService.removeResources(body.resourceIds));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/resource-library/packs') {
    writeJson(res, 200, { packs: await resourceLibraryService.listPacks() });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/resource-library/resources/prompt') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    try {
      const result = await resourceLibraryService.savePromptResource(body);
      writeJson(res, 200, result);
    } catch (error) {
      throw new ApiError(400, 'RESOURCE_PROMPT_INVALID', error.message);
    }
    return;
  }

  const resourceRoute = matchResourceLibraryResourceRoute(url.pathname);
  if (resourceRoute && req.method === 'PATCH') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new ApiError(400, 'RESOURCE_METADATA_INVALID');
    }
    const resource = await resourceLibraryService.updateResourceMetadata(resourceRoute.resourceId, body);
    if (!resource) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
    writeJson(res, 200, { resource });
    return;
  }

  if (resourceRoute && req.method === 'DELETE') {
    validateMutatingRequest(req);
    const removed = await resourceLibraryService.removeResource(resourceRoute.resourceId);
    if (!removed) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
    writeJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/resource-library/packs/inspect') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const basePack = body.basePackId
      ? await resolveContentPack(resourceLibraryService, body.basePackId)
      : null;
    if (body.basePackId && !basePack) throw new ApiError(404, 'CONTENT_PACK_NOT_FOUND');
    try {
      const composition = await resourceLibraryService.inspectPackComposition(body, { basePack });
      writeJson(res, 200, { composition });
    } catch (error) {
      if (String(error.message || '').startsWith('RESOURCE_NOT_FOUND:')) {
        throw new ApiError(404, 'RESOURCE_NOT_FOUND', error.message.split(':').slice(1).join(':'));
      }
      throw new ApiError(400, 'RESOURCE_PACK_INVALID', error.message);
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/resource-library/packs') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const basePack = body.basePackId
      ? await resolveContentPack(resourceLibraryService, body.basePackId)
      : null;
    if (body.basePackId && !basePack) throw new ApiError(404, 'CONTENT_PACK_NOT_FOUND');
    try {
      const pack = await resourceLibraryService.createPack(body, { basePack });
      writeJson(res, 200, { pack, summary: summarizeResolvedPack(pack) });
    } catch (error) {
      if (String(error.message || '').startsWith('RESOURCE_NOT_FOUND:')) {
        throw new ApiError(404, 'RESOURCE_NOT_FOUND', error.message.split(':').slice(1).join(':'));
      }
      throw new ApiError(400, 'RESOURCE_PACK_INVALID', error.message);
    }
    return;
  }

  const customPackDeleteRoute = matchCustomPackDeleteRoute(url.pathname);
  if (customPackDeleteRoute && req.method === 'DELETE') {
    validateMutatingRequest(req);
    const removed = await resourceLibraryService.removePack(customPackDeleteRoute.packId);
    if (!removed) throw new ApiError(404, 'CONTENT_PACK_NOT_FOUND');
    writeJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/sessions') {
    const [sessions, sessionSummaries] = await Promise.all([
      sessionService.listSessions(),
      sessionService.listSessionSummaries()
    ]);
    writeJson(res, 200, { sessions, sessionSummaries });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/agent-profiles') {
    writeJson(res, 200, { profiles: listAgentProfiles() });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/story-projects') {
    const projects = await storyProjectService.listProjects();
    writeJson(res, 200, { projects: projects.map(summarizeStoryProject) });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/story-projects') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const pack = await resolveContentPack(resourceLibraryService, body.basePackId);
    if (!pack) throw new ApiError(404, 'CONTENT_PACK_NOT_FOUND');
    const project = await storyProjectService.createProject({
      title: body.title || pack.sessionTitle || pack.title,
      description: body.description || pack.description,
      basePackId: pack.id,
      basePackTitle: pack.title,
      basePackVersion: pack.manifest?.version || pack.version || '1.0.0',
      visualPackId: pack.visualPackId || pack.resourceManifest?.basePackId || pack.id,
      bindings: buildStoryProjectBindings(pack),
      runtimePolicy: body.runtimePolicy
    });
    writeJson(res, 200, { project, summary: summarizeStoryProject(project) });
    return;
  }

  const storyProjectRoute = url.pathname.match(/^\/api\/story-projects\/([^/]+)$/);
  if (storyProjectRoute && req.method === 'GET') {
    const project = await storyProjectService.getProject(decodeURIComponent(storyProjectRoute[1]));
    if (!project) throw new ApiError(404, 'STORY_PROJECT_NOT_FOUND');
    writeJson(res, 200, { project });
    return;
  }

  const storyProjectSessionRoute = url.pathname.match(/^\/api\/story-projects\/([^/]+)\/sessions$/);
  if (storyProjectSessionRoute && req.method === 'POST') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const projectId = decodeURIComponent(storyProjectSessionRoute[1]);
    const project = await storyProjectService.getProject(projectId);
    if (!project) throw new ApiError(404, 'STORY_PROJECT_NOT_FOUND');
    const pack = await resolveContentPack(resourceLibraryService, project.basePackId);
    if (!pack) throw new ApiError(404, 'CONTENT_PACK_NOT_FOUND');
    const session = await createSessionFromContentPack({
      sessionService,
      worldSimulationService,
      pack,
      body,
      project
    });
    const updatedProject = await storyProjectService.attachSession(project.id, session.id);
    writeJson(res, 200, {
      session,
      project: updatedProject,
      visualPackId: project.visualPackId || pack.visualPackId || pack.id
    });
    return;
  }

  const authoringRoute = url.pathname.match(/^\/api\/sessions\/([^/]+)\/authoring$/);
  if (authoringRoute && req.method === 'GET') {
    const sessionId = decodeURIComponent(authoringRoute[1]);
    writeJson(res, 200, await authoringService.getBySession(sessionId));
    return;
  }

  if (authoringRoute && req.method === 'PUT') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const sessionId = decodeURIComponent(authoringRoute[1]);
    writeJson(res, 200, await authoringService.saveBySession(sessionId, body));
    return;
  }

  const simulationRoute = url.pathname.match(/^\/api\/sessions\/([^/]+)\/simulation$/);
  if (simulationRoute && req.method === 'GET') {
    const sessionId = decodeURIComponent(simulationRoute[1]);
    const director = url.searchParams.get('view') !== 'public';
    writeJson(res, 200, {
      snapshot: await worldSimulationService.getSnapshot(sessionId, { director })
    });
    return;
  }

  const eventLedgerRoute = url.pathname.match(/^\/api\/sessions\/([^/]+)\/events$/);
  if (eventLedgerRoute && req.method === 'GET') {
    const sessionId = decodeURIComponent(eventLedgerRoute[1]);
    const director = url.searchParams.get('view') !== 'public';
    const limit = clampApiInteger(url.searchParams.get('limit'), 1, 1000, 200);
    writeJson(res, 200, await worldSimulationService.listEvents(sessionId, { director, limit }));
    return;
  }

  const actionPreviewRoute = url.pathname.match(/^\/api\/sessions\/([^/]+)\/actions\/preview$/);
  if (actionPreviewRoute && req.method === 'POST') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const sessionId = decodeURIComponent(actionPreviewRoute[1]);
    writeJson(res, 200, await callSimulationApi(() => worldSimulationService.previewActions(
      sessionId,
      body.envelope ?? body.actions ?? body,
      { director: body.view !== 'public' }
    )));
    return;
  }

  const actionCommitRoute = url.pathname.match(/^\/api\/sessions\/([^/]+)\/actions\/commit$/);
  if (actionCommitRoute && req.method === 'POST') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const sessionId = decodeURIComponent(actionCommitRoute[1]);
    writeJson(res, 200, await callSimulationApi(() => worldSimulationService.commitActions(
      sessionId,
      body.envelope ?? body.actions ?? body,
      {
        actor: String(body.actor || 'creator'),
        kind: String(body.kind || 'manual-action'),
        director: body.view !== 'public'
      }
    )));
    return;
  }

  const actorRegistryRoute = url.pathname.match(/^\/api\/sessions\/([^/]+)\/simulation\/actors$/);
  if (actorRegistryRoute && req.method === 'PUT') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    if (!Array.isArray(body.actors)) throw new ApiError(400, 'SIMULATION_ACTORS_INVALID');
    const sessionId = decodeURIComponent(actorRegistryRoute[1]);
    writeJson(res, 200, {
      snapshot: await callSimulationApi(() => worldSimulationService.saveActors(
        sessionId,
        body.actors,
        { director: body.view !== 'public' }
      ))
    });
    return;
  }

  const simulationAdvanceRoute = url.pathname.match(/^\/api\/sessions\/([^/]+)\/simulation\/advance$/);
  if (simulationAdvanceRoute && req.method === 'POST') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const sessionId = decodeURIComponent(simulationAdvanceRoute[1]);
    const minutes = clampApiInteger(body.minutes, 1, 525600, 60);
    writeJson(res, 200, await callSimulationApi(() => worldSimulationService.advance(sessionId, {
      minutes,
      reason: String(body.reason || '创作者推进时间'),
      director: body.view !== 'public'
    })));
    return;
  }

  const exportMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/export$/);
  if (exportMatch && req.method === 'GET') {
    const sessionId = decodeURIComponent(exportMatch[1]);
    const format = url.searchParams.get('format') || 'json';
    const session = await getApiSession(sessionService, sessionId);
    if (format === 'json') {
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="${encodeURIComponent(sessionId)}.json"`
      });
      res.end(JSON.stringify(session, null, 2));
      return;
    }
    const text = formatSessionAsText(session, format === 'md');
    res.writeHead(200, {
      'content-type': 'text/plain; charset=utf-8',
      'content-disposition': `attachment; filename="${encodeURIComponent(sessionId)}.${format === 'md' ? 'md' : 'txt'}"`
    });
    res.end(text);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/usage') {
    const usage = await getUsageSummary({
      sessionService,
      scope: url.searchParams.get('scope') || 'session',
      sessionId: url.searchParams.get('sessionId') || 'main'
    });
    writeJson(res, 200, { usage });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/sessions') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);

    let config = { characterCard: {}, worldBook: [], promptModules: [] };
    let selectedPack;
    let project;

    if (body.projectId) {
      project = await storyProjectService.getProject(body.projectId);
      if (!project) throw new ApiError(404, 'STORY_PROJECT_NOT_FOUND');
      selectedPack = await resolveContentPack(resourceLibraryService, project.basePackId);
      if (!selectedPack) throw new ApiError(404, 'CONTENT_PACK_NOT_FOUND');
    } else if (body.packId) {
      selectedPack = await resolveContentPack(resourceLibraryService, body.packId);
      if (!selectedPack) throw new ApiError(404, 'CONTENT_PACK_NOT_FOUND');
    }

    if (selectedPack) {
      const session = await createSessionFromContentPack({
        sessionService,
        worldSimulationService,
        pack: selectedPack,
        body,
        project
      });
      if (project) await storyProjectService.attachSession(project.id, session.id);
      writeJson(res, 200, { session });
      return;
    } else {
      const assets = await assetService.listAssets();
      const char = assets.characters.find(c => c.id === body.characterCardId);
      if (char) config.characterCard = char;

      const wbs = assets.worldBooks.filter(wb => (body.worldBookIds || []).includes(wb.id));
      config.worldBook = wbs.flatMap(wb => wb.entries || []);

      const prompts = assets.promptModules.filter(p => (body.promptModuleIds || []).includes(p.id));
      config.promptModules = prompts;
    }

    const session = await sessionService.createSessionWithConfig({
      id: body.id,
      title: body.title || '新的故事',
      config
    });
    worldSimulationService.prepareSession(session, {
      characterCard: config.characterCard,
      characterPresets: []
    });
    await sessionService.saveSession(session);

    writeJson(res, 200, { session });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/sessions/import') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const session = await importSession({ sessionService, body });
    writeJson(res, 200, { session });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/content-packs') {
    const customPacks = await resourceLibraryService.listPacks();
    writeJson(res, 200, { contentPacks: [...listContentPackSummaries(), ...customPacks] });
    return;
  }

  const contentPackExportRoute = matchContentPackExportRoute(url.pathname);
  if (contentPackExportRoute && req.method === 'GET') {
    const bundle = await resourceLibraryService.exportPackBundle(contentPackExportRoute.packId);
    if (!bundle) throw new ApiError(404, 'CONTENT_PACK_NOT_FOUND');
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${encodeURIComponent(bundle.manifest.id)}-${bundle.manifest.version}.json"`,
      'cache-control': 'no-store'
    });
    res.end(`${JSON.stringify(bundle, null, 2)}\n`);
    return;
  }

  const contentPackCharactersRoute = matchContentPackCharactersRoute(url.pathname);
  if (contentPackCharactersRoute && req.method === 'GET') {
    let characterPresets = listContentPackCharacters(contentPackCharactersRoute.packId);
    if (!characterPresets) {
      const pack = await resourceLibraryService.getPack(contentPackCharactersRoute.packId);
      if (pack) {
        characterPresets = [{
          id: `${pack.id}_default_character`,
          name: pack.characterCard?.name || '未命名角色',
          role: pack.characterCard?.role || '',
          characterCard: pack.characterCard
        }];
      }
    }
    if (!characterPresets) throw new ApiError(404, 'CONTENT_PACK_NOT_FOUND');
    writeJson(res, 200, { characterPresets });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/import-sources') {
    writeJson(res, 200, { sources: listImportSources() });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/import-sources/search') {
    const result = await importSourceService.search({
      source: url.searchParams.get('source') || 'chub',
      query: url.searchParams.get('q') || url.searchParams.get('query') || '',
      kind: url.searchParams.get('kind') || 'characters',
      limit: url.searchParams.get('limit') || undefined
    });
    writeJson(res, 200, result);
    return;
  }

  const contentPackApplyRoute = matchContentPackApplyRoute(url.pathname);
  if (contentPackApplyRoute && req.method === 'POST') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const result = await applyContentPack({
      configService,
      sessionService,
      body,
      packId: contentPackApplyRoute.packId,
      resourceLibraryService,
      worldSimulationService
    });
    writeJson(res, 200, result);
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

  if (req.method === 'POST' && url.pathname === '/api/providers/test') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    if (!isPlainObject(body.provider)) throw new ApiError(400, 'PROVIDER_TEST_INVALID_CONFIG');
    const resolved = await resolveProviderSecrets({
      configService,
      incoming: { activeProviderId: body.provider.id || '', providers: [body.provider] }
    });
    const provider = resolved.providers?.[0];
    try {
      const result = await testProviderConnection({ provider, providerClient, fetchImpl });
      writeJson(res, 200, { result });
    } catch (error) {
      const detail = sanitizeProviderTestError(error, provider);
      const statusCode = error.message === 'PROVIDER_TEST_TIMEOUT' ? 504 : 502;
      throw new ApiError(statusCode, 'PROVIDER_TEST_FAILED', detail);
    }
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/session/settings') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const result = await saveSessionSettings({ sessionService, body });
    writeJson(res, 200, result);
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/prompt-modules') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const promptModulePayload = body.promptModules ?? [];
    if (!Array.isArray(promptModulePayload)) {
      throw new ApiError(400, 'INVALID_PROMPT_MODULES');
    }
    if (body.sessionId) {
      const session = await getApiSession(sessionService, body.sessionId);
      session.config = await getEditableSessionConfig({ configService, session });
      session.config.promptModules = promptModulePayload;
      await sessionService.saveSession(session);
      writeJson(res, 200, { promptModules: promptModulePayload });
      return;
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
    if (body.sessionId) {
      const session = await getApiSession(sessionService, body.sessionId);
      session.config = await getEditableSessionConfig({ configService, session });
      session.config.worldBook = worldBookPayload;
      await sessionService.saveSession(session);
      writeJson(res, 200, { worldBook: worldBookPayload });
      return;
    }
    const worldBook = await configService.saveWorldBook(worldBookPayload);
    writeJson(res, 200, { worldBook });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/world-book/trigger-test') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const worldBook = Array.isArray(body.worldBook) ? body.worldBook : [];
    const query = String(body.query || '');
    const maxCards = Number(body.maxCards ?? 50);
    const triggered = retrieveCards({ query, worldBook, memoryCards: [], maxCards, maxRecursionDepth: 1 });
    writeJson(res, 200, { triggered, total: triggered.length });
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
      agentService,
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
    if (body.sessionId) {
      const session = await getApiSession(sessionService, body.sessionId);
      session.config = await getEditableSessionConfig({ configService, session });
      session.config.characterCard = characterCardPayload;
      await sessionService.saveSession(session);
      writeJson(res, 200, { characterCard: characterCardPayload });
      return;
    }
    const characterCard = await configService.saveCharacterCard(characterCardPayload);
    writeJson(res, 200, { characterCard });
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/persona') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const personaPayload = body.persona ?? {};
    if (!isPlainObject(personaPayload)) {
      throw new ApiError(400, 'INVALID_PERSONA');
    }
    const persona = await configService.savePersona(personaPayload);
    writeJson(res, 200, { persona });
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/quick-replies') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const quickReplies = await configService.saveQuickReplies(body.quickReplies || []);
    writeJson(res, 200, { quickReplies });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/character-presets') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const config = await configService.getAll();
    const presets = Array.isArray(config.characterPresets) ? config.characterPresets : [];
    const newPreset = {
      id: `preset-${crypto.randomUUID()}`,
      name: String(body.name || body.characterCard?.name || '未命名').trim().slice(0, 30),
      characterCard: body.characterCard || config.characterCard,
      worldBook: body.worldBook || config.worldBook,
      promptModules: body.promptModules || config.promptModules,
      createdAt: new Date().toISOString()
    };
    const updated = [...presets, newPreset];
    await configService.saveCharacterPresets(updated);
    writeJson(res, 200, { characterPresets: updated, preset: newPreset });
    return;
  }

  if (req.method === 'DELETE' && url.pathname === '/api/character-presets') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const config = await configService.getAll();
    const presets = Array.isArray(config.characterPresets) ? config.characterPresets : [];
    const updated = presets.filter((p) => p.id !== body.id);
    await configService.saveCharacterPresets(updated);
    writeJson(res, 200, { characterPresets: updated });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/prompt-presets') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const config = await configService.getAll();
    const presets = Array.isArray(config.promptPresets) ? config.promptPresets : [];
    const newPreset = {
      id: `prompt-preset-${crypto.randomUUID()}`,
      name: String(body.name || '未命名预设').trim().slice(0, 30),
      promptModules: Array.isArray(body.promptModules) ? body.promptModules : config.promptModules,
      createdAt: new Date().toISOString()
    };
    const updated = [...presets, newPreset];
    await configService.savePromptPresets(updated);
    writeJson(res, 200, { promptPresets: updated, preset: newPreset });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/prompt-presets/apply') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const config = await configService.getAll();
    const presets = Array.isArray(config.promptPresets) ? config.promptPresets : [];
    const preset = presets.find((p) => p.id === body.id);
    if (!preset) {
      writeJson(res, 404, { error: 'PRESET_NOT_FOUND' });
      return;
    }
    const applied = await configService.savePromptModules(preset.promptModules);
    writeJson(res, 200, { promptModules: applied, promptPresets: presets });
    return;
  }

  if (req.method === 'DELETE' && url.pathname === '/api/prompt-presets') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const config = await configService.getAll();
    const presets = Array.isArray(config.promptPresets) ? config.promptPresets : [];
    const updated = presets.filter((p) => p.id !== body.id);
    await configService.savePromptPresets(updated);
    writeJson(res, 200, { promptPresets: updated });
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/group-members') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const saved = await configService.saveGroupMembers(body.groupMembers || []);
    writeJson(res, 200, { groupMembers: saved });
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/macro-templates') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const saved = await configService.saveMacroTemplates(body.macroTemplates || []);
    writeJson(res, 200, { macroTemplates: saved });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/macro/expand') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const config = await configService.getAll();
    const context = {
      user: config.persona?.enabled ? (config.persona.name || '用户') : '用户',
      characterCard: config.characterCard,
      persona: config.persona,
      messages: [],
      userMessage: body.text || '',
      worldBook: config.worldBook,
      templates: config.macroTemplates,
      customArrays: body.customArrays || {}
    };
    const expanded = expandMacros(String(body.text || ''), context);
    writeJson(res, 200, { expanded });
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/vector-memory') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const saved = await configService.saveVectorMemory(body.vectorMemory || {});
    writeJson(res, 200, { vectorMemory: saved });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/vector-memory/search') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const sessionId = String(body.sessionId || 'main');
    const query = String(body.query || '').trim();
    const topK = Number(body.topK) || 5;
    const session = await getApiSession(sessionService, sessionId);
    // 增量索引当前消息
    await agentService.vectorMemoryService?.indexMessages({ sessionId, messages: session.messages });
    const hits = await agentService.vectorMemoryService?.search({ sessionId, query, topK }) || [];
    writeJson(res, 200, { hits });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/vector-memory/stats') {
    const sessionId = url.searchParams.get('sessionId') || 'main';
    const stats = agentService.vectorMemoryService?.getStats(sessionId) || { indexed: 0, enabled: false };
    const config = await configService.getAll();
    const provider = config.providers?.providers?.find((p) => p.id === (config.vectorMemory?.providerId || config.providers?.activeProviderId)) || config.providers?.providers?.[0];
    stats.configured = Boolean(config.vectorMemory?.enabled);
    stats.providerReady = Boolean(provider);
    writeJson(res, 200, { stats });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/vector-memory/rebuild') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const sessionId = String(body.sessionId || 'main');
    const session = await getApiSession(sessionService, sessionId);
    agentService.vectorMemoryService?.dropIndex(sessionId);
    const result = await agentService.vectorMemoryService?.indexMessages({ sessionId, messages: session.messages }) || { indexed: 0 };
    writeJson(res, 200, result);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/image/generate') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const config = await configService.getAll();
    const providers = Array.isArray(config.providers?.providers) ? config.providers.providers : [];
    const providerId = String(body.providerId || '').trim();
    const provider = providerId
      ? providers.find((p) => p.id === providerId)
      : providers.find((p) => p.id === config.providers?.activeProviderId) || providers[0];
    if (!provider) throw new ApiError(400, 'NO_PROVIDER_AVAILABLE');
    const { generateImage } = await import('./agent/imageClient.js');
    const result = await generateImage({
      provider,
      prompt: String(body.prompt || '').trim(),
      size: String(body.size || '1024x1024'),
      fetchImpl: fetchImpl || globalThis.fetch
    });
    writeJson(res, 200, result);
    return;
  }

  // 语音合成 (TTS): 调用 /v1/audio/speech，返回二进制音频
  if (req.method === 'POST' && url.pathname === '/api/voice/tts') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const config = await configService.getAll();
    const providers = Array.isArray(config.providers?.providers) ? config.providers.providers : [];
    const providerId = String(body.providerId || '').trim();
    const provider = providerId
      ? providers.find((p) => p.id === providerId)
      : providers.find((p) => p.id === config.providers?.activeProviderId) || providers[0];
    if (!provider) throw new ApiError(400, 'NO_PROVIDER_AVAILABLE');
    const { synthesizeSpeech } = await import('./agent/voiceClient.js');
    const result = await synthesizeSpeech({
      provider,
      text: String(body.text || ''),
      voice: String(body.voice || 'alloy'),
      format: String(body.format || 'mp3'),
      fetchImpl: fetchImpl || globalThis.fetch
    });
    const contentType = result.format === 'wav' ? 'audio/wav' : (result.format === 'opus' ? 'audio/ogg' : 'audio/mpeg');
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': result.audio.byteLength
    });
    res.end(Buffer.from(result.audio));
    return;
  }

  // 语音识别 (STT): 接收 multipart 上传，调用 /v1/audio/transcriptions
  if (req.method === 'POST' && url.pathname === '/api/voice/stt') {
    if (!isAllowedOrigin(req)) {
      throw new ApiError(403, 'FORBIDDEN_ORIGIN');
    }
    const { audio, filename, format, language, providerId } = await readMultipartAudio(req);
    const config = await configService.getAll();
    const providers = Array.isArray(config.providers?.providers) ? config.providers.providers : [];
    const provider = providerId
      ? providers.find((p) => p.id === providerId)
      : providers.find((p) => p.id === config.providers?.activeProviderId) || providers[0];
    if (!provider) throw new ApiError(400, 'NO_PROVIDER_AVAILABLE');
    const { transcribeSpeech } = await import('./agent/voiceClient.js');
    const result = await transcribeSpeech({
      provider,
      audio,
      filename,
      format,
      language,
      fetchImpl: fetchImpl || globalThis.fetch
    });
    writeJson(res, 200, { text: result.text });
    return;
  }

  // MCP: 列出已注册 server
  if (req.method === 'GET' && url.pathname === '/api/mcp/servers') {
    const servers = mcpRegistry.listServers();
    writeJson(res, 200, { servers });
    return;
  }

  // MCP: 保存 server 配置列表
  if (req.method === 'PUT' && url.pathname === '/api/mcp/servers') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const saved = await configService.saveMcpServers(body.servers || []);
    // 重建 registry 中的配置（保留已连接的会话）
    const existingIds = new Set(saved.map((s) => s.id));
    Array.from(mcpRegistry.connections.keys()).forEach((id) => {
      if (!existingIds.has(id)) mcpRegistry.removeServer(id);
    });
    saved.forEach((s) => mcpRegistry.upsertConfig(s));
    writeJson(res, 200, { servers: saved });
    return;
  }

  // MCP: 连接某个 server
  const connectMatch = url.pathname.match(/^\/api\/mcp\/servers\/([^/]+)\/connect$/);
  if (connectMatch && req.method === 'POST') {
    validateMutatingRequest(req);
    const id = decodeURIComponent(connectMatch[1]);
    const tools = await mcpRegistry.connect(id);
    writeJson(res, 200, { tools });
    return;
  }

  // MCP: 断开某个 server
  const disconnectMatch = url.pathname.match(/^\/api\/mcp\/servers\/([^/]+)\/disconnect$/);
  if (disconnectMatch && req.method === 'POST') {
    validateMutatingRequest(req);
    const id = decodeURIComponent(disconnectMatch[1]);
    const entry = mcpRegistry.connections.get(id);
    if (entry?.client?.close) {
      try { entry.client.close(); } catch {}
      entry.client = null;
      entry.tools = [];
    }
    writeJson(res, 200, { ok: true });
    return;
  }

  // MCP: 列出所有已连接工具
  if (req.method === 'GET' && url.pathname === '/api/mcp/tools') {
    const tools = mcpRegistry.listAllTools();
    writeJson(res, 200, { tools });
    return;
  }

  // MCP: 调用工具
  if (req.method === 'POST' && url.pathname === '/api/mcp/tools/call') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const result = await mcpRegistry.callTool({
      serverId: String(body.serverId || '').trim(),
      toolName: String(body.toolName || '').trim(),
      arguments: body.arguments || {}
    });
    writeJson(res, 200, { result });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/import/preview') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const preview = previewImport(body.payload ?? body);
    preview.inspection = await resourceLibraryService.inspectPreview(preview, body.source || {});
    writeJson(res, 200, { preview });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/import/commit') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const result = await commitImport({
      assetService,
      configService,
      sessionService,
      resourceLibraryService,
      body
    });
    writeJson(res, 200, result);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/import-sources/download') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const result = await importSourceService.download(body);
    writeJson(res, 200, result);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/character-card/import') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const imported = importCharacterCardFromPayload(body);
    const portrait = await saveImportedCharacterPortrait(assetService, body);
    if (portrait) imported.characterCard.portrait = portrait;
    const characterCard = await assetService.saveCharacter(imported.characterCard);
    let worldBook = [];
    if (imported.worldBook?.length) {
       const wbAsset = await assetService.saveWorldBook(
         null,
         characterCard.name + '的设定集',
         imported.worldBook
       );
       worldBook = wbAsset.entries;
    }
    writeJson(res, 200, { characterCard, worldBook });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/character-card/export') {
    const config = await configService.getAll();
    const characterCard = config.characterCard;
    const worldBook = config.worldBook;
    const basePortrait = await assetService.readCharacterPortrait(characterCard?.portrait?.assetId);
    const png = exportCharacterCardPng(characterCard, worldBook, basePortrait);
    const filename = `${encodeURIComponent(characterCard?.name || 'character')}.png`;
    res.writeHead(200, {
      'content-type': 'image/png',
      'content-disposition': `attachment; filename="${filename}"`,
      'content-length': png.length
    });
    res.end(png);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/rewrite') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const result = await rewriteText({ agentService, body });
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

  if (messageRoute && req.method === 'POST' && messageRoute.action === 'visibility') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const result = await toggleMessageVisibility({ agentService, body, messageId: messageRoute.messageId });
    writeJson(res, 200, result);
    return;
  }

  if (messageRoute && req.method === 'POST' && messageRoute.action === 'swipe') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const result = await switchMessageSwipe({ agentService, body, messageId: messageRoute.messageId });
    writeJson(res, 200, result);
    return;
  }

  if (messageRoute && (req.method === 'POST' || req.method === 'DELETE') && messageRoute.action === 'bookmark') {
    validateMutatingRequest(req);
    const body = req.method === 'DELETE' ? {} : await readRequestJson(req);
    const result = await toggleMessageBookmark({ agentService, body, messageId: messageRoute.messageId });
    writeJson(res, 200, result);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/chat/continue') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    await streamContinue({ agentService, body, res });
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
    const cacheControl = ['.html', '.css', '.js', '.json'].includes(ext)
      ? 'no-store'
      : 'public, max-age=86400';
    res.writeHead(200, {
      'content-type': contentTypes.get(ext) || 'application/octet-stream',
      'cache-control': cacheControl
    });
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

async function callSimulationApi(callback) {
  try {
    return await callback();
  } catch (error) {
    if (error?.name === 'ActionProtocolError' || String(error?.code || '').startsWith('ACTION_')) {
      throw new ApiError(400, error.code || 'ACTION_PROTOCOL_INVALID', error.detail || error.message);
    }
    throw error;
  }
}

function clampApiInteger(value, min, max, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
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
    throw new ApiError(502, resolveProviderErrorCode(error));
  }
}

async function rewriteText({ agentService, body }) {
  try {
    return await agentService.rewriteText({
      sessionId: body.sessionId || 'main',
      target: body.target || 'chat-input',
      text: body.text,
      instruction: body.instruction
    });
  } catch (error) {
    if (error.message === 'NO_ACTIVE_PROVIDER') throw new ApiError(409, 'NO_ACTIVE_PROVIDER');
    if (error.message === 'EMPTY_REWRITE_TEXT') throw new ApiError(400, 'EMPTY_REWRITE_TEXT');
    throw new ApiError(502, 'PROVIDER_ERROR');
  }
}

async function saveSessionSettings({ sessionService, body }) {
  if (!isPlainObject(body.settings)) throw new ApiError(400, 'INVALID_SESSION_SETTINGS');
  const session = await getApiSession(sessionService, body.sessionId || 'main');
  session.settings = normalizeSessionSettings({
    ...session.settings,
    ...body.settings
  });
  session.updatedAt = new Date().toISOString();
  await sessionService.saveSession(session);
  return { session };
}

async function getUsageSummary({ sessionService, scope, sessionId }) {
  if (String(scope || '').toLowerCase() === 'all') {
    const sessionIds = await sessionService.listSessions();
    const sessions = await Promise.all(
      Array.from(new Set(['main', ...sessionIds])).map((id) => getApiSession(sessionService, id))
    );
    return summarizeAllUsage(sessions);
  }

  const session = await getApiSession(sessionService, sessionId || 'main');
  return summarizeSessionUsage(session);
}

function previewImport(payload) {
  try {
    return previewImportPayload(payload);
  } catch {
    throw new ApiError(400, 'INVALID_IMPORT_PAYLOAD');
  }
}

async function commitImport({ assetService, configService, sessionService, resourceLibraryService, body }) {
  const payload = body.payload ?? body;
  const preview = previewImport(payload);
  if (preview.kind === 'character-card') {
    const portrait = await saveImportedCharacterPortrait(assetService, payload);
    if (portrait) preview.importData.characterCard.portrait = portrait;
  }
  const source = body.source || {};
  const inspection = await resourceLibraryService.inspectPreview(preview, source);
  if (inspection.verdict === 'blocked') {
    throw new ApiError(422, 'RESOURCE_IMPORT_NOT_READY');
  }
  if (preview.kind === 'plugin-manifest') {
    const result = await resourceLibraryService.installPluginManifest(preview.importData.pluginManifest);
    preview.inspection = result.inspection;
    return {
      preview,
      applyMode: 'plugin-registry',
      plugin: result.plugin,
      installStatus: result.installStatus,
      importedWorldBookCount: 0,
      libraryResources: []
    };
  }
  if (preview.kind === 'content-pack') {
    const result = await resourceLibraryService.installContentPackBundle(
      preview.importData.contentPackBundle,
      source,
      { inspection }
    );
    preview.inspection = result.inspection;
    return {
      preview,
      applyMode: 'content-pack-library',
      pack: result.pack,
      installStatus: result.installStatus,
      importedWorldBookCount: 0,
      libraryResources: []
    };
  }
  const libraryResult = await resourceLibraryService.savePreview(preview, source, { inspection });
  preview.inspection = libraryResult.inspection;
  const applyToActiveConfig = body.applyToActiveConfig !== false;
  if (!applyToActiveConfig) {
    return {
      preview,
      applyMode: 'library-only',
      importedWorldBookCount: 0,
      parsedWorldBookCount: Number(preview.summary?.worldBookCount || 0),
      libraryResources: libraryResult.resources
    };
  }
  if (preview.kind === 'character-card') {
    const characterCard = await assetService.saveCharacter(preview.importData.characterCard);
    let importedWorldBook = [];
    if (preview.importData.worldBook?.length) {
       const wbAsset = await assetService.saveWorldBook(
         null,
         characterCard.name + '的设定集',
         preview.importData.worldBook
       );
       importedWorldBook = wbAsset.entries;
    }
    let worldBook = importedWorldBook;
    if (body.sessionId) {
      const session = await getApiSession(sessionService, body.sessionId);
      session.config = await getEditableSessionConfig({ configService, session });
      const existingWorldBook = Array.isArray(session.config.worldBook) ? session.config.worldBook : [];
      const existingIds = new Set(existingWorldBook.map(worldBookIdentity));
      const additions = importedWorldBook.filter((entry) => !existingIds.has(worldBookIdentity(entry)));
      session.config.characterCard = characterCard;
      session.config.worldBook = [...existingWorldBook, ...additions];
      await sessionService.saveSession(session);
      worldBook = session.config.worldBook;
    } else {
      await configService.saveCharacterCard(characterCard);
    }
    return {
      preview,
      applyMode: 'active-config',
      characterCard,
      worldBook,
      importedWorldBookCount: importedWorldBook.length,
      libraryResources: libraryResult.resources
    };
  }

  if (preview.kind === 'world-book') {
    const worldBook = await assetService.saveWorldBook(null, preview.title || '导入的世界书', preview.importData.worldBook);
    return {
      preview,
      applyMode: 'active-config',
      worldBook,
      importedWorldBookCount: worldBook.entries?.length || 0,
      libraryResources: libraryResult.resources
    };
  }

  throw new ApiError(400, 'INVALID_IMPORT_PAYLOAD');
}

async function saveImportedCharacterPortrait(assetService, payload) {
  try {
    return await assetService.saveCharacterPortrait(payload);
  } catch (error) {
    if (error?.code === 'CHARACTER_IMAGE_TOO_LARGE') {
      throw new ApiError(413, 'CHARACTER_IMAGE_TOO_LARGE');
    }
    throw error;
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
      targetSpeaker: body.targetSpeaker,
      onToken: async (content) => writeSse(res, 'token', { content })
    });
    writeSse(res, 'done', result);
  } catch (error) {
    const code = error.message === 'NO_ACTIVE_PROVIDER' ? 'NO_ACTIVE_PROVIDER' : resolveProviderErrorCode(error);
    writeSse(res, 'error', { error: code });
  } finally {
    res.end();
  }
}

async function streamContinue({ agentService, body, res }) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive'
  });

  try {
    const result = await agentService.continueMessage({
      sessionId: body.sessionId || 'main',
      onToken: async (content) => writeSse(res, 'token', { content })
    });
    writeSse(res, 'done', result);
  } catch (error) {
    const code = error.message === 'NO_ACTIVE_PROVIDER' ? 'NO_ACTIVE_PROVIDER' : resolveProviderErrorCode(error);
    writeSse(res, 'error', { error: code });
  } finally {
    res.end();
  }
}

function resolveProviderErrorCode(error) {
  const message = String(error?.message || '');
  if (message.startsWith('PROVIDER_REASONING_ONLY_RESPONSE')) return 'PROVIDER_REASONING_ONLY_RESPONSE';
  if (message === 'PROVIDER_EMPTY_RESPONSE') return 'PROVIDER_EMPTY_RESPONSE';
  return 'PROVIDER_ERROR';
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

async function toggleMessageVisibility({ agentService, body, messageId }) {
  try {
    return await agentService.toggleMessageVisibility({
      sessionId: body.sessionId || 'main',
      messageId
    });
  } catch (error) {
    if (error.message === 'MESSAGE_NOT_FOUND') throw new ApiError(404, 'MESSAGE_NOT_FOUND');
    throw new ApiError(500, 'INTERNAL_ERROR');
  }
}

async function switchMessageSwipe({ agentService, body, messageId }) {
  try {
    return await agentService.switchMessageSwipe({
      sessionId: body.sessionId || 'main',
      messageId,
      swipeIndex: body.swipeIndex
    });
  } catch (error) {
    if (error.message === 'MESSAGE_NOT_FOUND') throw new ApiError(404, 'MESSAGE_NOT_FOUND');
    if (error.message === 'NO_SWIPES_AVAILABLE') throw new ApiError(400, 'NO_SWIPES_AVAILABLE');
    if (error.message === 'INVALID_SWIPE_INDEX') throw new ApiError(400, 'INVALID_SWIPE_INDEX');
    throw new ApiError(500, 'INTERNAL_ERROR');
  }
}

async function toggleMessageBookmark({ agentService, body, messageId }) {
  try {
    return await agentService.toggleMessageBookmark({
      sessionId: body.sessionId || 'main',
      messageId,
      label: body.label
    });
  } catch (error) {
    if (error.message === 'MESSAGE_NOT_FOUND') throw new ApiError(404, 'MESSAGE_NOT_FOUND');
    throw new ApiError(500, 'INTERNAL_ERROR');
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

async function applyContentPack({ configService, sessionService, body, packId, resourceLibraryService, worldSimulationService }) {
  const pack = await resolveContentPack(resourceLibraryService, packId);
  if (!pack) throw new ApiError(404, 'CONTENT_PACK_NOT_FOUND');
  const compatibility = await resourceLibraryService.inspectPackCompatibility(pack);
  if (!compatibility.canInstall) {
    throw new ApiError(
      409,
      'CONTENT_PACK_INCOMPATIBLE',
      compatibility.blockingIssues.map((item) => item.code).join(',')
    );
  }

  const [promptModules, worldBook, characterCard, session] = await Promise.all([
    configService.savePromptModules(pack.promptModules),
    configService.saveWorldBook(pack.worldBook),
    configService.saveCharacterCard(pack.characterCard),
    getApiSession(sessionService, body.sessionId || 'main')
  ]);

  const nextSession = {
    ...session,
    title: pack.sessionTitle || session.title,
    updatedAt: new Date().toISOString(),
    config: {
      ...(isPlainObject(session.config) ? session.config : {}),
      contentPackId: pack.id,
      promptModules,
      worldBook,
      characterCard,
      characterPresets: Array.isArray(pack.characterPresets) ? structuredClone(pack.characterPresets) : []
    },
    memory: withPackRuleSystem(pack.memory, pack.ruleSystem),
    messages: Array.isArray(session.messages) ? session.messages : [],
    settings: session.settings || {
      recentPairs: 8,
      maxPromptTokens: 8000,
      maxInjectedCards: 5,
      narrativeMode: 'stable'
    }
  };
  worldSimulationService.prepareSession(nextSession, {
    characterCard,
    characterPresets: Array.isArray(pack.characterPresets) ? pack.characterPresets : []
  });
  await sessionService.saveSession(nextSession);

  return {
    appliedPack: {
      id: pack.id,
      title: pack.title,
      description: pack.description,
      ruleSystem: pack.ruleSystem,
      custom: pack.custom === true,
      visualPackId: pack.visualPackId || pack.resourceManifest?.basePackId || pack.id,
      stageBackground: structuredClone(pack.stageBackground || null),
      basePackId: pack.resourceManifest?.basePackId || '',
      manifest: pack.manifest || null,
      compatibility: {
        verdict: compatibility.verdict,
        warningCount: compatibility.warnings.length
      }
    },
    promptModules,
    worldBook,
    characterCard,
    session: nextSession
  };
}

async function resolveContentPack(resourceLibraryService, packId) {
  return getContentPack(packId) || await resourceLibraryService.getPack(packId);
}

async function createSessionFromContentPack({ sessionService, worldSimulationService, pack, body = {}, project = null }) {
  const config = {
    characterCard: structuredClone(pack.characterCard || {}),
    worldBook: structuredClone(pack.worldBook || []),
    promptModules: structuredClone(pack.promptModules || [])
  };
  const visualPackId = String(
    project?.visualPackId
    || pack.visualPackId
    || pack.resourceManifest?.basePackId
    || pack.id
  );
  const session = await sessionService.createSessionWithConfig({
    id: body.id,
    title: body.title || pack.sessionTitle || pack.title || '新的故事',
    config,
    memory: withPackRuleSystem(pack.memory, pack.ruleSystem),
    storyProjectId: project?.id || '',
    basePackId: pack.id
  });
  session.settings = {
    ...session.settings,
    ...(project?.runtimePolicy || {}),
    visualContentPack: visualPackId,
    ...(pack.stageBackground?.url ? {
      backgroundImage: pack.stageBackground.url,
      backgroundFit: pack.stageBackground.fit || 'portrait',
      backgroundSource: pack.stageBackground.source || 'character-portrait'
    } : {})
  };
  worldSimulationService.prepareSession(session, {
    characterCard: config.characterCard,
    characterPresets: Array.isArray(pack.characterPresets) ? pack.characterPresets : []
  });
  await sessionService.saveSession(session);
  return session;
}

function buildStoryProjectBindings(pack) {
  const manifest = pack.resourceManifest || {};
  return {
    protagonistResourceId: manifest.characterResourceId || '',
    npcResourceIds: [],
    loreModuleIds: manifest.worldBookResourceIds || [],
    ruleModuleIds: [],
    stylePromptIds: manifest.promptResourceIds || [],
    scenarioModuleIds: []
  };
}

function summarizeResolvedPack(pack) {
  return {
    id: pack.id,
    title: pack.title,
    description: pack.description,
    sessionTitle: pack.sessionTitle,
    characterName: pack.characterCard?.name || '',
    characterPortrait: structuredClone(pack.characterCard?.portrait || null),
    stageBackground: structuredClone(pack.stageBackground || null),
    custom: pack.custom === true,
    visualPackId: pack.visualPackId || pack.resourceManifest?.basePackId || pack.id,
    basePackId: pack.resourceManifest?.basePackId || '',
    manifest: pack.manifest || null,
    version: pack.manifest?.version || '1.0.0',
    counts: {
      promptModules: pack.promptModules?.length || 0,
      worldBook: pack.worldBook?.length || 0,
      memoryCards: pack.memory?.memoryCards?.length || 0,
      characterPresets: 1
    }
  };
}

function withPackRuleSystem(memory, ruleSystem) {
  return {
    ...structuredClone(memory || {}),
    ruleSystem: structuredClone(ruleSystem)
  };
}

function withRuleSystem(session) {
  const next = structuredClone(session);
  if (next.memory?.ruleSystem) return next;
  const genre = next.memory?.worldState?.flags?.genre;
  const ruleSystem = getRuleSystemForGenre(genre);
  if (!ruleSystem) return next;
  next.memory = {
    ...(next.memory || {}),
    ruleSystem
  };
  return next;
}

async function promoteMemoryFact({ configService, sessionService, agentService, body, factId }) {
  const session = await getApiSession(sessionService, body.sessionId || 'main');
  const facts = normalizeFactCards(session.memory?.memoryCards || []);
  const fact = facts.find((item) => item.id === factId);
  if (!fact) throw new ApiError(404, 'MEMORY_FACT_NOT_FOUND');

  const nextEntry = createWorldBookEntryFromFact(fact);
  const activeConfig = await agentService.resolveSessionConfig(session);
  const existingWorldBook = Array.isArray(activeConfig.worldBook) ? activeConfig.worldBook : [];
  const existingKeys = new Set(existingWorldBook.map(worldBookIdentity));
  if (!existingKeys.has(worldBookIdentity(nextEntry))) {
    activeConfig.worldBook = [...existingWorldBook, nextEntry];
    session.config = activeConfig;
    await sessionService.saveSession(session);
  }

  return { fact, worldBook: activeConfig.worldBook };
}

async function getEditableSessionConfig({ configService, session }) {
  const globalConfig = await configService.getAll();
  const scopedConfig = buildSessionScopedConfig(globalConfig, session);
  return {
    characterCard: scopedConfig.characterCard,
    promptModules: scopedConfig.promptModules,
    worldBook: scopedConfig.worldBook
  };
}

function buildSessionScopedConfig(globalConfig, session) {
  const sessionConfig = isPlainObject(session?.config) ? session.config : {};
  return {
    ...globalConfig,
    promptModules: Array.isArray(sessionConfig.promptModules) ? sessionConfig.promptModules : globalConfig.promptModules,
    worldBook: Array.isArray(sessionConfig.worldBook) ? sessionConfig.worldBook : globalConfig.worldBook,
    characterCard: isPlainObject(sessionConfig.characterCard) ? sessionConfig.characterCard : globalConfig.characterCard
  };
}

function normalizeSessionSettings(settings = {}) {
  return {
    recentPairs: normalizePositiveInteger(settings.recentPairs, 8),
    maxPromptTokens: normalizePositiveInteger(settings.maxPromptTokens, 8000),
    maxInjectedCards: normalizePositiveInteger(settings.maxInjectedCards, 5),
    narrativeMode: normalizeSessionSettingChoice(settings.narrativeMode, ['free', 'stable', 'strict']) || 'stable',
    activeAgentProfileId: normalizeAgentProfileId(settings.activeAgentProfileId),
    providerId: String(settings.providerId || '').trim(),
    taskProviderOverrides: normalizeSessionTaskProviderOverrides(settings.taskProviderOverrides),
    taskFallbackOverrides: normalizeSessionTaskFallbackOverrides(settings.taskFallbackOverrides),
    authorNote: String(settings.authorNote || ''),
    backgroundImage: String(settings.backgroundImage || '').trim(),
    theme: normalizeSessionSettingChoice(settings.theme, ['default-dark', 'wuxia-scroll', 'xianxia-scroll']),
    visualContentPack: normalizeSessionSettingChoice(settings.visualContentPack, [
      'xuanhuan',
      'lingyi',
      'mingmo',
      'xianxia',
      'yingxiongzhi'
    ])
  };
}

function normalizeSessionTaskProviderOverrides(value) {
  const source = isPlainObject(value) ? value : {};
  return Object.fromEntries(Object.entries(source)
    .map(([taskKey, providerId]) => [String(taskKey || '').trim(), String(providerId || '').trim()])
    .filter(([taskKey, providerId]) => PROVIDER_TASK_KEYS.has(taskKey) && providerId));
}

function normalizeSessionTaskFallbackOverrides(value) {
  const source = isPlainObject(value) ? value : {};
  return Object.fromEntries(Object.entries(source)
    .map(([taskKey, providerIds]) => [
      String(taskKey || '').trim(),
      Array.isArray(providerIds) ? providerIds.map((id) => String(id || '').trim()).filter(Boolean) : []
    ])
    .filter(([taskKey, providerIds]) => PROVIDER_TASK_KEYS.has(taskKey) && providerIds.length));
}

function normalizeSessionSettingChoice(value, choices) {
  const normalized = String(value || '').trim();
  return choices.includes(normalized) ? normalized : '';
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.floor(number);
}

async function getApiSession(sessionService, sessionId) {
  try {
    return await sessionService.getSession(sessionId);
  } catch (error) {
    if (error.message === 'Invalid session id') throw new ApiError(400, 'INVALID_SESSION_ID');
    throw error;
  }
}

function formatSessionAsText(session, useMarkdown) {
  const title = String(session?.title || session?.id || '未命名会话');
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const lines = [];
  const sep = useMarkdown ? '\n## ' : '\n---\n';

  lines.push(useMarkdown ? `# ${title}` : title);
  lines.push('');

  for (const message of messages) {
    if (message.excluded) continue;
    const role = message.role === 'user' ? '用户' : 'Agent';
    const time = message.createdAt ? new Date(message.createdAt).toLocaleString('zh-CN') : '';
    const content = String(message.content || '').trim();
    if (useMarkdown) {
      lines.push(`## ${role}${time ? `  \n*${time}*` : ''}`);
    } else {
      lines.push(`${role}${time ? ` (${time})` : ''}:`);
    }
    lines.push(content);
    lines.push('');
  }

  return lines.join('\n').trim();
}

async function importSession({ sessionService, body }) {
  if (!body.session || typeof body.session !== 'object') {
    throw new ApiError(400, 'INVALID_SESSION_DATA');
  }
  const source = body.session;
  const sessionId = String(body.id || source.id || `imported-${Date.now()}`);
  const session = {
    id: sessionId,
    title: String(source.title || '导入的会话'),
    createdAt: source.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: Array.isArray(source.messages) ? source.messages : [],
    memory: source.memory || null,
    settings: source.settings || { providerId: '', recentPairs: 8, maxPromptTokens: 8000, maxInjectedCards: 5, narrativeMode: 'stable' },
    config: source.config || undefined,
    storyProjectId: String(source.storyProjectId || ''),
    basePackId: String(source.basePackId || '')
  };
  await sessionService.saveSession(session);
  return session;
}

function matchMessageRoute(pathname) {
  const editMatch = pathname.match(/^\/api\/messages\/([^/]+)$/);
  if (editMatch) return { action: 'edit', messageId: decodeURIComponent(editMatch[1]) };
  const regenerateMatch = pathname.match(/^\/api\/messages\/([^/]+)\/regenerate$/);
  if (regenerateMatch) return { action: 'regenerate', messageId: decodeURIComponent(regenerateMatch[1]) };
  const visibilityMatch = pathname.match(/^\/api\/messages\/([^/]+)\/visibility$/);
  if (visibilityMatch) return { action: 'visibility', messageId: decodeURIComponent(visibilityMatch[1]) };
  const swipeMatch = pathname.match(/^\/api\/messages\/([^/]+)\/swipe$/);
  if (swipeMatch) return { action: 'swipe', messageId: decodeURIComponent(swipeMatch[1]) };
  const bookmarkMatch = pathname.match(/^\/api\/messages\/([^/]+)\/bookmark$/);
  if (bookmarkMatch) return { action: 'bookmark', messageId: decodeURIComponent(bookmarkMatch[1]) };
  return null;
}

function matchMemoryFactPromoteRoute(pathname) {
  const match = pathname.match(/^\/api\/memory\/facts\/([^/]+)\/promote$/);
  if (!match) return null;
  return { factId: decodeURIComponent(match[1]) };
}

function matchContentPackApplyRoute(pathname) {
  const match = pathname.match(/^\/api\/content-packs\/([^/]+)\/apply$/);
  if (!match) return null;
  return { packId: decodeURIComponent(match[1]) };
}

function matchContentPackExportRoute(pathname) {
  const match = pathname.match(/^\/api\/content-packs\/([^/]+)\/export$/);
  if (!match) return null;
  return { packId: decodeURIComponent(match[1]) };
}

function matchContentPackCharactersRoute(pathname) {
  const match = pathname.match(/^\/api\/content-packs\/([^/]+)\/characters$/);
  if (!match) return null;
  return { packId: decodeURIComponent(match[1]) };
}

function matchResourceLibraryResourceRoute(pathname) {
  const match = pathname.match(/^\/api\/resource-library\/resources\/([^/]+)$/);
  if (!match) return null;
  return { resourceId: decodeURIComponent(match[1]) };
}

function matchCustomPackDeleteRoute(pathname) {
  const match = pathname.match(/^\/api\/resource-library\/packs\/([^/]+)$/);
  if (!match) return null;
  return { packId: decodeURIComponent(match[1]) };
}

function matchPluginRoute(pathname) {
  const match = pathname.match(/^\/api\/plugins\/([^/]+)$/);
  if (!match) return null;
  return { pluginId: decodeURIComponent(match[1]) };
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

/**
 * 读取 multipart/form-data 中的音频文件和文本字段（providerId/language/filename/format）
 * 仅提取第一个文件和已知字段，避免引入复杂的多部分解析库
 */
async function readMultipartAudio(req) {
  const contentType = getHeader(req, 'content-type');
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!boundaryMatch) {
    throw new ApiError(400, 'INVALID_MULTIPART');
  }
  const boundary = boundaryMatch[1] || boundaryMatch[2];
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const bodyBuffer = Buffer.concat(chunks);
  const fields = parseMultipart(bodyBuffer, boundary);
  const audioField = fields.find((f) => f.isFile);
  if (!audioField) {
    throw new ApiError(400, 'AUDIO_FILE_MISSING');
  }
  const textField = (name) => fields.find((f) => !f.isFile && f.name === name)?.value || '';
  return {
    audio: audioField.buffer,
    filename: audioField.filename || 'audio.wav',
    format: String(textField('format') || inferAudioFormat(audioField.filename)),
    language: String(textField('language') || ''),
    providerId: String(textField('providerId') || '').trim()
  };
}

function parseMultipart(buffer, boundary) {
  const fields = [];
  const delimiter = Buffer.from(`--${boundary}`);
  let start = 0;
  while (true) {
    const idx = buffer.indexOf(delimiter, start);
    if (idx === -1) break;
    // 找到 part 起始后的 \r\n\r\n（headers 与 body 分隔）
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), idx + delimiter.length);
    if (headerEnd === -1) break;
    const headersBuf = buffer.slice(idx + delimiter.length + 2, headerEnd).toString('utf8');
    const nextDelimiter = buffer.indexOf(Buffer.from(`\r\n--${boundary}`), headerEnd + 4);
    if (nextDelimiter === -1) break;
    const bodyBuf = buffer.slice(headerEnd + 4, nextDelimiter);
    const isFile = /content-type:/i.test(headersBuf) && /filename=/i.test(headersBuf);
    const nameMatch = /name="([^"]+)"/.exec(headersBuf);
    const filenameMatch = /filename="([^"]+)"/.exec(headersBuf);
    const name = nameMatch ? nameMatch[1] : '';
    if (isFile) {
      fields.push({
        isFile: true,
        name,
        filename: filenameMatch ? filenameMatch[1] : 'audio',
        buffer: bodyBuf
      });
    } else {
      fields.push({
        isFile: false,
        name,
        value: bodyBuf.toString('utf8')
      });
    }
    start = nextDelimiter + 2;
  }
  return fields;
}

function inferAudioFormat(filename) {
  const ext = String(filename || '').toLowerCase().split('.').pop();
  if (ext === 'mp3') return 'mp3';
  if (ext === 'webm') return 'webm';
  if (ext === 'm4a') return 'm4a';
  if (ext === 'ogg') return 'ogg';
  return 'wav';
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

const PROXY_IMAGE_ALLOWED_PROTOCOLS = new Set(['https:']);
const PROXY_IMAGE_BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
  'metadata.aws.internal'
]);
const PROXY_IMAGE_BLOCKED_PREFIXES = [
  '127.',
  '0.0.0.0',
  '10.',
  '192.168.',
  '169.254.',
  '172.16.', '172.17.', '172.18.', '172.19.',
  '172.20.', '172.21.', '172.22.', '172.23.',
  '172.24.', '172.25.', '172.26.', '172.27.',
  '172.28.', '172.29.', '172.30.', '172.31.',
  '::1', 'fc', 'fd', 'fe80:'
];

function parseProxyImageUrl(targetUrl) {
  if (!targetUrl || typeof targetUrl !== 'string') {
    throw new ApiError(400, 'INVALID_URL');
  }
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new ApiError(400, 'INVALID_URL');
  }
  if (!PROXY_IMAGE_ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new ApiError(400, 'INVALID_URL');
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|]$/g, '');
  if (PROXY_IMAGE_BLOCKED_HOSTNAMES.has(hostname)) {
    throw new ApiError(400, 'INVALID_URL');
  }
  if (PROXY_IMAGE_BLOCKED_PREFIXES.some((prefix) => hostname.startsWith(prefix))) {
    throw new ApiError(400, 'INVALID_URL');
  }
  return parsed;
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
  if (res.headersSent) {
    try { res.end(); } catch {}
    return;
  }
  if (error instanceof ApiError) {
    writeJson(res, error.statusCode, {
      error: error.code,
      ...(error.detail ? { detail: error.detail } : {})
    });
    return;
  }
  if (error instanceof BackupError) {
    writeJson(res, error.statusCode, { error: error.code });
    return;
  }
  if (error instanceof ImportSourceError) {
    writeJson(res, error.statusCode, { error: error.code });
    return;
  }
  console.error('[local-roleplay-agent] Unhandled API error', error);
  writeJson(res, 500, { error: 'INTERNAL_ERROR' });
}
