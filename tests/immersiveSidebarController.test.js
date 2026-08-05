import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createImmersiveDossierToolkit,
  mergeImmersiveFacts,
  normalizeImmersiveRecords,
  parseImmersiveStatusFields,
  resolveLatestRoleplayPanels,
  splitDirectorNoteSections
} from '../public/modules/immersiveDossier.js';
import {
  createImmersiveSidebarController,
  getImmersiveWorldSystemGroups
} from '../public/modules/immersiveSidebar.js';
import { createImmersiveLedgerController } from '../public/modules/immersiveLedgers.js';

function createClassList() {
  const values = new Set();
  return {
    values,
    add(...names) {
      names.forEach((name) => values.add(name));
    },
    remove(...names) {
      names.forEach((name) => values.delete(name));
    },
    toggle(name, enabled) {
      if (enabled === undefined) {
        if (values.has(name)) values.delete(name);
        else values.add(name);
        return values.has(name);
      }
      if (enabled) values.add(name);
      else values.delete(name);
      return enabled;
    },
    contains(name) {
      return values.has(name);
    }
  };
}

function createNode(tagName = 'div') {
  const children = [];
  const attributes = {};
  let html = '';
  return {
    tagName,
    children,
    attributes,
    dataset: {},
    className: '',
    classList: createClassList(),
    style: {},
    textContent: '',
    title: '',
    hidden: false,
    append(...nodes) {
      children.push(...nodes);
    },
    replaceChildren(...nodes) {
      children.length = 0;
      children.push(...nodes);
    },
    setAttribute(name, value) {
      attributes[name] = String(value);
    },
    get childElementCount() {
      return children.length;
    },
    set innerHTML(value) {
      html = value;
      if (value === '') children.length = 0;
    },
    get innerHTML() {
      return html;
    }
  };
}

function createEventTarget(tagName = 'div') {
  const listeners = {};
  return {
    ...createNode(tagName),
    listeners,
    addEventListener(type, listener) {
      listeners[type] = listener;
    }
  };
}

const documentObject = {
  createElement: createNode
};

function collectNodeText(node) {
  return [node?.textContent, ...(node?.children || []).map(collectNodeText)].filter(Boolean).join(' ');
}

test('immersive dossier helpers normalize status, records and director notes', () => {
  assert.deepEqual(parseImmersiveStatusFields(`
【沈砚状态】
- 身份：巡夜人
- 体力：7/10
- 身份：巡夜人
无结构正文
  `), [
    { label: '身份', value: '巡夜人' },
    { label: '体力', value: '7/10' }
  ]);
  assert.deepEqual(mergeImmersiveFacts([
    ['身份', '巡夜人'],
    ['身份', '重复值'],
    ['物品', ['铜铃', '旧钥匙']]
  ]), [
    { label: '身份', value: '巡夜人' },
    { label: '物品', value: '铜铃、旧钥匙' }
  ]);
  assert.deepEqual(normalizeImmersiveRecords([
    { title: '线索', content: '旧值' },
    { title: '线索', content: '新值', status: 'active' }
  ], '事实'), [
    { title: '线索', detail: '新值', meta: '进行中' }
  ]);

  const notes = splitDirectorNoteSections('风险分析：关系即将破裂\n规则检查：没有越权');
  assert.deepEqual(notes.map((item) => item.title), ['风险分析', '规则检查']);
});

test('latest roleplay panels merge recovered legacy controls with materialized message data', () => {
  const extractor = (content) => ({
    content,
    panels: content === 'latest'
      ? { directorNotes: '从旧消息恢复的生成规划', sceneStatus: '旧城门' }
      : content === 'parsed'
        ? { sceneStatus: '旧城门' }
        : {}
  });
  assert.deepEqual(resolveLatestRoleplayPanels([
    { role: 'assistant', content: 'parsed' },
    { role: 'user', content: '继续' },
    { role: 'assistant', content: 'latest', roleplayPanels: { sceneStatus: '新城门' } }
  ], extractor), { directorNotes: '从旧消息恢复的生成规划', sceneStatus: '新城门' });
  assert.deepEqual(resolveLatestRoleplayPanels([
    { role: 'assistant', content: 'parsed' }
  ], extractor), { sceneStatus: '旧城门' });
});

test('immersive sidebar controller owns tab events, merged tabs and ledger dispatch', () => {
  const immersiveRightSidebar = createNode();
  const immersiveSidebarTabs = createEventTarget();
  const immersiveSidebarClose = createEventTarget('button');
  const immersiveSidebarContent = createNode();
  const immersiveSidebarTitle = createNode();
  const immersiveSidebarBody = createNode();
  const state = {
    immersiveSidebarTab: '',
    config: { lightFrontend: {}, characterCard: {}, worldBook: [] },
    session: {
      messages: [{
        role: 'assistant',
        content: '正文',
        roleplayPanels: { directorNotes: '因果检查：保持主角自主' }
      }],
      memory: {}
    }
  };
  const memoryCalls = [];
  const dossier = createImmersiveDossierToolkit({
    documentObject,
    extractRoleplayPresentation: () => ({ content: '', panels: {} })
  });
  const controller = createImmersiveSidebarController({
    state,
    els: {
      immersiveRightSidebar,
      immersiveSidebarTabs,
      immersiveSidebarClose,
      immersiveSidebarContent,
      immersiveSidebarTitle,
      immersiveSidebarBody
    },
    dossier,
    ledgers: {
      renderImmersiveMemoryLedger: (...args) => memoryCalls.push(args)
    },
    resolvePrologueTemplate: () => ({
      genre: 'wuxia',
      tpl: {
        sidebar: { tabs: ['主角档案', '梦入神机'] },
        tabs: {}
      }
    }),
    getCurrentStoryPresentation: () => ({ title: '夜雨江湖' }),
    getLightFrontendPanels: () => [{
      id: 'community',
      title: '社区面板',
      fields: [{ label: '危机', value: '逼近' }]
    }],
    resolveLightFrontendPanel: (panel) => panel,
    getLightFrontendContext: () => ({ sessionId: 'main' }),
    extractRoleplayPresentation: () => ({ content: '', panels: {} }),
    documentObject
  });

  controller.bindEvents();
  controller.renderImmersiveSidebar();

  assert.equal(immersiveSidebarTabs.children.length, 4);
  assert.deepEqual(
    immersiveSidebarTabs.children.map((node) => node.textContent),
    ['主角档案', '梦入神机', '导演注记', '社区面板']
  );
  assert.equal(immersiveRightSidebar.classList.contains('hidden'), false);
  assert.equal(immersiveSidebarContent.classList.contains('hidden'), true);

  immersiveSidebarTabs.listeners.click({
    target: {
      closest: () => ({ dataset: { immersiveTab: '梦入神机' } })
    }
  });
  assert.equal(state.immersiveSidebarTab, '梦入神机');
  assert.deepEqual(memoryCalls, [['梦入神机', 'wuxia']]);
  assert.equal(immersiveRightSidebar.classList.contains('expanded'), true);

  immersiveSidebarClose.listeners.click();
  assert.equal(state.immersiveSidebarTab, '');
  assert.equal(immersiveSidebarContent.classList.contains('hidden'), true);
});

test('immersive sidebar renders declarative community panels through dossier helpers', () => {
  const body = createNode();
  const state = {
    immersiveSidebarTab: '社区面板',
    config: { lightFrontend: {} },
    session: { messages: [], memory: {} }
  };
  const dossier = createImmersiveDossierToolkit({ documentObject });
  const controller = createImmersiveSidebarController({
    state,
    els: {
      immersiveRightSidebar: createNode(),
      immersiveSidebarTabs: createNode(),
      immersiveSidebarContent: createNode(),
      immersiveSidebarTitle: createNode(),
      immersiveSidebarBody: body
    },
    dossier,
    resolvePrologueTemplate: () => ({ genre: 'mystery', tpl: { sidebar: { tabs: [] } } }),
    getLightFrontendPanels: () => [{
      title: '社区面板',
      subtitle: '审计面板',
      summary: '只显示声明式数据',
      fields: [{ label: '线索', value: '铜铃' }],
      items: [{ title: '待核验', detail: '查看旧宅' }]
    }],
    resolveLightFrontendPanel: (panel) => panel,
    documentObject
  });

  controller.renderImmersiveSidebar();

  assert.equal(body.children.length, 1);
  assert.match(body.children[0].className, /immersive-dossier-community/);
  assert.equal(body.children[0].children.at(-1).children.length, 2);
});

test('story clues and relationship forces render as separate ledgers', () => {
  const body = createNode();
  const state = {
    config: { characterCard: { name: '刘一' }, worldBook: [] },
    session: {
      messages: [],
      memory: {
        worldState: {
          protagonist: { name: '刘一' },
          quests: [{ name: '调查西门', status: 'active' }],
          relationships: [{ name: '江小鲤', relation: '青梅竹马', encountered: true }],
          factions: [{ name: '凌霄宗', relation: '所属宗门' }]
        },
        memoryCards: [{ title: '西门线索', content: '炭路脚印异常' }]
      }
    }
  };
  const dossier = createImmersiveDossierToolkit({ documentObject });
  const ledgers = createImmersiveLedgerController({
    state,
    els: { immersiveSidebarBody: body },
    dossier,
    getCurrentStoryPresentation: () => ({ title: '未尽夏', custom: true }),
    documentObject
  });

  ledgers.renderImmersiveIntelligenceLedger('故事线索', {}, 'xianxia');
  const storyText = collectNodeText(body);
  assert.match(storyText, /调查西门/);
  assert.match(storyText, /西门线索/);
  assert.doesNotMatch(storyText, /青梅竹马|凌霄宗/);

  ledgers.renderImmersiveRelationshipLedger('关系与势力', {}, 'xianxia');
  const relationshipText = collectNodeText(body);
  assert.match(relationshipText, /江小鲤/);
  assert.match(relationshipText, /凌霄宗/);
  assert.doesNotMatch(relationshipText, /调查西门|炭路脚印异常/);
});

test('world system grouping only returns populated bounded structures', () => {
  const groups = getImmersiveWorldSystemGroups({
    topology: {
      nodes: Array.from({ length: 8 }, (_, index) => ({
        name: `地点 ${index + 1}`,
        summary: `说明 ${index + 1}`,
        constant: index === 0
      }))
    },
    economy: { rules: [{ title: '银钱规则', summary: '价格随战乱波动' }] }
  }, (value, limit) => String(value).slice(0, limit));

  assert.equal(groups.length, 2);
  assert.equal(groups[0].title, '地点拓扑');
  assert.equal(groups[0].items.length, 6);
  assert.equal(groups[0].items[0].meta, '常驻');
  assert.equal(groups[1].title, '经济铁律');
});
