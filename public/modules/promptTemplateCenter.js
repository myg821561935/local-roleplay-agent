export function createPromptTemplateCenterController({
  state = {},
  els = {},
  apiRequest = async () => ({}),
  getCurrentSessionId = () => 'main',
  setStatus = () => {},
  humanizeApiError = (error) => error?.message || String(error),
  escapeHtmlText = escapeHtml,
  setPromptDraft = () => false,
  confirmAction = () => true
} = {}) {
  let eventsBound = false;
  let loadedSessionId = '';
  let loading = false;
  let catalog = [];
  let context = {};
  let selectedTemplateId = '';
  let parameterValues = {};
  let preview = null;

  function selectedTemplate() {
    return catalog.find((template) => template.id === selectedTemplateId) || null;
  }

  async function load({ force = false } = {}) {
    const sessionId = getCurrentSessionId();
    if (loading || (!force && loadedSessionId === sessionId && catalog.length)) return false;
    loading = true;
    loadedSessionId = sessionId;
    renderLoading();
    try {
      const payload = await apiRequest(`/api/prompt-templates?sessionId=${encodeURIComponent(sessionId)}`);
      catalog = Array.isArray(payload?.templates) ? payload.templates : [];
      context = payload?.context && typeof payload.context === 'object' ? payload.context : {};
      const previousSelection = catalog.find((template) => template.id === selectedTemplateId)?.id;
      selectedTemplateId = previousSelection || payload?.recommendedTemplateId || catalog[0]?.id || '';
      resetParameters();
      preview = null;
      render();
      return true;
    } catch (error) {
      catalog = [];
      renderError(`模板载入失败：${humanizeApiError(error)}`);
      return false;
    } finally {
      loading = false;
    }
  }

  function resetParameters() {
    const template = selectedTemplate();
    parameterValues = Object.fromEntries((template?.parameters || []).map((parameter) => [
      parameter.id,
      parameter.defaultValue
    ]));
  }

  function selectTemplate(templateId) {
    if (!catalog.some((template) => template.id === templateId)) return false;
    selectedTemplateId = templateId;
    preview = null;
    resetParameters();
    render();
    return true;
  }

  function setParameterValue(parameterId, value) {
    const parameter = selectedTemplate()?.parameters?.find((item) => item.id === parameterId);
    if (!parameter?.options?.some((option) => option.value === value)) return false;
    parameterValues = { ...parameterValues, [parameterId]: value };
    preview = null;
    renderDetail();
    return true;
  }

  async function previewSelected() {
    const template = selectedTemplate();
    if (!template || loading) return null;
    setBusy(true);
    setStatus(els.promptTemplateStatus, '正在检查模块变化与冲突...', 'busy');
    try {
      preview = await apiRequest('/api/prompt-templates/preview', {
        method: 'POST',
        body: requestBody()
      });
      renderPreview();
      setStatus(els.promptTemplateStatus, '预览已更新，尚未修改当前故事', 'ok');
      return preview;
    } catch (error) {
      preview = null;
      renderPreview();
      setStatus(els.promptTemplateStatus, `预览失败：${humanizeApiError(error)}`, 'error');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function applySelected() {
    const template = selectedTemplate();
    if (!template || loading) return null;
    if (!preview) {
      const result = await previewSelected();
      if (!result) return null;
    }
    const mode = els.promptTemplateApplyMode?.value === 'replace' ? 'replace' : 'append';
    if (mode === 'replace' && !confirmAction('替换模板层会移除其他由模板中心添加的模块；角色卡和社区预设不会被删除。确认继续？')) {
      return null;
    }
    setBusy(true);
    setStatus(els.promptTemplateStatus, '正在应用到当前故事...', 'busy');
    try {
      const payload = await apiRequest('/api/prompt-templates/apply', {
        method: 'POST',
        body: requestBody()
      });
      if (!Array.isArray(payload?.promptModules)) throw new Error('INVALID_PROMPT_MODULES_RESPONSE');
      if (!state.config || typeof state.config !== 'object') state.config = {};
      state.config.promptModules = payload.promptModules;
      setPromptDraft(payload.promptModules, { dirty: false });
      if (Array.isArray(payload.templates)) catalog = payload.templates;
      preview = payload.preview || null;
      render();
      setStatus(els.promptTemplateStatus, `已应用「${template.title}」，从下一轮对话生效`, 'ok');
      return payload.promptModules;
    } catch (error) {
      setStatus(els.promptTemplateStatus, `应用失败：${humanizeApiError(error)}`, 'error');
      return null;
    } finally {
      setBusy(false);
    }
  }

  function requestBody() {
    return {
      sessionId: getCurrentSessionId(),
      templateId: selectedTemplateId,
      parameters: parameterValues,
      mode: els.promptTemplateApplyMode?.value === 'replace' ? 'replace' : 'append'
    };
  }

  function render() {
    const sessionId = getCurrentSessionId();
    if (loadedSessionId !== sessionId) {
      catalog = [];
      preview = null;
      void load({ force: true });
      return false;
    }
    renderSummary();
    renderGrid();
    renderDetail();
    return true;
  }

  function renderLoading() {
    if (els.promptTemplateGrid) {
      els.promptTemplateGrid.innerHTML = '<p class="prompt-template-empty">正在匹配当前角色卡、世界书与会话配置...</p>';
    }
    if (els.promptTemplateDetail) els.promptTemplateDetail.hidden = true;
  }

  function renderError(message) {
    if (els.promptTemplateGrid) {
      els.promptTemplateGrid.innerHTML = `<p class="prompt-template-empty is-error">${escapeHtmlText(message)}</p>`;
    }
    if (els.promptTemplateDetail) els.promptTemplateDetail.hidden = true;
  }

  function renderSummary() {
    if (!els.promptTemplateSummary) return;
    const pieces = [
      context.hasCharacterCard ? `角色：${context.characterName}` : '角色卡信息不足',
      `${Number(context.worldBookCount || 0)} 条世界书`,
      `${Number(context.promptModuleCount || 0)} 个现有模块`
    ];
    if (context.communityPreset) pieces.push('社区预设已保留');
    if (context.lightFrontendActive) pieces.push('检测到轻前端');
    els.promptTemplateSummary.textContent = pieces.join(' · ');
  }

  function renderGrid() {
    if (!els.promptTemplateGrid) return;
    if (!catalog.length) {
      els.promptTemplateGrid.innerHTML = '<p class="prompt-template-empty">暂无可用模板</p>';
      return;
    }
    els.promptTemplateGrid.innerHTML = catalog.map((template, index) => {
      const selected = template.id === selectedTemplateId;
      const fit = compatibilityLabel(template.compatibility?.score);
      return `
        <button class="prompt-template-card${selected ? ' is-selected' : ''}${template.active ? ' is-active' : ''}" type="button" data-prompt-template-id="${escapeHtmlText(template.id)}" aria-pressed="${selected}">
          <span class="prompt-template-card-index">${String(index + 1).padStart(2, '0')}</span>
          <span class="prompt-template-card-copy">
            <span class="prompt-template-card-meta"><b>${escapeHtmlText(template.category)}</b><em data-fit="${fit.tone}">${fit.label} ${Number(template.compatibility?.score || 0)}%</em></span>
            <strong>${escapeHtmlText(template.title)}${template.active ? '<i>已应用</i>' : ''}</strong>
            <small>${escapeHtmlText(template.summary)}</small>
          </span>
        </button>`;
    }).join('');
  }

  function renderDetail() {
    const template = selectedTemplate();
    if (!els.promptTemplateDetail) return;
    els.promptTemplateDetail.hidden = !template;
    if (!template) return;
    if (els.promptTemplateDetailTitle) els.promptTemplateDetailTitle.textContent = template.title;
    if (els.promptTemplateDetailDescription) els.promptTemplateDetailDescription.textContent = template.bestFor;
    if (els.promptTemplateReasons) {
      els.promptTemplateReasons.innerHTML = (template.compatibility?.reasons || [])
        .map((reason) => `<li>${escapeHtmlText(reason)}</li>`)
        .join('');
    }
    if (els.promptTemplateParameters) {
      els.promptTemplateParameters.innerHTML = (template.parameters || []).map((parameter) => `
        <label class="prompt-template-parameter">
          <span>${escapeHtmlText(parameter.label)}</span>
          <select class="form-input" data-prompt-template-param="${escapeHtmlText(parameter.id)}">
            ${(parameter.options || []).map((option) => `<option value="${escapeHtmlText(option.value)}"${parameterValues[parameter.id] === option.value ? ' selected' : ''}>${escapeHtmlText(option.label)} · ${escapeHtmlText(option.description)}</option>`).join('')}
          </select>
        </label>`).join('');
    }
    renderPreview();
  }

  function renderPreview() {
    if (!els.promptTemplatePreview) return;
    if (!preview) {
      els.promptTemplatePreview.innerHTML = '<p>先预览再应用；当前故事不会因预览发生变化。</p>';
      if (els.applyPromptTemplate) els.applyPromptTemplate.disabled = true;
      return;
    }
    const changes = preview.changes || {};
    const warnings = Array.isArray(preview.warnings) ? preview.warnings : [];
    const delta = Number(changes.estimatedTokenDelta || 0);
    els.promptTemplatePreview.innerHTML = `
      <div class="prompt-template-change-ledger">
        <span><b>+${Number(changes.added || 0)}</b> 新增</span>
        <span><b>${Number(changes.updated || 0)}</b> 更新</span>
        <span><b>${Number(changes.removedTemplateModules || 0)}</b> 移除旧模板</span>
        <span><b>${delta >= 0 ? '+' : ''}${delta}</b> 预计 tokens</span>
      </div>
      <p>${Number(changes.currentModuleCount || 0)} → ${Number(changes.nextModuleCount || 0)} 个模块；角色卡、世界书和社区模块保持原位。</p>
      ${warnings.length ? `<ul class="prompt-template-warnings">${warnings.map((warning) => `<li>${escapeHtmlText(warning)}</li>`).join('')}</ul>` : ''}`;
    if (els.applyPromptTemplate) els.applyPromptTemplate.disabled = false;
  }

  function setBusy(busy) {
    loading = busy;
    if (els.previewPromptTemplate) els.previewPromptTemplate.disabled = busy;
    if (els.applyPromptTemplate) els.applyPromptTemplate.disabled = busy || !preview;
  }

  function bindEvents() {
    if (eventsBound) return false;
    eventsBound = true;
    els.promptTemplateGrid?.addEventListener('click', (event) => {
      const card = event.target.closest?.('[data-prompt-template-id]');
      if (card) selectTemplate(card.dataset.promptTemplateId);
    });
    els.promptTemplateParameters?.addEventListener('change', (event) => {
      const input = event.target.closest?.('[data-prompt-template-param]');
      if (input) setParameterValue(input.dataset.promptTemplateParam, input.value);
    });
    els.promptTemplateApplyMode?.addEventListener('change', () => {
      preview = null;
      renderPreview();
    });
    els.previewPromptTemplate?.addEventListener('click', () => void previewSelected());
    els.applyPromptTemplate?.addEventListener('click', () => void applySelected());
    return true;
  }

  return {
    applySelected,
    bindEvents,
    getCatalog: () => catalog,
    getPreview: () => preview,
    load,
    previewSelected,
    render,
    selectTemplate,
    setParameterValue
  };
}

export function compatibilityLabel(score) {
  const value = Number(score || 0);
  if (value >= 90) return { label: '高度适配', tone: 'excellent' };
  if (value >= 75) return { label: '适合', tone: 'good' };
  if (value >= 55) return { label: '可用', tone: 'fair' };
  return { label: '按需', tone: 'low' };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
