import test from 'node:test';
import assert from 'node:assert/strict';

import { createScriptGovernanceController } from '../public/modules/scriptGovernance.js';

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.className = '';
    this.dataset = {};
    this.hidden = false;
    this.textContent = '';
    this.title = '';
    this.type = '';
    this.innerHTML = '';
    this.style = {};
    this.listeners = {};
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  prepend(...nodes) {
    this.children.unshift(...nodes);
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  click() {
    this.listeners.click?.();
  }
}

class FakeDocument {
  createElement(tagName) {
    return new FakeElement(tagName);
  }
}

function createRuntime() {
  return {
    regexTransforms: [{
      id: 'w2g-style',
      name: 'TG-行动选项美化',
      pattern: '<w2g>([\\s\\S]*?)</w2g>',
      flags: 'g',
      replacement: '<script>document.body.textContent = "styled"</script>',
      scope: 'assistant',
      enabled: true,
      requiresSandbox: true,
      contentHash: 'sha256:test'
    }],
    scriptReviews: []
  };
}

test('blocked script notice names the rule and opens the audit workflow', () => {
  const documentObject = new FakeDocument();
  const opened = [];
  const controller = createScriptGovernanceController({
    elements: {},
    getRuntime: createRuntime,
    getSessionId: () => 'main',
    apiRequest: async () => ({}),
    onOpenAudit: (assessments) => opened.push(assessments),
    confirmAction: () => true,
    documentObject
  });
  const container = new FakeElement();

  controller.renderMessageContent({
    container,
    visibleContent: '<w2g>A：观察四周</w2g>',
    role: 'assistant'
  });

  const notice = container.children[0];
  assert.match(notice.children[0].textContent, /TG-行动选项美化/);
  assert.equal(notice.children[1].textContent, '查看并审核');
  notice.children[1].click();
  assert.equal(opened.length, 1);
  assert.equal(opened[0][0].id, 'w2g-style');
});

test('audit panel exposes pending count and per-rule review actions', () => {
  const documentObject = new FakeDocument();
  const auditList = new FakeElement();
  const auditEmpty = new FakeElement();
  const auditCount = new FakeElement('span');
  const controller = createScriptGovernanceController({
    elements: { auditList, auditEmpty, auditCount },
    getRuntime: createRuntime,
    getSessionId: () => 'main',
    apiRequest: async () => ({}),
    confirmAction: () => true,
    documentObject
  });

  controller.renderAuditPanel();

  assert.equal(auditCount.hidden, false);
  assert.equal(auditCount.textContent, '1 待处理');
  assert.equal(auditList.children.length, 1);
  const item = auditList.children[0];
  assert.equal(item.dataset.ruleId, 'w2g-style');
  const actions = item.children.at(-1);
  assert.deepEqual(actions.children.map((button) => button.textContent), ['审核并允许', '拒绝']);
});
