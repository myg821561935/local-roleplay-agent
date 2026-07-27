import { writeJson } from '../lib/http.js';
import {
  readRequestJson,
  validateMutatingRequest
} from './http.js';

export async function handleMcpRoutes({
  req,
  res,
  url,
  configService,
  mcpRegistry
}) {
  if (!url.pathname.startsWith('/api/mcp/')) return false;

  if (req.method === 'GET' && url.pathname === '/api/mcp/servers') {
    writeJson(res, 200, { servers: mcpRegistry.listServers() });
    return true;
  }

  if (req.method === 'PUT' && url.pathname === '/api/mcp/servers') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const saved = await configService.saveMcpServers(body.servers || []);
    const existingIds = new Set(saved.map((server) => server.id));
    Array.from(mcpRegistry.connections.keys()).forEach((id) => {
      if (!existingIds.has(id)) mcpRegistry.removeServer(id);
    });
    saved.forEach((server) => mcpRegistry.upsertConfig(server));
    writeJson(res, 200, { servers: saved });
    return true;
  }

  const connectMatch = url.pathname.match(/^\/api\/mcp\/servers\/([^/]+)\/connect$/);
  if (connectMatch && req.method === 'POST') {
    validateMutatingRequest(req);
    const id = decodeURIComponent(connectMatch[1]);
    const tools = await mcpRegistry.connect(id);
    writeJson(res, 200, { tools });
    return true;
  }

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
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/mcp/tools') {
    writeJson(res, 200, { tools: mcpRegistry.listAllTools() });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/mcp/tools/call') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const result = await mcpRegistry.callTool({
      serverId: String(body.serverId || '').trim(),
      toolName: String(body.toolName || '').trim(),
      arguments: body.arguments || {}
    });
    writeJson(res, 200, { result });
    return true;
  }

  return false;
}
