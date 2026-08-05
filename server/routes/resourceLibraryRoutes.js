import { writeJson } from '../lib/http.js';
import {
  ApiError,
  readRequestJson,
  validateMutatingRequest
} from './http.js';

export async function handleResourceLibraryRoutes({
  req,
  res,
  url,
  resourceLibraryService,
  contentLifecycleService,
  resolveContentPack,
  summarizeResolvedPack
}) {
  const path = url.pathname;
  if (!path.startsWith('/api/resource-library/') && !path.startsWith('/api/plugins')) {
    return false;
  }

  if (req.method === 'GET' && path === '/api/resource-library/adapters') {
    writeJson(res, 200, { adapters: await resourceLibraryService.listAdapters() });
    return true;
  }

  if (req.method === 'GET' && path === '/api/plugins') {
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
    return true;
  }

  if (req.method === 'POST' && path === '/api/plugins/inspect') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const inspection = await resourceLibraryService.pluginRegistry.inspectManifest(body.manifest || body);
    writeJson(res, 200, { inspection });
    return true;
  }

  if (req.method === 'POST' && path === '/api/plugins') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    try {
      writeJson(res, 200, await resourceLibraryService.installPluginManifest(body.manifest || body));
    } catch (error) {
      throw new ApiError(422, 'PLUGIN_MANIFEST_INVALID', error.message);
    }
    return true;
  }

  const pluginRoute = matchPluginRoute(path);
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
    return true;
  }

  if (pluginRoute && req.method === 'DELETE') {
    validateMutatingRequest(req);
    const removed = await resourceLibraryService.removePlugin(pluginRoute.pluginId);
    if (!removed) throw new ApiError(404, 'PLUGIN_NOT_FOUND');
    writeJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === 'GET' && path === '/api/resource-library/resources') {
    const resources = await resourceLibraryService.listResources({
      kind: url.searchParams.get('kind') || '',
      query: url.searchParams.get('q') || ''
    });
    writeJson(res, 200, { resources });
    return true;
  }

  if (req.method === 'PATCH' && path === '/api/resource-library/resources') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.resourceIds)) {
      throw new ApiError(400, 'RESOURCE_BATCH_METADATA_INVALID');
    }
    writeJson(res, 200, await resourceLibraryService.updateResourcesMetadata(body.resourceIds, body));
    return true;
  }

  if (req.method === 'POST' && path === '/api/resource-library/resources/export') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.resourceIds)) {
      throw new ApiError(400, 'RESOURCE_EXPORT_INVALID');
    }
    writeJson(res, 200, { bundle: await resourceLibraryService.exportResourceBundle(body.resourceIds) });
    return true;
  }

  if (req.method === 'DELETE' && path === '/api/resource-library/resources') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.resourceIds)) {
      throw new ApiError(400, 'RESOURCE_BATCH_DELETE_INVALID');
    }
    writeJson(res, 200, await resourceLibraryService.removeResources(body.resourceIds));
    return true;
  }

  if (req.method === 'GET' && path === '/api/resource-library/packs/compatibility-overview') {
    writeJson(res, 200, await resourceLibraryService.listPackCompatibilityOverview());
    return true;
  }

  if (req.method === 'GET' && path === '/api/resource-library/packs') {
    writeJson(res, 200, { packs: await resourceLibraryService.listPacks() });
    return true;
  }

  if (req.method === 'POST' && path === '/api/resource-library/resources/prompt') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    try {
      writeJson(res, 200, await resourceLibraryService.savePromptResource(body));
    } catch (error) {
      throw new ApiError(400, 'RESOURCE_PROMPT_INVALID', error.message);
    }
    return true;
  }

  const tagRegistryRoute = matchResourceTagRegistryRoute(path);
  if (tagRegistryRoute && req.method === 'POST') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new ApiError(400, 'RESOURCE_TAG_REGISTRY_INVALID');
    }
    try {
      const result = await resourceLibraryService.applyWorldBookTagRegistry(
        tagRegistryRoute.resourceId,
        body
      );
      if (!result) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
      writeJson(res, 200, result);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error.message === 'RESOURCE_TAG_REGISTRY_KIND_UNSUPPORTED') {
        throw new ApiError(409, error.message);
      }
      throw new ApiError(400, error.message || 'RESOURCE_TAG_REGISTRY_INVALID');
    }
    return true;
  }

  const reevaluationRoute = matchResourceReevaluationRoute(path);
  if (reevaluationRoute && req.method === 'POST') {
    validateMutatingRequest(req);
    const result = await resourceLibraryService.reevaluateResource(reevaluationRoute.resourceId);
    if (!result) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
    writeJson(res, 200, result);
    return true;
  }

  const revisionRollbackRoute = matchResourceRevisionRollbackRoute(path);
  if (revisionRollbackRoute && req.method === 'POST') {
    validateMutatingRequest(req);
    await readRequestJson(req);
    try {
      const resource = await resourceLibraryService.rollbackResource(
        revisionRollbackRoute.resourceId,
        revisionRollbackRoute.revisionId
      );
      if (!resource) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
      writeJson(res, 200, { resource });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error.message === 'RESOURCE_REVISION_NOT_FOUND') {
        throw new ApiError(404, 'RESOURCE_REVISION_NOT_FOUND');
      }
      if (error.message === 'RESOURCE_REVISION_ALREADY_CURRENT') {
        throw new ApiError(409, 'RESOURCE_REVISION_ALREADY_CURRENT');
      }
      throw new ApiError(400, error.message || 'RESOURCE_REVISION_ROLLBACK_FAILED');
    }
    return true;
  }

  const revisionRoute = matchResourceRevisionRoute(path);
  if (revisionRoute && req.method === 'GET') {
    const result = await resourceLibraryService.listResourceRevisions(revisionRoute.resourceId);
    if (!result) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
    writeJson(res, 200, result);
    return true;
  }

  const contentRoute = matchResourceContentRoute(path);
  if (contentRoute && req.method === 'PATCH') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new ApiError(400, 'RESOURCE_CONTENT_INVALID');
    }
    try {
      const resource = await resourceLibraryService.updateResourcePayload(contentRoute.resourceId, body);
      if (!resource) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
      writeJson(res, 200, { resource });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(400, error.message || 'RESOURCE_CONTENT_INVALID');
    }
    return true;
  }

  const resourceRoute = matchResourceRoute(path);
  if (resourceRoute && req.method === 'PATCH') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new ApiError(400, 'RESOURCE_METADATA_INVALID');
    }
    const resource = await resourceLibraryService.updateResourceMetadata(resourceRoute.resourceId, body);
    if (!resource) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
    writeJson(res, 200, { resource });
    return true;
  }

  if (resourceRoute && req.method === 'DELETE') {
    validateMutatingRequest(req);
    const removed = await resourceLibraryService.removeResource(resourceRoute.resourceId);
    if (!removed) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
    writeJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === 'POST' && path === '/api/resource-library/packs/inspect') {
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
    return true;
  }

  if (req.method === 'POST' && path === '/api/resource-library/packs') {
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
      if (String(error.code || '').startsWith('RESOURCE_PACK_')) {
        throw new ApiError(409, error.code, error.message);
      }
      throw new ApiError(400, 'RESOURCE_PACK_INVALID', error.message);
    }
    return true;
  }

  const compatibilityUpgradeRoute = matchPackCompatibilityUpgradeRoute(path);
  if (compatibilityUpgradeRoute && req.method === 'GET') {
    try {
      const preview = await resourceLibraryService.inspectPackCompatibilityUpgrade(
        compatibilityUpgradeRoute.packId
      );
      if (!preview) throw new ApiError(404, 'CONTENT_PACK_NOT_FOUND');
      writeJson(res, 200, { preview });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (String(error.code || '').startsWith('RESOURCE_PACK_UPGRADE_')) {
        throw new ApiError(409, error.code, error.message);
      }
      throw new ApiError(400, 'RESOURCE_PACK_UPGRADE_PREVIEW_FAILED', error.message);
    }
    return true;
  }

  if (compatibilityUpgradeRoute && req.method === 'POST') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    try {
      const pack = await resourceLibraryService.createPackCompatibilityUpgrade(
        compatibilityUpgradeRoute.packId,
        body
      );
      if (!pack) throw new ApiError(404, 'CONTENT_PACK_NOT_FOUND');
      writeJson(res, 200, { pack, summary: summarizeResolvedPack(pack) });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (
        String(error.code || '').startsWith('RESOURCE_PACK_UPGRADE_')
        || String(error.code || '').startsWith('RESOURCE_PACK_')
      ) {
        throw new ApiError(409, error.code, error.message);
      }
      if (String(error.message || '').startsWith('RESOURCE_NOT_FOUND:')) {
        throw new ApiError(409, 'RESOURCE_PACK_UPGRADE_NOT_REBUILDABLE', error.message);
      }
      throw new ApiError(400, 'RESOURCE_PACK_UPGRADE_FAILED', error.message);
    }
    return true;
  }

  const packDeletionImpactRoute = matchPackDeletionImpactRoute(path);
  if (packDeletionImpactRoute && req.method === 'GET') {
    const impact = await contentLifecycleService.inspectPackDeletion(packDeletionImpactRoute.packId);
    if (!impact) throw new ApiError(404, 'CONTENT_PACK_NOT_FOUND');
    writeJson(res, 200, { impact });
    return true;
  }

  const packRoute = matchPackRoute(path);
  if (packRoute && req.method === 'PATCH') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const pack = await resourceLibraryService.updatePackMetadata(packRoute.packId, body);
    if (!pack) throw new ApiError(404, 'CONTENT_PACK_NOT_FOUND');
    writeJson(res, 200, { pack, summary: summarizeResolvedPack(pack) });
    return true;
  }

  if (packRoute && req.method === 'DELETE') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    let result;
    try {
      result = await contentLifecycleService.deletePack(packRoute.packId, {
        confirmDetach: body.confirmDetach === true
      });
    } catch (error) {
      if (error.code === 'CONTENT_DELETE_CONFIRMATION_REQUIRED') {
        throw new ApiError(409, error.code);
      }
      throw error;
    }
    if (!result) throw new ApiError(404, 'CONTENT_PACK_NOT_FOUND');
    writeJson(res, 200, result);
    return true;
  }

  return false;
}

function matchResourceRoute(pathname) {
  const match = pathname.match(/^\/api\/resource-library\/resources\/([^/]+)$/);
  return match ? { resourceId: decodeURIComponent(match[1]) } : null;
}

function matchResourceReevaluationRoute(pathname) {
  const match = pathname.match(/^\/api\/resource-library\/resources\/([^/]+)\/reevaluate$/);
  return match ? { resourceId: decodeURIComponent(match[1]) } : null;
}

function matchResourceTagRegistryRoute(pathname) {
  const match = pathname.match(/^\/api\/resource-library\/resources\/([^/]+)\/tag-registry$/);
  return match ? { resourceId: decodeURIComponent(match[1]) } : null;
}

function matchResourceContentRoute(pathname) {
  const match = pathname.match(/^\/api\/resource-library\/resources\/([^/]+)\/content$/);
  return match ? { resourceId: decodeURIComponent(match[1]) } : null;
}

function matchResourceRevisionRoute(pathname) {
  const match = pathname.match(/^\/api\/resource-library\/resources\/([^/]+)\/revisions$/);
  return match ? { resourceId: decodeURIComponent(match[1]) } : null;
}

function matchResourceRevisionRollbackRoute(pathname) {
  const match = pathname.match(/^\/api\/resource-library\/resources\/([^/]+)\/revisions\/([^/]+)\/rollback$/);
  return match ? {
    resourceId: decodeURIComponent(match[1]),
    revisionId: decodeURIComponent(match[2])
  } : null;
}

function matchPackRoute(pathname) {
  const match = pathname.match(/^\/api\/resource-library\/packs\/([^/]+)$/);
  return match ? { packId: decodeURIComponent(match[1]) } : null;
}

function matchPackDeletionImpactRoute(pathname) {
  const match = pathname.match(/^\/api\/resource-library\/packs\/([^/]+)\/deletion-impact$/);
  return match ? { packId: decodeURIComponent(match[1]) } : null;
}

function matchPackCompatibilityUpgradeRoute(pathname) {
  const match = pathname.match(/^\/api\/resource-library\/packs\/([^/]+)\/compatibility-upgrade$/);
  return match ? { packId: decodeURIComponent(match[1]) } : null;
}

function matchPluginRoute(pathname) {
  const match = pathname.match(/^\/api\/plugins\/([^/]+)$/);
  return match ? { pluginId: decodeURIComponent(match[1]) } : null;
}
