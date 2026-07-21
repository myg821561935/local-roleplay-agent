export function createMcpController({ els, apiRequest, setStatus, escapeHtmlText } = {}) {
  let serversCache = [];
  let toolsCache = [];

  async function render() {
    if (!els.mcpServersList && !els.mcpToolsList) return;
    try {
      const [{ servers }, { tools }] = await Promise.all([
        apiRequest('/api/mcp/servers'),
        apiRequest('/api/mcp/tools').catch(() => ({ tools: [] }))
      ]);
      serversCache = Array.isArray(servers) ? servers : [];
      toolsCache = Array.isArray(tools) ? tools : [];
    } catch {
      serversCache = [];
      toolsCache = [];
    }
    renderServers();
    renderTools();
  }

  function renderServers() {
    if (!els.mcpServersList) return;
    if (!serversCache.length) {
      els.mcpServersList.innerHTML = '<div class="module-empty-note">尚未配置 MCP server</div>';
      return;
    }
    els.mcpServersList.innerHTML = serversCache.map((server) => {
      const id = escapeHtmlText(server.id);
      const name = escapeHtmlText(server.name || server.id);
      const connected = server.connected ? '<span class="is-ok">已连接</span>' : '<span class="module-muted">未连接</span>';
      const enabled = server.enabled ? '' : '<span class="is-error">(已禁用)</span>';
      const lastError = server.lastError ? `<div class="module-inline-error">${escapeHtmlText(server.lastError)}</div>` : '';
      return `<div class="mcp-server-row">
        <div class="mcp-server-heading">
          <div><strong>${name}</strong> <span class="module-code-label">[${id}]</span> ${enabled}</div>
          <div>${connected} · ${Number(server.toolCount || 0)} 工具</div>
        </div>
        ${lastError}
        <div class="mcp-server-actions">
          <button class="ghost-button compact" type="button" data-mcp-action="connect" data-mcp-id="${id}">连接</button>
          <button class="ghost-button compact" type="button" data-mcp-action="disconnect" data-mcp-id="${id}">断开</button>
          <button class="ghost-button compact" type="button" data-mcp-action="edit" data-mcp-id="${id}">编辑</button>
          <button class="ghost-button compact" type="button" data-mcp-action="delete" data-mcp-id="${id}">删除</button>
        </div>
      </div>`;
    }).join('');
    els.mcpServersList.querySelectorAll('[data-mcp-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.dataset.mcpAction;
        const id = button.dataset.mcpId;
        if (action === 'connect') connect(id);
        else if (action === 'disconnect') disconnect(id);
        else if (action === 'edit') edit(id);
        else if (action === 'delete') remove(id);
      });
    });
  }

  function renderTools() {
    if (!els.mcpToolsList) return;
    if (!toolsCache.length) {
      els.mcpToolsList.innerHTML = '<div class="module-empty-note">暂无可用工具，请连接 server 后刷新</div>';
      return;
    }
    els.mcpToolsList.innerHTML = toolsCache.map((tool) => {
      const server = escapeHtmlText(tool.serverId);
      const name = escapeHtmlText(tool.toolName);
      const description = escapeHtmlText(tool.description || '').slice(0, 80);
      return `<div class="mcp-tool-row">
        <div><strong>${name}</strong> <span class="module-code-label">@${server}</span></div>
        ${description ? `<div class="module-muted">${description}</div>` : ''}
      </div>`;
    }).join('');
  }

  function edit(id) {
    const server = serversCache.find((item) => item.id === id);
    if (!server) return;
    if (els.mcpEditId) {
      els.mcpEditId.value = server.id;
      els.mcpEditId.disabled = true;
    }
    if (els.mcpEditName) els.mcpEditName.value = server.name || '';
    if (els.mcpEditCommand) els.mcpEditCommand.value = server.command || '';
    if (els.mcpEditArgs) els.mcpEditArgs.value = Array.isArray(server.args) ? server.args.join(' ') : '';
    if (els.mcpEditEnabled) els.mcpEditEnabled.checked = server.enabled !== false;
    if (els.mcpCallServerId && !els.mcpCallServerId.value) els.mcpCallServerId.value = server.id;
  }

  function clearForm() {
    if (els.mcpEditId) {
      els.mcpEditId.value = '';
      els.mcpEditId.disabled = false;
    }
    if (els.mcpEditName) els.mcpEditName.value = '';
    if (els.mcpEditCommand) els.mcpEditCommand.value = '';
    if (els.mcpEditArgs) els.mcpEditArgs.value = '';
    if (els.mcpEditEnabled) els.mcpEditEnabled.checked = true;
  }

  async function save() {
    const id = (els.mcpEditId?.value || '').trim();
    const command = (els.mcpEditCommand?.value || '').trim();
    if (!id || !command) {
      setStatus(els.providerStatus, !id ? '请填写 MCP Server ID' : '请填写启动命令', 'error');
      return;
    }
    const serverConfig = {
      id,
      name: (els.mcpEditName?.value || '').trim() || id,
      transport: 'stdio',
      command,
      args: (els.mcpEditArgs?.value || '').trim().split(/\s+/).filter(Boolean),
      enabled: els.mcpEditEnabled?.checked !== false
    };
    try {
      setStatus(els.providerStatus, '正在保存...', 'busy');
      const remaining = serversCache.filter((server) => server.id !== id);
      remaining.push({ ...serverConfig, connected: false, toolCount: 0 });
      const { servers } = await apiRequest('/api/mcp/servers', { method: 'PUT', body: { servers: remaining } });
      serversCache = servers || [];
      renderServers();
      clearForm();
      setStatus(els.providerStatus, 'MCP 配置已保存', 'ok');
    } catch (error) {
      setStatus(els.providerStatus, `保存失败：${error.message}`, 'error');
    }
  }

  async function remove(id) {
    try {
      setStatus(els.providerStatus, '正在删除...', 'busy');
      const { servers } = await apiRequest('/api/mcp/servers', {
        method: 'PUT',
        body: { servers: serversCache.filter((server) => server.id !== id) }
      });
      serversCache = servers || [];
      renderServers();
      renderTools();
      setStatus(els.providerStatus, 'MCP Server 已删除', 'ok');
    } catch (error) {
      setStatus(els.providerStatus, `删除失败：${error.message}`, 'error');
    }
  }

  async function connect(id) {
    try {
      setStatus(els.providerStatus, `正在连接 ${id}...`, 'busy');
      const { tools } = await apiRequest(`/api/mcp/servers/${encodeURIComponent(id)}/connect`, { method: 'POST' });
      setStatus(els.providerStatus, `${id} 已连接，共 ${tools?.length || 0} 个工具`, 'ok');
      await render();
    } catch (error) {
      setStatus(els.providerStatus, `连接失败：${error.message}`, 'error');
    }
  }

  async function disconnect(id) {
    try {
      await apiRequest(`/api/mcp/servers/${encodeURIComponent(id)}/disconnect`, { method: 'POST' });
      setStatus(els.providerStatus, `${id} 已断开`, 'ok');
      await render();
    } catch (error) {
      setStatus(els.providerStatus, `断开失败：${error.message}`, 'error');
    }
  }

  async function callTool() {
    if (!els.mcpCallResult) return;
    const serverId = (els.mcpCallServerId?.value || '').trim();
    const toolName = (els.mcpCallToolName?.value || '').trim();
    if (!serverId || !toolName) {
      els.mcpCallResult.innerHTML = '<div class="module-inline-error">请填写 Server ID 和工具名</div>';
      return;
    }
    let args = {};
    try {
      args = (els.mcpCallArgs?.value || '').trim() ? JSON.parse(els.mcpCallArgs.value) : {};
    } catch {
      els.mcpCallResult.innerHTML = '<div class="module-inline-error">参数不是有效的 JSON</div>';
      return;
    }
    els.mcpCallResult.innerHTML = '<div class="module-empty-note">调用中...</div>';
    if (els.mcpCallExecute) els.mcpCallExecute.disabled = true;
    try {
      const { result } = await apiRequest('/api/mcp/tools/call', {
        method: 'POST', body: { serverId, toolName, arguments: args }
      });
      els.mcpCallResult.innerHTML = `<details><summary>调用成功</summary><pre>${escapeHtmlText(JSON.stringify(result, null, 2))}</pre></details>`;
    } catch (error) {
      els.mcpCallResult.innerHTML = `<div class="module-inline-error">调用失败：${escapeHtmlText(error.message)}</div>`;
    } finally {
      if (els.mcpCallExecute) els.mcpCallExecute.disabled = false;
    }
  }

  function bindEvents() {
    els.mcpSaveServer?.addEventListener('click', save);
    els.mcpClearForm?.addEventListener('click', clearForm);
    els.mcpCallExecute?.addEventListener('click', callTool);
  }

  return { bindEvents, render, save, clearForm, callTool };
}
