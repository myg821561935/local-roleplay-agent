import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCharacterCardController,
  formatCharacterOverviewValue,
  getCharacterCompatibility,
  inferCharacterContentPackId
} from '../public/modules/characterCard.js';

test('character-card compatibility prefers explicit pack metadata and detects cross-genre cards', () => {
  const card = {
    name: '闻雪照',
    tags: ['仙侠', '修真'],
    extensions: { contentPack: 'xianxia' }
  };
  const knownPackIds = ['xuanhuan', 'xianxia'];

  assert.equal(inferCharacterContentPackId(card, '', knownPackIds), 'xianxia');
  assert.deepEqual(getCharacterCompatibility(card, '', {
    storyPackId: 'xuanhuan',
    knownContentPackIds: knownPackIds
  }), {
    storyPackId: 'xuanhuan',
    characterPackId: 'xianxia',
    mismatched: true
  });
});

test('character-card compatibility still recognizes bundled preset keys and tags', () => {
  assert.equal(inferCharacterContentPackId({}, 'yechenzhou'), 'xuanhuan');
  assert.equal(inferCharacterContentPackId({ tags: ['民俗调查'] }), 'lingyi');
  assert.equal(inferCharacterContentPackId({ tags: ['未知题材'] }), '');
});

test('character overview values flatten nested arrays and objects for readable display', () => {
  assert.equal(formatCharacterOverviewValue({
    身份: '巡夜人',
    资源: ['旧灯', '铜钱'],
    空值: ''
  }), '身份：巡夜人\n资源：旧灯\n铜钱');
});

test('character-card controller saves editor state with the active session id', async () => {
  const editor = { value: '' };
  const saveButton = { disabled: false };
  const status = {};
  const statusUpdates = [];
  const requests = [];
  let activeCard = {};
  const controller = createCharacterCardController({
    elements: {
      characterCardEditor: editor,
      saveCharacterCard: saveButton,
      characterCardStatus: status
    },
    apiRequest: async (path, options) => {
      requests.push({ path, options });
      return { characterCard: { ...options.body.characterCard, saved: true } };
    },
    getSessionId: () => 'session-42',
    getCharacterCard: () => activeCard,
    setCharacterCard: (card) => {
      activeCard = card;
    },
    createCharacterCardTemplate: () => ({ name: '未命名主角' }),
    setStatus: (_element, text, tone) => statusUpdates.push({ text, tone }),
    documentRef: null
  });

  controller.setCharacterCardEditor({ name: '沈观澜' });
  assert.match(editor.value, /"name": "沈观澜"/);
  editor.value = JSON.stringify({ name: '闻雪照' });

  const saved = await controller.saveCharacterCard();
  assert.deepEqual(saved, { name: '闻雪照', saved: true });
  assert.deepEqual(activeCard, saved);
  assert.equal(requests[0].path, '/api/character-card');
  assert.deepEqual(requests[0].options.body, {
    sessionId: 'session-42',
    characterCard: { name: '闻雪照' }
  });
  assert.equal(saveButton.disabled, false);
  assert.deepEqual(statusUpdates.at(-1), { text: '角色卡已保存', tone: 'ok' });
});

test('character-card controller keeps invalid JSON local and does not call the API', async () => {
  let requestCount = 0;
  const statusUpdates = [];
  const controller = createCharacterCardController({
    elements: {
      characterCardEditor: { value: '{bad json' },
      saveCharacterCard: { disabled: false },
      characterCardStatus: {}
    },
    apiRequest: async () => {
      requestCount += 1;
      return {};
    },
    setStatus: (_element, text, tone) => statusUpdates.push({ text, tone }),
    documentRef: null
  });

  assert.equal(await controller.saveCharacterCard(), null);
  assert.equal(requestCount, 0);
  assert.deepEqual(statusUpdates.at(-1), {
    text: '保存失败：角色卡 JSON 解析失败',
    tone: 'error'
  });
});

test('favorite loading keeps character, world book, and prompt modules in one session', async () => {
  const requests = [];
  const preset = {
    id: 'favorite-1',
    name: '望舒旧案',
    characterCard: { name: '闻雪照' },
    worldBook: [{ id: 'lore-1', title: '望舒仙市' }],
    promptModules: [{ id: 'prompt-1', content: '保持仙侠因果。' }]
  };
  const controller = createCharacterCardController({
    elements: {
      characterPresetFavorites: { value: preset.id },
      loadCharacterPreset: { dataset: {}, textContent: '加载' },
      characterCardStatus: {}
    },
    apiRequest: async (path, options) => {
      requests.push({ path, options });
      if (path === '/api/character-card') return { characterCard: preset.characterCard };
      if (path === '/api/world-book') return { worldBook: preset.worldBook };
      return { promptModules: preset.promptModules };
    },
    getSessionId: () => 'story-session',
    getCharacterPresets: () => [preset],
    getKnownContentPackIds: () => ['xianxia'],
    setStatus: () => {},
    documentRef: null
  });

  await controller.loadCharacterPresetFavorite();

  assert.deepEqual(requests.map(({ path, options }) => ({
    path,
    sessionId: options.body.sessionId
  })), [
    { path: '/api/character-card', sessionId: 'story-session' },
    { path: '/api/world-book', sessionId: 'story-session' },
    { path: '/api/prompt-modules', sessionId: 'story-session' }
  ]);
});

test('imported character resources appear beside built-in presets and load as editable drafts', () => {
  const groups = [];
  const statusUpdates = [];
  const presetSelect = {
    value: '',
    querySelector: (selector) => groups.find((group) => `#${group.id}` === selector) || null,
    append: (group) => groups.push(group)
  };
  const documentRef = {
    createElement: (tagName) => ({
      tagName,
      children: [],
      append(child) {
        this.children.push(child);
      },
      remove() {
        const index = groups.indexOf(this);
        if (index >= 0) groups.splice(index, 1);
      }
    })
  };
  const resources = [{
    id: 'maid-card',
    kind: 'character',
    title: '女仆之家',
    payload: { name: '女仆之家', description: '导入的角色设定' }
  }];
  const editor = { value: '' };
  const controller = createCharacterCardController({
    elements: {
      characterPresetSelect: presetSelect,
      characterCardEditor: editor,
      characterCardStatus: {},
      applyCharacterPreset: { dataset: {}, textContent: '加载预设' }
    },
    getResources: () => resources,
    getStaticPresets: () => ({}),
    getDynamicPresets: () => ({}),
    setStatus: (_element, text, tone) => statusUpdates.push({ text, tone }),
    documentRef
  });

  controller.renderCharacterPresetFavorites();
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, '已导入角色卡');
  assert.equal(groups[0].children[0].value, 'resource-character:maid-card');

  presetSelect.value = 'resource-character:maid-card';
  controller.renderCharacterPresetFavorites();
  assert.equal(presetSelect.value, 'resource-character:maid-card');
  controller.applyCharacterPreset();
  assert.match(editor.value, /"name": "女仆之家"/);
  assert.deepEqual(statusUpdates.at(-1), {
    text: '已加载资源库角色：女仆之家，请点击保存生效',
    tone: 'ok'
  });
});

test('late character preset loads cannot redraw a newer session pack', async () => {
  let sessionId = 'story-a';
  let appliedPackId = 'xuanhuan';
  let resolveOldRequest;
  const oldRequest = new Promise((resolve) => {
    resolveOldRequest = () => resolve({
      characterPresets: [
        { id: 'old-1', name: '旧一', characterCard: { name: '旧一' } },
        { id: 'old-2', name: '旧二', characterCard: { name: '旧二' } }
      ]
    });
  });
  const groups = [];
  const presetSelect = {
    querySelector: (selector) => groups.find((group) => `#${group.id}` === selector) || null,
    append: (group) => groups.push(group)
  };
  const documentRef = {
    createElement: (tagName) => ({
      tagName,
      children: [],
      append(child) {
        this.children.push(child);
      },
      remove() {
        const index = groups.indexOf(this);
        if (index >= 0) groups.splice(index, 1);
      }
    })
  };
  const controller = createCharacterCardController({
    elements: { characterPresetSelect: presetSelect },
    apiRequest: async (path) => {
      if (path.includes('xuanhuan')) return oldRequest;
      return {
        characterPresets: [
          { id: 'new-1', name: '新一', characterCard: { name: '新一' } },
          { id: 'new-2', name: '新二', characterCard: { name: '新二' } }
        ]
      };
    },
    getSessionId: () => sessionId,
    getAppliedContentPackId: () => appliedPackId,
    getDynamicPresets: () => ({}),
    getContentPackGenreTitle: (packId) => packId,
    documentRef
  });

  const oldLoad = controller.loadContentPackCharacterPresets('xuanhuan');
  sessionId = 'story-b';
  appliedPackId = 'lingyi';
  await controller.loadContentPackCharacterPresets('lingyi');

  assert.deepEqual(groups.map((group) => group.id), ['content-pack-character-group-lingyi']);
  resolveOldRequest();
  await oldLoad;
  assert.deepEqual(groups.map((group) => group.id), ['content-pack-character-group-lingyi']);
});
