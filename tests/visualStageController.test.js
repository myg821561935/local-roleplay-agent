import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AVAILABLE_THEMES,
  CONTENT_PACK_VISUAL_PRESETS,
  createVisualStageController,
  loadThemePreference,
  normalizeThemePreference
} from '../public/modules/visualStage.js';

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  toggle(value, force) {
    if (force === false) this.values.delete(value);
    else if (force === true) this.values.add(value);
    else if (this.values.has(value)) this.values.delete(value);
    else this.values.add(value);
  }

  contains(value) {
    return this.values.has(value);
  }
}

function installBrowserGlobals() {
  const original = {
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    window: globalThis.window
  };
  const storageValues = new Map();
  const styleValues = new Map();
  const chatPanel = {
    classList: new FakeClassList(),
    style: {
      setProperty: (name, value) => styleValues.set(name, value),
      removeProperty: (name) => styleValues.delete(name)
    }
  };
  globalThis.document = {
    documentElement: { dataset: {} },
    querySelector: (selector) => selector === '.chat-panel' ? chatPanel : null
  };
  globalThis.window = { location: { origin: 'http://localhost' } };
  globalThis.localStorage = { setItem: (key, value) => storageValues.set(key, value) };
  return {
    chatPanel,
    storageValues,
    restore() {
      globalThis.document = original.document;
      globalThis.localStorage = original.localStorage;
      globalThis.window = original.window;
    },
    styleValues
  };
}

function createHarness({ saveSettingsPatch } = {}) {
  const state = {
    config: {},
    session: {
      id: 'story/one',
      config: { characterCard: {} },
      settings: {
        backgroundImage: '',
        backgroundFit: 'cover',
        theme: 'default-dark'
      }
    }
  };
  const patches = [];
  const statuses = [];
  const element = () => ({ classList: new FakeClassList(), textContent: '', title: '', value: '' });
  const els = {
    appStatus: element(),
    backgroundMode: element(),
    backgroundStatus: element(),
    themeSelect: element(),
    toggleBackground: element()
  };
  const controller = createVisualStageController({
    state,
    els,
    getCharacterPortraitUrl: () => '',
    saveSettingsPatch: saveSettingsPatch || (async (patch) => {
      patches.push(patch);
      state.session = {
        ...state.session,
        settings: { ...state.session.settings, ...patch }
      };
      return state.session;
    }),
    setStatus: (target, message, tone) => statuses.push({ target, message, tone }),
    humanizeApiError: (error) => `友好错误：${error.message}`
  });
  return { controller, els, patches, state, statuses };
}

test('visual stage saves background fields through the shared settings patch boundary', async () => {
  const browser = installBrowserGlobals();
  try {
    const harness = createHarness();
    const saved = await harness.controller.setBackgroundImage('/portrait.png', {
      fit: 'portrait',
      source: 'character-portrait'
    });

    assert.equal(saved, harness.state.session);
    assert.deepEqual(harness.patches, [{
      backgroundImage: '/portrait.png',
      backgroundFit: 'portrait',
      backgroundSource: 'character-portrait'
    }]);
    assert.equal(browser.styleValues.get('--chat-bg-image'), 'url("/portrait.png")');
    assert.equal(browser.chatPanel.classList.contains('has-stage-background'), true);
    assert.equal(browser.chatPanel.classList.contains('background-fit-portrait'), true);
    assert.equal(harness.statuses.at(-1).message, '已使用角色立绘作为舞台背景');
  } finally {
    browser.restore();
  }
});

test('reading mode is a device preference and never mutates session settings', async () => {
  const browser = installBrowserGlobals();
  try {
    const success = createHarness();
    assert.equal(success.controller.saveReadingMode('cyber'), 'cyber');
    assert.deepEqual(success.patches, []);
    assert.equal(globalThis.document.documentElement.dataset.theme, 'cyber');
    assert.equal(browser.storageValues.get('local-roleplay-agent-theme'), 'cyber');
    assert.equal(success.statuses.at(-1).message, '阅读模式已保存到本机，切换剧本时保持不变');

    const failure = createHarness({
      saveSettingsPatch: async () => {
        throw new Error('write failed');
      }
    });
    assert.equal(await failure.controller.setBackgroundImage('/failed.png'), null);
    assert.equal(browser.styleValues.has('--chat-bg-image'), false);
    assert.equal(failure.statuses.at(-1).message, '背景保存失败：友好错误：write failed');
  } finally {
    browser.restore();
  }
});

test('visual defaults and legacy theme ids migrate to story-independent reading modes', () => {
  assert.equal(loadThemePreference({ getItem: () => null }), 'eye-care');
  assert.equal(loadThemePreference({ getItem: () => 'default-dark' }), 'dark');
  assert.equal(loadThemePreference({ getItem: () => 'wuxia-scroll' }), 'eye-care');
  assert.equal(loadThemePreference({ getItem: () => 'xianxia-scroll' }), 'soft');
  assert.deepEqual(AVAILABLE_THEMES, ['eye-care', 'dark', 'bright', 'soft', 'modern', 'cyber']);
  assert.deepEqual(CONTENT_PACK_VISUAL_PRESETS.neutral, {
    label: '无舞台背景',
    backgroundImage: ''
  });
  assert.equal(Object.values(CONTENT_PACK_VISUAL_PRESETS).some((preset) => 'theme' in preset), false);
  assert.equal(normalizeThemePreference('unknown-theme'), 'eye-care');

  const browser = installBrowserGlobals();
  try {
    const harness = createHarness();
    assert.equal(harness.controller.normalizeTheme('unknown-theme'), 'eye-care');
  } finally {
    browser.restore();
  }
});
