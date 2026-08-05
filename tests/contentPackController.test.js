import test from 'node:test';
import assert from 'node:assert/strict';

import { createContentPackController } from '../public/modules/contentPack.js';

function createClassList() {
  const values = new Set();
  return {
    values,
    toggle(name, enabled) {
      if (enabled) values.add(name);
      else values.delete(name);
    }
  };
}

function createNode(tagName = 'div') {
  const children = [];
  let html = '';
  return {
    tagName,
    children,
    dataset: {},
    className: '',
    classList: createClassList(),
    textContent: '',
    title: '',
    value: '',
    disabled: false,
    append(...nodes) {
      children.push(...nodes);
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

test('content pack controller resolves the persisted pack and user-facing title', () => {
  const state = {
    contentPacks: [
      { id: 'xianxia', title: '太虚仙侠' },
      { id: 'my-pack', title: '我的剧本', custom: true }
    ],
    session: {
      memory: {
        resourcePackId: 'missing-pack',
        ruleSystem: { contentPackId: 'my-pack' }
      }
    },
    config: { characterCard: {} }
  };
  const controller = createContentPackController({
    state,
    getOpeningGenreIds: () => ['xianxia'],
    getOpeningGenreOption: (id) => ({ title: id === 'xianxia' ? '太虚仙侠' : id })
  });

  assert.equal(controller.getAppliedContentPackId(), 'my-pack');
  assert.equal(controller.getContentPackTitle('my-pack'), '我的剧本');
  assert.equal(controller.getContentPackTitle('xianxia'), '太虚仙侠');
  assert.equal(controller.getContentPackTitle('unknown', '未绑定'), '未绑定');
});

test('content pack controller renders built-in and custom options without losing session selection', () => {
  const controls = { hidden: false };
  const contentPackSelect = createNode('select');
  contentPackSelect.value = 'xianxia';
  contentPackSelect.closest = () => controls;
  const newSessionPack = createNode('select');
  newSessionPack.value = 'my-pack';
  let builderRenderCount = 0;
  const controller = createContentPackController({
    state: {
      contentPacks: [
        { id: 'xianxia', title: '太虚仙侠' },
        {
          id: 'my-pack',
          title: '我的剧本',
          custom: true,
          compatibilityAudit: { status: 'audited', canStartNewStory: true }
        }
      ],
      session: {
        storyProjectId: 'story-1',
        memory: { resourcePackId: 'xianxia' }
      }
    },
    els: { contentPackSelect, newSessionPack },
    renderResourcePackBuilder: () => {
      builderRenderCount += 1;
    },
    documentObject
  });

  controller.renderContentPackOptions();

  assert.equal(controls.hidden, true);
  assert.equal(contentPackSelect.value, 'xianxia');
  assert.equal(contentPackSelect.children.length, 2);
  assert.equal(contentPackSelect.children[0].label, '内置题材');
  assert.equal(contentPackSelect.children[0].children[0].value, 'xianxia');
  assert.equal(contentPackSelect.children[1].label, '我的剧本');
  assert.equal(contentPackSelect.children[1].children[0].value, 'my-pack');
  assert.equal(newSessionPack.value, 'my-pack');
  assert.equal(newSessionPack.children[0].value, '');
  assert.equal(builderRenderCount, 1);
});

test('content pack controller fails closed before applying an unreviewed historical pack', async () => {
  const contentPackSelect = createNode('select');
  contentPackSelect.value = 'custom-legacy';
  const applyContentPack = createNode('button');
  const calls = [];
  const statuses = [];
  const controller = createContentPackController({
    state: {
      contentPacks: [{
        id: 'custom-legacy',
        title: '历史剧本',
        custom: true,
        compatibilityAudit: {
          status: 'upgrade-available',
          label: '需要 v2 复审',
          reason: '历史包缺少当前契约审计。',
          canStartNewStory: false
        }
      }]
    },
    els: { contentPackSelect, applyContentPack, contentPackStatus: {} },
    apiRequest: async (...args) => calls.push(args),
    setStatus: (_element, text, tone) => statuses.push({ text, tone })
  });

  assert.equal(await controller.applyContentPack(), null);
  assert.deepEqual(calls, []);
  assert.deepEqual(statuses.at(-1), {
    text: '需要 v2 复审：历史包缺少当前契约审计。',
    tone: 'error'
  });
});

test('content pack controller applies the authoritative payload and synchronizes dependent panels', async () => {
  const contentPackSelect = createEventTarget('select');
  contentPackSelect.value = 'xianxia';
  const applyContentPack = createEventTarget('button');
  const randomProtagonistGenre = createNode('select');
  const apiCalls = [];
  const statuses = [];
  const presetCalls = [];
  const visualCalls = [];
  const sessionUpdates = [];
  let renderCount = 0;
  const state = {
    config: {
      promptModules: [{ id: 'old' }],
      worldBook: [{ id: 'old' }],
      characterCard: { name: '旧角色' }
    },
    session: { id: 'session-1', messages: [], memory: {} },
    simulationPublicSnapshot: { stale: true }
  };
  const payload = {
    appliedPack: {
      id: 'xianxia',
      title: '太虚仙侠',
      visualPackId: 'xianxia',
      stageBackground: { url: '/assets/xianxia-stage.png', fit: 'cover', source: 'pack' }
    },
    promptModules: [{ id: 'new-prompt' }],
    worldBook: [{ id: 'new-world' }],
    characterCard: { name: '赤松子', extensions: { contentPack: 'xianxia' } },
    session: { id: 'session-1', memory: { resourcePackId: 'xianxia' } }
  };
  const controller = createContentPackController({
    state,
    els: {
      contentPackSelect,
      applyContentPack,
      randomProtagonistGenre,
      contentPackStatus: {}
    },
    apiRequest: async (path, options) => {
      apiCalls.push({ path, options });
      return payload;
    },
    setStatus: (_element, text, tone) => statuses.push({ text, tone }),
    getCurrentSessionId: () => 'session-1',
    updateSession: (...args) => sessionUpdates.push(args),
    getOpeningGenreIds: () => ['xianxia'],
    loadContentPackCharacterPresets: async (...args) => presetCalls.push(args),
    getStoryStageBackground: (pack) => pack.stageBackground,
    linkContentPackVisuals: async (...args) => {
      visualCalls.push(args);
      return { label: '仙门云海' };
    },
    renderAll: () => {
      renderCount += 1;
    }
  });

  controller.bindEvents();
  const result = await controller.applyContentPack();

  assert.equal(typeof contentPackSelect.listeners.change, 'function');
  assert.equal(typeof applyContentPack.listeners.click, 'function');
  assert.equal(result, payload);
  assert.deepEqual(apiCalls, [{
    path: '/api/content-packs/xianxia/apply',
    options: { method: 'POST', body: { sessionId: 'session-1' } }
  }]);
  assert.deepEqual(state.config.promptModules, payload.promptModules);
  assert.deepEqual(state.config.worldBook, payload.worldBook);
  assert.deepEqual(state.config.characterCard, payload.characterCard);
  assert.deepEqual(sessionUpdates, [[payload.session, { fallback: state.session }]]);
  assert.equal(state.simulationPublicSnapshot, null);
  assert.equal(randomProtagonistGenre.value, 'xianxia');
  assert.deepEqual(presetCalls, [['xianxia', { silent: true }]]);
  assert.deepEqual(visualCalls, [[
    'xianxia',
    {
      persist: true,
      backgroundImage: '/assets/xianxia-stage.png',
      backgroundFit: 'cover',
      backgroundSource: 'pack'
    }
  ]]);
  assert.equal(renderCount, 1);
  assert.equal(applyContentPack.disabled, false);
  assert.deepEqual(statuses.at(-1), {
    text: '已应用到会话：太虚仙侠 · 舞台背景：仙门云海',
    tone: 'ok'
  });
});

test('content stack reports preview and mixed state from one controller-owned snapshot', () => {
  const contentPackSelect = createNode('select');
  contentPackSelect.value = 'yingxiongzhi';
  const contentStackStatus = createNode();
  const contentStackItems = createNode();
  const applyContentPack = createNode('button');
  const controller = createContentPackController({
    state: {
      contentPacks: [
        { id: 'xianxia', title: '太虚仙侠' },
        { id: 'yingxiongzhi', title: '英雄志' }
      ],
      config: {
        characterCard: {
          name: '赤松子',
          extensions: {
            contentPack: 'yingxiongzhi',
            inspirationRefs: ['参考甲', '参考乙']
          }
        },
        worldBook: [{}, {}]
      },
      session: {
        settings: { visualContentPack: 'xianxia' },
        memory: {
          resourcePackId: 'xianxia',
          narrativeState: { activeArc: '问道太虚' }
        }
      }
    },
    els: { contentPackSelect, contentStackStatus, contentStackItems, applyContentPack },
    getOpeningGenreIds: () => ['xianxia', 'yingxiongzhi'],
    getOpeningGenreOption: (id) => ({ title: id === 'xianxia' ? '太虚仙侠' : '英雄志' }),
    documentObject
  });

  controller.renderContentStack();

  assert.equal(contentStackStatus.textContent, '仅视觉预览');
  assert.equal(contentStackStatus.className, 'stack-status is-preview');
  assert.equal(contentStackItems.children.length, 6);
  assert.deepEqual(
    contentStackItems.children.map((item) => [item.children[0].textContent, item.children[1].textContent]),
    [
      ['规则', '太虚仙侠'],
      ['角色', '赤松子 · 英雄志'],
      ['世界书', '2 条 · 太虚仙侠'],
      ['舞台', '太虚仙侠'],
      ['主线', '问道太虚'],
      ['参考', '参考甲 / 参考乙']
    ]
  );
  assert.equal(applyContentPack.textContent, '应用到会话');
  assert.equal(applyContentPack.classList.values.has('primary-button'), true);
});
