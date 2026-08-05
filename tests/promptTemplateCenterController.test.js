import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compatibilityLabel,
  createPromptTemplateCenterController
} from '../public/modules/promptTemplateCenter.js';

class FakeElement {
  constructor(value = '') {
    this.value = value;
    this.innerHTML = '';
    this.textContent = '';
    this.disabled = false;
    this.hidden = false;
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
}

function createElements() {
  return {
    promptTemplateGrid: new FakeElement(),
    promptTemplateSummary: new FakeElement(),
    promptTemplateDetail: new FakeElement(),
    promptTemplateDetailTitle: new FakeElement(),
    promptTemplateDetailDescription: new FakeElement(),
    promptTemplateReasons: new FakeElement(),
    promptTemplateParameters: new FakeElement(),
    promptTemplateApplyMode: new FakeElement('append'),
    promptTemplatePreview: new FakeElement(),
    previewPromptTemplate: new FakeElement(),
    applyPromptTemplate: new FakeElement(),
    promptTemplateStatus: new FakeElement()
  };
}

function catalogPayload() {
  return {
    recommendedTemplateId: 'role-fidelity',
    context: {
      characterName: '<夏瑾>',
      hasCharacterCard: true,
      worldBookCount: 3,
      promptModuleCount: 2,
      communityPreset: true
    },
    templates: [{
      id: 'role-fidelity',
      category: '角色锚定',
      title: '角色卡忠实演绎',
      summary: '保持角色一致',
      bestFor: '社区角色卡',
      active: false,
      compatibility: { score: 96, reasons: ['已识别角色卡'] },
      parameters: [{
        id: 'strictness',
        label: '约束强度',
        defaultValue: 'balanced',
        options: [
          { value: 'balanced', label: '均衡', description: '允许合理补全' },
          { value: 'strict', label: '严格', description: '保持未知' }
        ]
      }]
    }]
  };
}

test('template center loads recommendations, previews and applies session-scoped modules', async () => {
  const calls = [];
  const els = createElements();
  const state = { config: { promptModules: [{ id: 'old' }] } };
  let drafted = null;
  const controller = createPromptTemplateCenterController({
    state,
    els,
    getCurrentSessionId: () => 'story/a',
    apiRequest: async (path, options) => {
      calls.push([path, options]);
      if (path.startsWith('/api/prompt-templates?')) return catalogPayload();
      if (path.endsWith('/preview')) return {
        changes: { added: 1, updated: 0, removedTemplateModules: 0, currentModuleCount: 1, nextModuleCount: 2, estimatedTokenDelta: 88 },
        warnings: [],
        promptModules: [{ id: 'old' }, { id: 'prompt-template:role-fidelity:anchor' }]
      };
      return {
        promptModules: [{ id: 'old' }, { id: 'prompt-template:role-fidelity:anchor' }],
        preview: { changes: { added: 1, nextModuleCount: 2 }, warnings: [] },
        templates: [{ ...catalogPayload().templates[0], active: true }]
      };
    },
    setStatus: () => {},
    setPromptDraft: (modules) => { drafted = modules; return true; }
  });

  assert.equal(await controller.load(), true);
  assert.match(els.promptTemplateGrid.innerHTML, /角色卡忠实演绎/);
  assert.match(els.promptTemplateSummary.textContent, /角色：<夏瑾>/, 'summary is assigned through textContent rather than markup');
  assert.equal(controller.setParameterValue('strictness', 'strict'), true);

  const preview = await controller.previewSelected();
  assert.equal(preview.changes.added, 1);
  assert.equal(els.applyPromptTemplate.disabled, false);
  assert.match(els.promptTemplatePreview.innerHTML, /\+88/);

  const applied = await controller.applySelected();
  assert.equal(applied.length, 2);
  assert.deepEqual(state.config.promptModules, applied);
  assert.deepEqual(drafted, applied);
  assert.equal(calls[0][0], '/api/prompt-templates?sessionId=story%2Fa');
  assert.deepEqual(calls[1][1].body, {
    sessionId: 'story/a',
    templateId: 'role-fidelity',
    parameters: { strictness: 'strict' },
    mode: 'append'
  });
});

test('compatibility labels are stable at product thresholds', () => {
  assert.equal(compatibilityLabel(95).label, '高度适配');
  assert.equal(compatibilityLabel(80).label, '适合');
  assert.equal(compatibilityLabel(60).label, '可用');
  assert.equal(compatibilityLabel(20).label, '按需');
});

test('event binding is idempotent', () => {
  const els = createElements();
  const controller = createPromptTemplateCenterController({ els });

  assert.equal(controller.bindEvents(), true);
  assert.equal(controller.bindEvents(), false);
  assert.equal(els.promptTemplateGrid.listeners.get('click').length, 1);
  assert.equal(els.previewPromptTemplate.listeners.get('click').length, 1);
  assert.equal(els.applyPromptTemplate.listeners.get('click').length, 1);
});
