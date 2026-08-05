export function createPluginRegistryController({
  state = {},
  els = {},
  apiRequest = async () => ({}),
  setStatus = () => {},
  humanizeApiError = (error) => error?.message || String(error),
  refreshRegistry = async () => {},
  documentObject = globalThis.document,
  confirmAction = (message) => globalThis.confirm?.(message) === true
} = {}) {
  function bindEvents() {
    els.pluginList?.addEventListener('click', handlePluginRegistryClick);
  }

  function renderPluginRegistry() {
    if (!els.pluginList) return;
    const plugins = Array.isArray(state.plugins) ? state.plugins : [];
    const localCount = plugins.filter((item) => item.origin === 'local').length;
    const enabledCount = plugins.filter((item) => item.enabled && item.compatible).length;
    if (els.pluginSummary) {
      els.pluginSummary.textContent = `${plugins.length} 个插件 · ${enabledCount} 个可用 · ${localCount} 个本地安装`;
    }
    els.pluginList.innerHTML = '';
    if (!plugins.length) {
      const empty = documentObject.createElement('div');
      empty.className = 'resource-empty-state compact';
      empty.innerHTML = '<strong>尚未载入插件清单</strong><span>刷新资源库，或导入 lra.plugin/v1 JSON 清单。</span>';
      els.pluginList.append(empty);
      return;
    }

    plugins.forEach((plugin) => {
      const item = documentObject.createElement('article');
      item.className = `plugin-registry-item${plugin.enabled ? '' : ' is-disabled'}`;
      const body = documentObject.createElement('div');
      body.className = 'plugin-registry-body';
      const heading = documentObject.createElement('div');
      heading.className = 'plugin-registry-heading';
      const name = documentObject.createElement('strong');
      name.textContent = plugin.name || plugin.id;
      const status = documentObject.createElement('span');
      const statusKind = !plugin.compatible ? 'warning' : plugin.enabled ? 'good' : 'muted';
      status.className = `plugin-registry-status is-${statusKind}`;
      status.textContent = !plugin.compatible ? '不兼容' : plugin.enabled ? '已启用' : '已停用';
      heading.append(name, status);
      const description = documentObject.createElement('p');
      description.textContent = plugin.manifest?.description || '未提供插件说明。';
      const meta = documentObject.createElement('small');
      meta.textContent = `${plugin.origin === 'core' ? '内置' : '本地'} · v${plugin.version || '0.0.0'} · ${plugin.runtime === 'declarative' ? '声明式运行时' : '未知运行时'} · ${Number(plugin.adapterCount || 0)} 个适配器 · ${Number(plugin.capabilityCount || 0)} 项受控能力`;
      body.append(heading, description, meta);
      if (plugin.blockingIssues?.length || plugin.warnings?.length) {
        const notice = documentObject.createElement('small');
        notice.className = 'plugin-registry-notice';
        notice.textContent = plugin.blockingIssues?.[0]?.message || plugin.warnings?.[0]?.message || '';
        body.append(notice);
      }

      const actions = documentObject.createElement('div');
      actions.className = 'plugin-registry-actions';
      if (plugin.origin === 'local') {
        const toggle = documentObject.createElement('button');
        toggle.type = 'button';
        toggle.className = 'ghost-button compact';
        toggle.dataset.pluginToggle = plugin.id;
        toggle.textContent = plugin.enabled ? '停用' : '启用';
        const remove = documentObject.createElement('button');
        remove.type = 'button';
        remove.className = 'ghost-button compact danger';
        remove.dataset.pluginDelete = plugin.id;
        remove.textContent = '移除';
        actions.append(toggle, remove);
      } else {
        const locked = documentObject.createElement('span');
        locked.className = 'plugin-core-label';
        locked.textContent = '随引擎提供';
        actions.append(locked);
      }
      item.append(body, actions);
      els.pluginList.append(item);
    });
  }

  function renderAdapterRegistry() {
    if (!els.adapterList) return;
    const adapters = Array.isArray(state.resourceAdapters) ? state.resourceAdapters : [];
    if (els.adapterCount) els.adapterCount.textContent = `${adapters.length} 个`;
    els.adapterList.innerHTML = '';
    adapters.forEach((adapter) => {
      const row = documentObject.createElement('div');
      row.className = 'adapter-registry-row';
      const body = documentObject.createElement('span');
      const title = documentObject.createElement('strong');
      title.textContent = adapter.label || adapter.id;
      const meta = documentObject.createElement('small');
      const kinds = Array.isArray(adapter.kinds) ? adapter.kinds.join(' / ') : 'resource';
      const formats = Array.isArray(adapter.formats) ? adapter.formats.join(', ') : '';
      meta.textContent = `${kinds} · ${formats || '自动识别'} · ${adapter.pluginName || adapter.pluginId}`;
      body.append(title, meta);
      const version = documentObject.createElement('small');
      version.textContent = `v${adapter.version || adapter.pluginVersion || '1.0.0'}`;
      row.append(body, version);
      els.adapterList.append(row);
    });
  }

  async function handlePluginRegistryClick(event) {
    const toggleButton = event.target?.closest?.('[data-plugin-toggle]');
    const deleteButton = event.target?.closest?.('[data-plugin-delete]');
    const button = toggleButton || deleteButton;
    if (!button) return;
    const pluginId = toggleButton?.dataset.pluginToggle || deleteButton?.dataset.pluginDelete;
    const plugin = (state.plugins || []).find((item) => item.id === pluginId);
    if (!plugin) return;
    if (deleteButton && !confirmAction(`移除扩展“${plugin.name || plugin.id}”？已入库素材不会被删除。`)) return;

    button.disabled = true;
    try {
      if (toggleButton) {
        await apiRequest(`/api/plugins/${encodeURIComponent(pluginId)}`, {
          method: 'PATCH',
          body: { enabled: !plugin.enabled }
        });
      } else {
        await apiRequest(`/api/plugins/${encodeURIComponent(pluginId)}`, { method: 'DELETE', body: {} });
      }
      await refreshRegistry();
      setStatus(
        els.resourceLibraryStatus,
        toggleButton ? `扩展已${plugin.enabled ? '停用' : '启用'}：${plugin.name}` : `扩展已移除：${plugin.name}`,
        'ok'
      );
    } catch (error) {
      setStatus(els.resourceLibraryStatus, `扩展操作失败：${humanizeApiError(error)}`, 'error');
      button.disabled = false;
    }
  }

  return {
    bindEvents,
    renderAdapterRegistry,
    renderPluginRegistry
  };
}
