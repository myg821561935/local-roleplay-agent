// 向量记忆面板控制器：从 app.js 抽取的 6 个函数。
// 依赖通过工厂参数注入，遵循现有模块范式（参考 visualStage.js）。

export function createVectorMemoryController({
  state,
  els,
  apiRequest,
  setStatus,
  getSessionId
}) {
  function populateVectorMemoryProviderOptions() {
    if (!els.vectorMemoryProvider) return;
    const providers = Array.isArray(state.config?.providers?.providers) ? state.config.providers.providers : [];
    const current = els.vectorMemoryProvider.value;
    els.vectorMemoryProvider.innerHTML = '';
    const noneOption = document.createElement('option');
    noneOption.value = '';
    noneOption.textContent = '使用全局默认 Provider';
    els.vectorMemoryProvider.appendChild(noneOption);
    providers.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.id} (${p.kind})`;
      els.vectorMemoryProvider.appendChild(opt);
    });
    if (current) els.vectorMemoryProvider.value = current;
  }

  function renderVectorMemoryPanel() {
    const cfg = state.config?.vectorMemory || {};
    if (els.vectorMemoryEnabled) els.vectorMemoryEnabled.checked = Boolean(cfg.enabled);
    if (els.vectorMemoryProvider) {
      populateVectorMemoryProviderOptions();
      els.vectorMemoryProvider.value = String(cfg.providerId || '');
    }
    if (els.vectorMemoryTopK) els.vectorMemoryTopK.value = Number(cfg.topK ?? 5);
    refreshVectorStats();
  }

  async function saveVectorMemory() {
    try {
      const payload = {
        enabled: els.vectorMemoryEnabled?.checked || false,
        providerId: els.vectorMemoryProvider?.value || '',
        topK: Math.max(1, Math.min(20, Number(els.vectorMemoryTopK?.value || 5)))
      };
      const { vectorMemory } = await apiRequest('/api/vector-memory', { method: 'PUT', body: { vectorMemory: payload } });
      if (!state.config) state.config = {};
      state.config.vectorMemory = vectorMemory;
      setStatus(els.providerStatus, '向量记忆配置已保存', 'ok');
      refreshVectorStats();
    } catch (error) {
      setStatus(els.providerStatus, `保存失败：${error.message}`, 'error');
    }
  }

  async function rebuildVectorIndex() {
    try {
      if (!els.rebuildVectorIndex) return;
      els.rebuildVectorIndex.disabled = true;
      setStatus(els.providerStatus, '正在重建索引...', 'busy');
      const result = await apiRequest('/api/vector-memory/rebuild', {
        method: 'POST',
        body: { sessionId: getSessionId() }
      });
      setStatus(els.providerStatus, `索引重建完成，已索引 ${result.indexed || 0} 条消息`, 'ok');
      refreshVectorStats();
    } catch (error) {
      setStatus(els.providerStatus, `重建失败：${error.message}`, 'error');
    } finally {
      els.rebuildVectorIndex.disabled = false;
    }
  }

  async function refreshVectorStats() {
    if (!els.vectorStatsText) return;
    try {
      const { stats } = await apiRequest(`/api/vector-memory/stats?sessionId=${encodeURIComponent(getSessionId())}`);
      const status = !stats.configured ? '未启用' : (!stats.providerReady ? '未配置 Provider' : `已索引 ${stats.indexed} 条`);
      els.vectorStatsText.textContent = status;
      els.vectorStatsText.style.color = stats.configured && stats.providerReady ? 'var(--gold, #f5d58d)' : 'var(--subtle)';
    } catch {
      els.vectorStatsText.textContent = '查询失败';
    }
  }

  async function testVectorSearch() {
    if (!els.vectorSearchInput || !els.vectorSearchResults) return;
    const query = els.vectorSearchInput.value.trim();
    if (!query) {
      els.vectorSearchResults.innerHTML = '<div style="color: var(--subtle);">请输入查询文本</div>';
      return;
    }
    els.vectorSearchResults.innerHTML = '<div style="color: var(--subtle);">检索中...</div>';
    try {
      const { hits } = await apiRequest('/api/vector-memory/search', {
        method: 'POST',
        body: { sessionId: getSessionId(), query, topK: Number(els.vectorMemoryTopK?.value || 5) }
      });
      if (!Array.isArray(hits) || hits.length === 0) {
        els.vectorSearchResults.innerHTML = '<div style="color: var(--subtle);">无匹配结果</div>';
        return;
      }
      els.vectorSearchResults.innerHTML = hits.map((hit, idx) => {
        const score = (hit.score || 0).toFixed(3);
        const role = String(hit.role || 'user').slice(0, 16);
        const content = String(hit.content || '').slice(0, 100).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
        return `<div style="padding: 6px; margin-bottom: 4px; border-left: 2px solid var(--gold, #f5d58d); padding-left: 8px;">
        <div style="color: var(--subtle);">#${idx + 1} [${role}] 相似度 ${score}</div>
        <div style="white-space: pre-wrap; word-break: break-word;">${content}...</div>
      </div>`;
      }).join('');
    } catch (error) {
      els.vectorSearchResults.innerHTML = `<div style="color: #f88;">检索失败：${error.message}</div>`;
    }
  }

  return {
    renderVectorMemoryPanel,
    saveVectorMemory,
    rebuildVectorIndex,
    testVectorSearch
  };
}
