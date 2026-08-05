import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMemoryInspectorController,
  formatMemoryDisplayValue,
  formatRuleFieldValue,
  formatRuleRecord,
  getRulePathValue,
  resolveCurrentLocation
} from '../public/modules/memoryInspector.js';

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.className = '';
    this.textContent = '';
    this.title = '';
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = [...children];
  }
}

const documentObject = {
  createElement: (tagName) => new FakeElement(tagName)
};

function findByClass(element, className) {
  if (String(element?.className || '').split(/\s+/).includes(className)) return element;
  for (const child of element?.children || []) {
    const found = findByClass(child, className);
    if (found) return found;
  }
  return null;
}

function collectText(element) {
  return [
    element?.textContent || '',
    ...(element?.children || []).map(collectText)
  ].filter(Boolean).join(' ');
}

test('memory and rule formatters keep values concise and deterministic', () => {
  assert.equal(formatMemoryDisplayValue(['一', '', '二', '三', '四', '五', '六', '七']), '一、二、三、四、五、六');
  assert.equal(formatMemoryDisplayValue({ realm: '筑基', tags: ['谨慎', '负伤'] }), 'realm: 筑基 · tags: 谨慎、负伤');
  assert.equal(formatMemoryDisplayValue('  '), '未记录');
  assert.equal(formatMemoryDisplayValue(null, '暂无'), '暂无');
  assert.equal(resolveCurrentLocation({
    location: { current: '雾江古渡', knownPlaces: ['雾江古渡', '北门'] }
  }), '雾江古渡');
  assert.equal(resolveCurrentLocation({}, { currentLocation: '旧城' }), '旧城');

  assert.equal(formatRuleRecord({ title: '黑潮', status: '逼近' }), '黑潮：逼近');
  assert.equal(formatRuleRecord({ name: '叶青' }), '叶青');
  assert.equal(formatRuleRecord({ stance: '敌对' }), '敌对');
  assert.equal(formatRuleRecord({ hp: 8, tags: ['伤', '毒'] }), 'hp:8，tags:伤、毒');
  assert.equal(formatRuleFieldValue(null), '-');
  assert.equal(formatRuleFieldValue(['北门', '南门']), '北门、南门');
  assert.equal(formatRuleFieldValue([{ title: '黑潮', state: '逼近' }], 'records'), '黑潮：逼近');
});

test('rule paths only traverse explicit own data fields', () => {
  const context = {
    worldState: {
      location: '古渡',
      nested: { clock: 3 }
    }
  };

  assert.equal(getRulePathValue(context, 'worldState.location'), '古渡');
  assert.equal(getRulePathValue(context, 'worldState.nested.clock'), 3);
  assert.equal(getRulePathValue(context, ''), undefined);
  assert.equal(getRulePathValue(context, 'worldState.missing'), undefined);
  assert.equal(getRulePathValue(context, 'worldState.__proto__.polluted'), undefined);
  assert.equal(getRulePathValue(context, 'worldState.constructor.name'), undefined);
  assert.equal(getRulePathValue(context, 'worldState.toString'), undefined);
});

test('memory overview renders summary, coordinates, metrics, and at most four recent facts', () => {
  const memoryOverview = new FakeElement();
  const state = {
    config: { characterCard: { name: '沈砚' } },
    session: {
      memory: {
        rollingSummary: '主角在古渡追查失踪商队。',
        unsummarizedTurnCount: 3,
        worldState: {
          flags: { genre: '仙侠悬疑' },
          location: { current: '雾江古渡', knownPlaces: ['雾江古渡', '北门'] },
          time: '子夜',
          protagonist: { inventory: ['断剑', '铜印'] }
        },
        narrativeState: { activeArc: '黑潮疑案' },
        episodicMemory: {
          episodes: [{ id: 'episode:a1', status: 'confirmed' }, { id: 'episode:a0', status: 'superseded' }],
          summaries: {
            scenes: [{ summaryLevel: 'scene', title: '古渡追踪', summary: '主角追到古渡。', status: 'confirmed', validFromTurn: 2 }],
            chapters: [{ summaryLevel: 'chapter', title: '黑潮初现', summary: '失踪案指向黑潮。', status: 'confirmed', validFromTurn: 1 }],
            arcs: []
          }
        },
        memoryCards: [
          { title: '线索一', content: '铜印来自失踪商队。' },
          { subject: '船夫', predicate: '看见', object: '黑帆船' },
          { title: '线索三', fact: '渡口夜间封锁。' },
          { title: '线索四', content: '江面有灵力残留。' },
          { title: '不应显示', content: '第五条事实。' }
        ]
      }
    }
  };
  const controller = createMemoryInspectorController({
    state,
    els: { memoryOverview },
    documentObject
  });

  controller.renderMemoryOverview();

  assert.equal(memoryOverview.children.length, 6);
  assert.equal(memoryOverview.children[0].children[1].textContent, '3 回合待整理');
  const metrics = findByClass(memoryOverview, 'memory-metrics');
  assert.equal(metrics.children[0].children[0].textContent, String(state.session.memory.rollingSummary.length));
  assert.equal(metrics.children[1].children[0].textContent, '5');
  assert.equal(metrics.children[2].children[0].textContent, '1');
  assert.equal(metrics.children[3].children[0].textContent, '1/1/0');
  const context = findByClass(memoryOverview, 'memory-context-grid');
  assert.equal(context.children[0].children[1].textContent, '仙侠悬疑');
  assert.equal(context.children[1].children[1].textContent, '沈砚');
  assert.equal(context.children[2].children[1].textContent, '雾江古渡');
  assert.equal(context.children[5].children[1].textContent, '断剑、铜印');
  const hierarchy = findByClass(memoryOverview, 'memory-hierarchy-list');
  assert.match(collectText(hierarchy), /场景 · 古渡追踪/);
  assert.match(collectText(hierarchy), /章节 · 黑潮初现/);
  const facts = memoryOverview.children.find((child) => collectText(child).includes('最近提取的事实'))
    .children.find((child) => child.className === 'memory-recent-facts');
  assert.equal(facts.children.length, 4);
  assert.match(collectText(facts), /船夫 看见 黑帆船/);
  assert.doesNotMatch(collectText(facts), /不应显示/);
});

test('memory overview clears stale content and renders safe empty fallbacks', () => {
  const memoryOverview = new FakeElement();
  memoryOverview.append(new FakeElement('stale'));
  const controller = createMemoryInspectorController({
    state: { config: {}, session: { memory: {} } },
    els: { memoryOverview },
    documentObject
  });

  controller.renderMemoryOverview();

  assert.equal(memoryOverview.children.length, 4);
  assert.equal(memoryOverview.children[0].children[1].textContent, '已同步');
  assert.match(collectText(memoryOverview), /尚未形成滚动摘要/);
  const context = findByClass(memoryOverview, 'memory-context-grid');
  assert.ok(context.children.every((row) => row.children[1].textContent === '未记录'));
});

test('rule status renders an empty state when no rule system is bound', () => {
  const ruleStatusView = new FakeElement();
  const controller = createMemoryInspectorController({
    state: { session: { memory: {} } },
    els: { ruleStatusView },
    documentObject
  });

  controller.renderRuleStatus();

  assert.equal(ruleStatusView.children.length, 1);
  assert.equal(ruleStatusView.children[0].className, 'compact-empty');
  assert.match(ruleStatusView.children[0].textContent, /没有绑定规则系统/);
});

test('rule status renders declared fields as text without interpreting third-party markup', () => {
  const ruleStatusView = new FakeElement();
  const injectedTitle = '<img src=x onerror=alert(1)>';
  const state = {
    config: { characterCard: { name: '沈砚' } },
    session: {
      memory: {
        worldState: {
          location: '古渡',
          threats: [{ title: '黑潮', status: '逼近' }]
        },
        ruleSystem: {
          title: injectedTitle,
          contentPackId: 'custom-pack',
          boundary: '<script>bad()</script>',
          panels: [{
            id: 'scene',
            title: '场景状态',
            note: '<b>仅供记录</b>',
            fields: [
              { label: '地点', path: 'worldState.location' },
              { label: '威胁', path: 'worldState.threats', type: 'records' },
              { label: '禁用路径', path: 'worldState.constructor.name' }
            ]
          }, null, ['invalid-panel']]
        }
      }
    }
  };
  const controller = createMemoryInspectorController({
    state,
    els: { ruleStatusView },
    documentObject
  });

  controller.renderRuleStatus();

  assert.equal(ruleStatusView.children.length, 2);
  const header = ruleStatusView.children[0];
  assert.equal(header.children[0].children[0].textContent, injectedTitle);
  assert.equal(header.children[1].textContent, '<script>bad()</script>');
  const panel = ruleStatusView.children[1];
  assert.equal(panel.children[0].children[1].textContent, '<b>仅供记录</b>');
  const grid = panel.children[1];
  assert.equal(grid.children[0].children[1].textContent, '古渡');
  assert.equal(grid.children[1].children[1].textContent, '黑潮：逼近');
  assert.equal(grid.children[2].children[1].textContent, '-');
});

test('rule status skips malformed third-party fields without breaking valid fields', () => {
  const ruleStatusView = new FakeElement();
  const controller = createMemoryInspectorController({
    state: {
      session: {
        memory: {
          worldState: { location: '古渡' },
          ruleSystem: {
            panels: [{
              title: '状态',
              fields: [null, 'bad-field', { label: '地点', path: 'worldState.location' }]
            }]
          }
        }
      }
    },
    els: { ruleStatusView },
    documentObject
  });

  assert.doesNotThrow(() => controller.renderRuleStatus());
  assert.equal(ruleStatusView.children.length, 2);
  assert.equal(ruleStatusView.children[1].children[1].children.length, 1);
  assert.equal(ruleStatusView.children[1].children[1].children[0].children[1].textContent, '古渡');
});
