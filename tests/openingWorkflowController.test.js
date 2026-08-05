import test from 'node:test';
import assert from 'node:assert/strict';

import { createOpeningWorkflowController } from '../public/modules/openingWorkflow.js';

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.attributes = new Map();
    this.children = [];
    this.className = '';
    this.dataset = {};
    this.listeners = new Map();
    this.textContent = '';
    this.value = '';
    this.focusCount = 0;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  append(...children) {
    this.children.push(...children);
  }

  dispatch(type) {
    for (const listener of this.listeners.get(type) || []) listener({ target: this });
  }

  focus() {
    this.focusCount += 1;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name);
  }
}

class FakeDocument {
  constructor() {
    this.documentElement = { dataset: { theme: '' } };
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }

  createTextNode(text) {
    return { textContent: String(text) };
  }
}

const VISUAL_PRESETS = {
  neutral: {
    label: '无舞台背景',
    backgroundImage: ''
  },
  xuanhuan: {
    label: '玄幻舞台',
    backgroundImage: '/xuanhuan.png'
  },
  lingyi: {
    label: '灵异舞台',
    backgroundImage: '/lingyi.png'
  }
};

function createState() {
  return {
    config: {
      characterCard: { name: '主角', extensions: {} },
      characterPresets: [],
      promptModules: [{ id: 'rule' }],
      worldBook: [{ title: '启用', enabled: true }, { title: '停用', enabled: false }]
    },
    contentPacks: [],
    prologueTemplate: {
      genres: {
        xuanhuan: { title: '玄幻开局' },
        lingyi: { title: '灵异开局' },
        xianxia: { title: '仙侠开局' }
      }
    },
    session: {
      id: 'session/a',
      settings: {
        theme: 'wuxia-scroll',
        backgroundImage: '/old.png',
        backgroundFit: 'cover',
        backgroundSource: 'manual',
        visualContentPack: 'xuanhuan'
      },
      memory: {}
    },
    storyProjects: []
  };
}

function createHarness(overrides = {}) {
  const state = overrides.state || createState();
  const documentObject = new FakeDocument();
  const els = {
    chatInput: new FakeElement('textarea'),
    contentPackSelect: new FakeElement('select'),
    sessionStatus: new FakeElement('span')
  };
  els.contentPackSelect.value = 'xuanhuan';
  const calls = {
    applyBackgroundImage: [],
    applyContentPack: 0,
    buildJourneyDraft: [],
    mergeSession: [],
    renderMessages: 0,
    renderSetupPanel: [],
    saveSettingsPatch: [],
    sendMessage: 0,
    setComposerInputValue: [],
    setOpeningGenre: [],
    statuses: []
  };
  const mergeSession = (patch) => {
    calls.mergeSession.push(patch);
    state.session = { ...(state.session || {}), ...patch };
  };
  const controller = createOpeningWorkflowController({
    state,
    els,
    visualPresets: VISUAL_PRESETS,
    getOpeningGenreIds: () => ['xuanhuan', 'lingyi', 'xianxia'],
    getOpeningGenreOption: (genre) => ({
      id: genre,
      title: `${genre}-title`,
      hint: `${genre}-hint`
    }),
    getCurrentSessionId: () => 'session/a',
    getAppliedContentPackId: () => overrides.appliedPackId || '',
    getContentPackTitle: (packId) => `标题-${packId}`,
    setOpeningGenre: (...args) => calls.setOpeningGenre.push(args),
    applyContentPack: async () => {
      calls.applyContentPack += 1;
      return overrides.applyContentPackResult === undefined ? { ok: true } : overrides.applyContentPackResult;
    },
    renderSetupPanel: (...args) => calls.renderSetupPanel.push(args),
    buildJourneyDraft: (...args) => {
      calls.buildJourneyDraft.push(args);
      return { promptText: '生成后的开局提示', source: args };
    },
    setComposerInputValue: (...args) => calls.setComposerInputValue.push(args),
    sendMessage: async () => {
      calls.sendMessage += 1;
    },
    renderMessages: () => {
      calls.renderMessages += 1;
    },
    applyBackgroundImage: (...args) => calls.applyBackgroundImage.push(args),
    saveSettingsPatch: async (patch) => {
      calls.saveSettingsPatch.push(patch);
      if (overrides.saveError) throw overrides.saveError;
      state.session.settings = { ...(state.session.settings || {}), ...patch };
      return state.session;
    },
    mergeSession,
    setStatus: (_element, text, tone) => calls.statuses.push([text, tone]),
    openProviderSettings: () => {
      calls.openProviderSettings = (calls.openProviderSettings || 0) + 1;
    },
    backgroundUrlsMatch: (left, right) => String(left) === String(right),
    documentObject
  });
  return { calls, controller, documentObject, els, state };
}

test('story presentation prefers the session-bound custom pack over stale memory metadata', () => {
  const state = createState();
  state.session.basePackId = 'custom-pack';
  state.session.memory.resourcePackId = 'stale-pack';
  state.contentPacks = [
    { id: 'stale-pack', title: '旧剧本', custom: false },
    { id: 'custom-pack', title: '当前自定义剧本', custom: true }
  ];
  const harness = createHarness({ state });

  const presentation = harness.controller.getCurrentStoryPresentation(
    { source: 'custom-pack', title: '模板名' },
    'xuanhuan'
  );

  assert.equal(presentation.pack.id, 'custom-pack');
  assert.equal(presentation.title, '当前自定义剧本');
  assert.equal(presentation.custom, true);
});

test('content-pack visual linking changes only the story-owned stage background', async () => {
  const harness = createHarness();

  const preset = await harness.controller.linkContentPackVisuals('lingyi', {
    backgroundImage: '/portrait.png',
    backgroundFit: 'portrait',
    backgroundSource: 'character-portrait',
    statusTarget: {},
    statusText: '开局舞台'
  });

  assert.equal(preset.packId, 'lingyi');
  assert.deepEqual(harness.calls.applyBackgroundImage, [['/portrait.png', 'portrait']]);
  assert.equal(harness.calls.mergeSession.length, 1);
  assert.deepEqual(harness.calls.saveSettingsPatch, [{
    backgroundImage: '/portrait.png',
    backgroundFit: 'portrait',
    backgroundSource: 'character-portrait',
    visualContentPack: 'lingyi'
  }]);
  assert.deepEqual(harness.calls.statuses.at(-1), ['开局舞台：灵异舞台', 'ok']);
});

test('visual save failure restores the previous story background without touching reading mode', async () => {
  const harness = createHarness({ saveError: new Error('write failed') });
  const previousSettings = { ...harness.state.session.settings };

  await assert.rejects(
    harness.controller.linkContentPackVisuals('lingyi', {
      backgroundImage: '/portrait.png',
      backgroundFit: 'portrait'
    }),
    /write failed/
  );

  assert.deepEqual(harness.state.session.settings, previousSettings);
  assert.deepEqual(harness.calls.applyBackgroundImage, [
    ['/portrait.png', 'portrait'],
    ['/old.png', 'cover']
  ]);
});

test('opening workflow preserves explicit zero pack counts and reports enabled lore only', () => {
  const state = createState();
  state.session.basePackId = 'empty-pack';
  state.contentPacks = [{
    id: 'empty-pack',
    title: '空白剧本',
    description: '显式空内容包',
    counts: { worldBook: 0, characterPresets: 0, promptModules: 0 }
  }];
  const harness = createHarness({ state });

  const wrapper = harness.controller.renderOpeningWorkflow('xuanhuan', { title: '测试开局' });
  const currentScript = wrapper.children[1];
  const stats = currentScript.children[1];

  assert.deepEqual(stats.children.map((stat) => stat.children[0].textContent), ['0', '0', '0']);
  assert.match(wrapper.children.at(-1).children.at(-1).textContent, /已启用世界书：1 条/);
});

test('opening error panel renders text safely and delegates provider settings', () => {
  const state = createState();
  state.openingError = '<script>quota</script>';
  const harness = createHarness({ state });

  const panel = harness.controller.createOpeningErrorPanel();

  assert.equal(panel.getAttribute('role'), 'alert');
  assert.equal(panel.children[0].textContent, '<script>quota</script>');
  panel.children[1].dispatch('click');
  assert.equal(harness.calls.openProviderSettings, 1);
});

test('custom opening templates take precedence and title inference remains bounded', () => {
  const state = createState();
  const customTemplate = { title: '自定义仙门', genre: 'xianxia' };
  state.session.basePackId = 'custom-pack';
  state.contentPacks = [{
    id: 'custom-pack',
    custom: true,
    openingTemplate: customTemplate
  }];
  const harness = createHarness({ state });

  assert.deepEqual(harness.controller.resolvePrologueTemplate(), {
    genre: 'xianxia',
    tpl: customTemplate
  });
  assert.equal(
    harness.controller.inferPrologueGenreFromTemplate({ title: '崇祯密诏与银粮危机' }),
    'mingmo'
  );
});

test('guided journey reuses a bound pack and only applies content for an unbound session', async () => {
  const boundState = createState();
  boundState.session.basePackId = 'bound-pack';
  boundState.contentPacks = [{
    id: 'bound-pack',
    custom: true,
    openingTemplate: { title: '绑定开局', genre: 'xuanhuan' }
  }];
  const bound = createHarness({ state: boundState });

  assert.equal(await bound.controller.startGuidedJourney('lingyi'), true);
  assert.equal(bound.calls.applyContentPack, 0);
  assert.equal(bound.calls.renderSetupPanel[0][0].title, '绑定开局');
  assert.match(bound.calls.statuses[0][0], /标题-bound-pack/);

  const unbound = createHarness();
  assert.equal(await unbound.controller.startGuidedJourney('lingyi'), true);
  assert.deepEqual(unbound.calls.setOpeningGenre, [[
    'lingyi',
    { render: false, linkVisuals: false }
  ]]);
  assert.equal(unbound.calls.applyContentPack, 1);
  assert.equal(unbound.calls.renderSetupPanel.length, 1);
});

test('journey start prepares one draft and separates review from auto-send', async () => {
  const harness = createHarness();

  const reviewDraft = await harness.controller.startJourney(
    { protagonist: '林渡' },
    { title: '开局' },
    ['天命一']
  );
  assert.equal(reviewDraft.promptText, '生成后的开局提示');
  assert.equal(harness.state.pendingJourneyDraft, reviewDraft);
  assert.deepEqual(harness.calls.setComposerInputValue, [['生成后的开局提示']]);
  assert.equal(harness.calls.renderMessages, 1);
  assert.equal(harness.els.chatInput.focusCount, 1);
  assert.equal(harness.calls.sendMessage, 0);

  await harness.controller.startJourney({}, {}, [], { autoSend: true });
  assert.equal(harness.calls.sendMessage, 1);
  assert.equal(harness.calls.renderMessages, 1);
});

test('background pack matching and visual preset fallback stay deterministic', () => {
  const harness = createHarness();
  harness.state.session.settings.backgroundImage = '/lingyi.png';

  assert.equal(harness.controller.getBackgroundContentPackId(), 'lingyi');
  assert.deepEqual(harness.controller.getContentPackVisualPreset('unknown'), {
    packId: 'neutral',
    ...VISUAL_PRESETS.neutral
  });
});
