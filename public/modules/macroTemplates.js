// 宏模板面板控制器：从 app.js 抽取的 5 个函数。
// 依赖通过工厂参数注入，遵循现有模块范式（参考 visualStage.js）。

import { humanizeApiError } from './utils.js';

export function createMacroTemplatesController({
  state,
  els,
  apiRequest,
  setStatus
}) {
  function renderMacroTemplates() {
    if (!els.macroTemplatesList) return;
    const templates = Array.isArray(state.config?.macroTemplates) ? state.config.macroTemplates : [];
    els.macroTemplatesList.innerHTML = '';
    if (!templates.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.style.padding = '12px';
      empty.textContent = '暂无宏模板，点击「+ 新增模板」创建。';
      els.macroTemplatesList.append(empty);
      return;
    }
    templates.forEach((tpl, index) => {
      const row = document.createElement('div');
      row.className = 'group-member-row';

      const head = document.createElement('div');
      head.style.cssText = 'display: flex; gap: 8px; align-items: center;';

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'form-input';
      nameInput.placeholder = '模板名（如 wuxia_intro）';
      nameInput.value = tpl.name || '';
      nameInput.dataset.macroField = 'name';
      nameInput.dataset.macroIndex = String(index);
      nameInput.style.cssText = 'flex: 1; min-width: 0;';
      head.append(nameInput);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'ghost-button compact';
      del.textContent = '删除';
      del.dataset.delMacro = String(index);
      del.addEventListener('click', () => {
        const arr = Array.isArray(state.config?.macroTemplates) ? [...state.config.macroTemplates] : [];
        arr.splice(index, 1);
        state.config.macroTemplates = arr;
        renderMacroTemplates();
      });
      head.append(del);
      row.append(head);

      const descInput = document.createElement('input');
      descInput.type = 'text';
      descInput.className = 'form-input';
      descInput.placeholder = '描述（可选）';
      descInput.value = tpl.description || '';
      descInput.dataset.macroField = 'description';
      descInput.dataset.macroIndex = String(index);
      descInput.style.cssText = 'width: 100%; margin-top: 6px;';
      row.append(descInput);

      const contentInput = document.createElement('textarea');
      contentInput.className = 'form-input';
      contentInput.rows = 3;
      contentInput.placeholder = '模板内容，可含 {{user}} {{char}} {{random:...}} 等宏';
      contentInput.value = tpl.content || '';
      contentInput.dataset.macroField = 'content';
      contentInput.dataset.macroIndex = String(index);
      contentInput.style.cssText = 'width: 100%; margin-top: 6px; font-family: monospace;';
      row.append(contentInput);

      els.macroTemplatesList.append(row);
    });

    els.macroTemplatesList.querySelectorAll('[data-macro-field]').forEach((el) => {
      el.addEventListener('input', () => {
        const idx = Number(el.dataset.macroIndex);
        const field = el.dataset.macroField;
        const arr = Array.isArray(state.config?.macroTemplates) ? state.config.macroTemplates : [];
        if (arr[idx]) arr[idx][field] = el.value;
      });
    });
  }

  function addMacroTemplateRow() {
    if (!Array.isArray(state.config?.macroTemplates)) state.config.macroTemplates = [];
    state.config.macroTemplates.push({
      name: '',
      content: '',
      description: '',
      createdAt: new Date().toISOString()
    });
    renderMacroTemplates();
  }

  async function saveMacroTemplates() {
    try {
      const templates = Array.isArray(state.config?.macroTemplates) ? state.config.macroTemplates : [];
      const payload = await apiRequest('/api/macro-templates', {
        method: 'PUT',
        body: { macroTemplates: templates }
      });
      state.config.macroTemplates = payload.macroTemplates;
      renderMacroTemplates();
      setStatus(els.macroTemplatesStatus, `已保存 ${payload.macroTemplates.length} 个模板`, 'ok');
    } catch (error) {
      setStatus(els.macroTemplatesStatus, `保存失败：${humanizeApiError(error)}`, 'error');
    }
  }

  async function testMacroExpand() {
    const text = els.macroTestInput?.value || '';
    if (!text.trim()) {
      if (els.macroTestResult) els.macroTestResult.textContent = '请输入含宏的文本';
      return;
    }
    try {
      const payload = await apiRequest('/api/macro/expand', {
        method: 'POST',
        body: { text }
      });
      if (els.macroTestResult) {
        els.macroTestResult.innerHTML = '';
        const label = document.createElement('div');
        label.style.cssText = 'font-size: 11px; color: var(--subtle); margin-bottom: 4px;';
        label.textContent = '展开结果：';
        const content = document.createElement('div');
        content.style.cssText = 'padding: 10px; border: 1px solid var(--border, rgba(255,255,255,0.1)); border-radius: 4px; background: rgba(100, 180, 255, 0.06); white-space: pre-wrap; word-break: break-word;';
        content.textContent = payload.expanded;
        els.macroTestResult.append(label, content);
      }
    } catch (error) {
      if (els.macroTestResult) els.macroTestResult.textContent = `展开失败：${humanizeApiError(error)}`;
    }
  }

  function clearMacroTest() {
    if (els.macroTestInput) els.macroTestInput.value = '';
    if (els.macroTestResult) els.macroTestResult.innerHTML = '';
  }

  return {
    renderMacroTemplates,
    addMacroTemplateRow,
    saveMacroTemplates,
    testMacroExpand,
    clearMacroTest
  };
}
