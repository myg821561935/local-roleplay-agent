import { writeJson } from '../lib/http.js';
import { ApiError } from './http.js';

export async function handleKnowledgeGraphRoutes({
  req,
  res,
  url,
  sessionId,
  subPath,
  sessionService,
  knowledgeGraphService
}) {
  if (!knowledgeGraphService) return false;
  if (subPath === 'knowledge-graph' && req.method === 'GET') {
    const view = url.searchParams.get('view') === 'director' ? 'director' : 'player';
    const depth = clampDepth(url.searchParams.get('depth'));
    if (url.searchParams.get('mode') === 'preview') {
      const session = await getSession(sessionService, sessionId, { hydrateKnowledgeGraph: false });
      writeJson(res, 200, { preview: knowledgeGraphService.previewSession(session) });
      return true;
    }
    const session = await getSession(sessionService, sessionId);
    writeJson(res, 200, {
      graph: knowledgeGraphService.projectSession(session, { view, depth })
    });
    return true;
  }

  if (subPath === 'knowledge-graph/mutations' && req.method === 'GET') {
    await getSession(sessionService, sessionId);
    const limit = clampLimit(url.searchParams.get('limit'));
    writeJson(res, 200, {
      mutations: knowledgeGraphService.listMutations(sessionId, { limit })
    });
    return true;
  }
  return false;
}

async function getSession(sessionService, sessionId, options) {
  try {
    return await sessionService.getSession(sessionId, options);
  } catch (error) {
    if (error.message === 'Invalid session id') throw new ApiError(400, 'INVALID_SESSION_ID');
    throw error;
  }
}

function clampDepth(value) {
  const depth = Number(value);
  return Number.isFinite(depth) ? Math.max(0, Math.min(4, Math.floor(depth))) : 2;
}

function clampLimit(value) {
  const limit = Number(value);
  return Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.floor(limit))) : 100;
}
