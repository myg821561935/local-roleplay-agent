import { writeJson } from '../lib/http.js';
import {
  readRequestJson,
  validateMutatingRequest
} from './http.js';

export async function handleChatRoutes({
  req,
  res,
  url,
  agentService,
  operations
}) {
  if (req.method === 'POST' && url.pathname === '/api/rewrite') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const result = await operations.rewriteText({ agentService, body });
    writeJson(res, 200, result);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/chat') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const result = await operations.sendChat({ agentService, body });
    writeJson(res, 200, result);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/chat/stream') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    await operations.streamChat({ agentService, body, res });
    return true;
  }

  const messageRoute = operations.matchMessageRoute(url.pathname);
  if (messageRoute && req.method === 'PATCH' && messageRoute.action === 'edit') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const result = await operations.editMessage({ agentService, body, messageId: messageRoute.messageId });
    writeJson(res, 200, result);
    return true;
  }

  if (messageRoute && req.method === 'POST' && messageRoute.action === 'regenerate') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const result = await operations.regenerateMessage({ agentService, body, messageId: messageRoute.messageId });
    writeJson(res, 200, result);
    return true;
  }

  if (messageRoute && req.method === 'POST' && messageRoute.action === 'visibility') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const result = await operations.toggleMessageVisibility({ agentService, body, messageId: messageRoute.messageId });
    writeJson(res, 200, result);
    return true;
  }

  if (messageRoute && req.method === 'POST' && messageRoute.action === 'swipe') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const result = await operations.switchMessageSwipe({ agentService, body, messageId: messageRoute.messageId });
    writeJson(res, 200, result);
    return true;
  }

  if (
    messageRoute
    && (req.method === 'POST' || req.method === 'DELETE')
    && messageRoute.action === 'bookmark'
  ) {
    validateMutatingRequest(req);
    const body = req.method === 'DELETE' ? {} : await readRequestJson(req);
    const result = await operations.toggleMessageBookmark({
      agentService,
      body,
      messageId: messageRoute.messageId
    });
    writeJson(res, 200, result);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/chat/continue') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    await operations.streamContinue({ agentService, body, res });
    return true;
  }

  return false;
}
