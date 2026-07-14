import { test } from 'node:test';
import assert from 'node:assert/strict';
import { McpRegistry } from '../server/mcp/mcpRegistry.js';

function createMockTransportFactory(tools = [], callResult = {}) {
  return async (config) => ({
    listTools: async () => tools,
    callTool: async ({ name, arguments: args }) => ({ name, args, result: callResult }),
    close: () => {}
  });
}

test('McpRegistry.upsertConfig normalizes and stores config', () => {
  const registry = new McpRegistry();
  const config = registry.upsertConfig({
    id: 'filesystem',
    name: 'Filesystem MCP',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    env: { DEBUG: '1' }
  });
  assert.equal(config.id, 'filesystem');
  assert.equal(config.name, 'Filesystem MCP');
  assert.equal(config.transport, 'stdio');
  assert.equal(config.command, 'npx');
  assert.deepEqual(config.args, ['-y', '@modelcontextprotocol/server-filesystem', '/tmp']);
  assert.equal(config.enabled, true);
});

test('McpRegistry.upsertConfig rejects missing id', () => {
  const registry = new McpRegistry();
  assert.throws(() => registry.upsertConfig({ name: 'no id' }), /MCP_CONFIG_MISSING_ID/);
});

test('McpRegistry.upsertConfig normalizes invalid transport to stdio', () => {
  const registry = new McpRegistry();
  const config = registry.upsertConfig({ id: 's1', transport: 'invalid-transport' });
  assert.equal(config.transport, 'stdio');
});

test('McpRegistry.listServers returns registered servers', () => {
  const registry = new McpRegistry();
  registry.upsertConfig({ id: 's1', name: 'Server 1' });
  registry.upsertConfig({ id: 's2', name: 'Server 2', enabled: false });
  const servers = registry.listServers();
  assert.equal(servers.length, 2);
  assert.equal(servers[0].id, 's1');
  assert.equal(servers[1].enabled, false);
});

test('McpRegistry.connect uses transportFactory and lists tools', async () => {
  const registry = new McpRegistry({
    transportFactory: createMockTransportFactory([
      { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } }
    ])
  });
  registry.upsertConfig({ id: 's1', name: 'Test Server' });
  const tools = await registry.connect('s1');
  assert.equal(tools.length, 1);
  assert.equal(tools[0].toolName, 'read_file');
  assert.equal(tools[0].serverId, 's1');
  assert.equal(tools[0].serverName, 'Test Server');
});

test('McpRegistry.connect throws when server not found', async () => {
  const registry = new McpRegistry({ transportFactory: createMockTransportFactory() });
  await assert.rejects(registry.connect('missing'), /MCP_SERVER_NOT_FOUND/);
});

test('McpRegistry.connect throws when server disabled', async () => {
  const registry = new McpRegistry({ transportFactory: createMockTransportFactory() });
  registry.upsertConfig({ id: 's1', enabled: false });
  await assert.rejects(registry.connect('s1'), /MCP_SERVER_DISABLED/);
});

test('McpRegistry.callTool routes to correct server', async () => {
  const registry = new McpRegistry({
    transportFactory: createMockTransportFactory([{ name: 'echo' }], { ok: true })
  });
  registry.upsertConfig({ id: 's1' });
  await registry.connect('s1');
  const result = await registry.callTool({ serverId: 's1', toolName: 'echo', arguments: { msg: 'hi' } });
  assert.equal(result.name, 'echo');
  assert.deepEqual(result.args, { msg: 'hi' });
});

test('McpRegistry.listAllTools aggregates from all connected servers', async () => {
  const registry = new McpRegistry({
    transportFactory: createMockTransportFactory([{ name: 'tool_a' }])
  });
  registry.upsertConfig({ id: 's1' });
  registry.upsertConfig({ id: 's2' });
  await registry.connect('s1');
  await registry.connect('s2');
  const all = registry.listAllTools();
  assert.equal(all.length, 2);
  assert.equal(all[0].serverId, 's1');
  assert.equal(all[1].serverId, 's2');
});

test('McpRegistry.removeServer closes connection and removes config', async () => {
  const registry = new McpRegistry({ transportFactory: createMockTransportFactory([{ name: 'x' }]) });
  registry.upsertConfig({ id: 's1' });
  await registry.connect('s1');
  registry.removeServer('s1');
  assert.equal(registry.listServers().length, 0);
  assert.equal(registry.listAllTools().length, 0);
});

test('McpRegistry.callTool rejects when server not connected', async () => {
  const registry = new McpRegistry();
  registry.upsertConfig({ id: 's1' });
  await assert.rejects(
    registry.callTool({ serverId: 's1', toolName: 'x' }),
    /MCP_SERVER_NOT_CONNECTED/
  );
});

test('McpRegistry.connect handles transportFactory error', async () => {
  const registry = new McpRegistry({
    transportFactory: async () => { throw new Error('spawn failed'); }
  });
  registry.upsertConfig({ id: 's1' });
  await assert.rejects(registry.connect('s1'), /spawn failed/);
});

test('McpRegistry.connect records lastError when listTools fails', async () => {
  const registry = new McpRegistry({
    transportFactory: async () => ({
      listTools: async () => { throw new Error('list failed'); },
      callTool: async () => ({}),
      close: () => {}
    })
  });
  registry.upsertConfig({ id: 's1' });
  await registry.connect('s1');
  const servers = registry.listServers();
  assert.equal(servers[0].lastError, 'list failed');
  assert.equal(servers[0].toolCount, 0);
});
