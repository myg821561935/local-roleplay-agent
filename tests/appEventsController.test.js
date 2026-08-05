import test from 'node:test';
import assert from 'node:assert/strict';

import { createAppEventsController } from '../public/modules/appEvents.js';

function createEventTarget({ dataset = {}, classNames = [], onBind = () => {} } = {}) {
  const listeners = new Map();
  return {
    dataset: { ...dataset },
    classList: {
      contains: (className) => classNames.includes(className)
    },
    addEventListener(eventName, handler) {
      onBind(eventName);
      const handlers = listeners.get(eventName) || [];
      handlers.push(handler);
      listeners.set(eventName, handlers);
    },
    dispatch(eventName, event = {}) {
      (listeners.get(eventName) || []).forEach((handler) => handler({
        target: this,
        ...event
      }));
    },
    listenerCount(eventName) {
      return (listeners.get(eventName) || []).length;
    }
  };
}

function createLifecycleHarness() {
  const calls = [];
  const step = (name) => () => calls.push(name);
  const trackedElement = (name) => createEventTarget({
    onBind: (eventName) => calls.push(`${name}:${eventName}`)
  });
  const controllers = {
    assetCenter: { bindEvents: step('asset-center') },
    inspector: { bindEvents: step('inspector') },
    authoring: {
      bindEvents: step('authoring'),
      loadProfiles: step('authoring-profiles')
    },
    mcp: { bindEvents: step('mcp') },
    voice: { bindEvents: step('voice') }
  };
  const bindingNames = [
    'storyCatalog',
    'customStoryBuilder',
    'resourceImport',
    'resourceWorkbench',
    'pluginRegistry',
    'contentPack',
    'immersiveSidebar',
    'usageInspector',
    'worldbookWorkspace',
    'presetWorkspace',
    'personaWorkspace',
    'authorNoteWorkspace',
    'moduleHelp',
    'factCards',
    'providerSettings',
    'sessionSettings',
    'releaseData',
    'mediaGeneration',
    'messageActions',
    'composer',
    'conversationActions',
    'characterCard',
    'groupMembers'
  ];
  const bindings = Object.fromEntries(bindingNames.map((name) => [name, step(name)]));
  const documentObject = trackedElement('global');
  const els = {
    openAssetCenter: trackedElement('story-entry'),
    openAdvancedSession: trackedElement('panel'),
    saveVectorMemory: trackedElement('vector'),
    refreshState: trackedElement('narrative-tool'),
    themeSelect: trackedElement('creator-tool'),
    sessionSelect: trackedElement('session'),
    workModeButtons: [trackedElement('navigation')]
  };
  const controller = createAppEventsController({
    els,
    documentObject,
    controllers,
    bindings
  });
  return { calls, controller, documentObject };
}

test('application event binding preserves lifecycle order and is idempotent', () => {
  const harness = createLifecycleHarness();

  assert.equal(harness.controller.bindEvents(), true);
  assert.equal(harness.controller.bindEvents(), false);
  assert.equal(harness.controller.isBound(), true);
  assert.equal(harness.documentObject.listenerCount('keydown'), 1);
  assert.deepEqual(harness.calls, [
    'asset-center',
    'story-entry:click',
    'storyCatalog',
    'customStoryBuilder',
    'resourceImport',
    'resourceWorkbench',
    'pluginRegistry',
    'contentPack',
    'immersiveSidebar',
    'panel:click',
    'inspector',
    'usageInspector',
    'worldbookWorkspace',
    'presetWorkspace',
    'personaWorkspace',
    'authorNoteWorkspace',
    'moduleHelp',
    'authoring',
    'factCards',
    'authoring-profiles',
    'providerSettings',
    'sessionSettings',
    'releaseData',
    'mediaGeneration',
    'vector:click',
    'mcp',
    'voice',
    'messageActions',
    'composer',
    'conversationActions',
    'narrative-tool:click',
    'global:keydown',
    'creator-tool:change',
    'characterCard',
    'groupMembers',
    'session:change',
    'navigation:click'
  ]);
});

test('application shell events route session, background, simulation and mobile actions', () => {
  const calls = [];
  const action = (name) => (...args) => calls.push([name, ...args]);
  const storageCalls = [];
  const importSessionFile = createEventTarget();
  importSessionFile.click = () => calls.push(['import-click']);
  const newSessionDialog = createEventTarget();
  newSessionDialog.close = () => calls.push(['dialog-close']);
  const backgroundPresets = createEventTarget();
  const simulationViewSwitch = createEventTarget();
  const advanceButton = createEventTarget({ dataset: { simulationAdvance: '90' } });
  const workModeButton = createEventTarget({ dataset: { workMode: 'debug' } });
  const mobileProvider = createEventTarget({
    dataset: { mobileMode: 'settings', mobileView: 'provider' }
  });
  const mobileChat = createEventTarget({ dataset: { mobileView: 'chat' } });
  const els = {
    openAdvancedSession: createEventTarget(),
    backgroundPresets,
    simulationViewSwitch,
    simulationAdvanceButtons: [advanceButton],
    themeSelect: createEventTarget(),
    sessionSelect: createEventTarget(),
    importSession: createEventTarget(),
    importSessionFile,
    newSessionCancel: createEventTarget(),
    newSessionDialog,
    workModeButtons: [workModeButton],
    mobileNavButtons: [mobileProvider, mobileChat],
    storyLauncher: createEventTarget({ classNames: ['is-hidden'] }),
    workspace: createEventTarget({ dataset: { workMode: 'immersive' } })
  };
  els.themeSelect.value = 'ink-night';
  els.sessionSelect.value = 'story-b';
  const documentObject = createEventTarget();
  const controller = createAppEventsController({
    els,
    documentObject,
    storage: {
      setItem: (...args) => storageCalls.push(args)
    },
    actions: {
      closeStoryLauncher: action('close-story'),
      openNewSessionDialog: action('open-session'),
      setBackgroundImage: action('background'),
      selectSimulationView: action('simulation-view'),
      advanceWorldSimulation: action('simulation-advance'),
      saveReadingMode: action('theme'),
      setCurrentSessionId: action('session-id'),
      loadState: action('load-state'),
      activateWorkMode: action('work-mode'),
      setWorkspacePanelExpanded: action('panel'),
      setWorkspaceActiveView: action('active-view'),
      closeModuleHint: action('close-hint')
    }
  });
  controller.bindEvents();

  els.openAdvancedSession.dispatch('click');
  backgroundPresets.dispatch('click', {
    target: {
      closest: () => ({
        dataset: { bgPreset: '/stage.png', bgFit: 'portrait', bgSource: 'preset' }
      })
    }
  });
  simulationViewSwitch.dispatch('click', {
    target: { closest: () => ({ dataset: { simulationView: 'public' } }) }
  });
  advanceButton.dispatch('click');
  els.themeSelect.dispatch('change');
  els.sessionSelect.dispatch('change');
  els.importSession.dispatch('click');
  els.newSessionCancel.dispatch('click');
  workModeButton.dispatch('click');
  mobileProvider.dispatch('click');
  mobileChat.dispatch('click');
  documentObject.dispatch('keydown', { key: 'Escape' });

  assert.deepEqual(storageCalls, [['localRoleplaySessionId', 'story-b']]);
  assert.deepEqual(calls, [
    ['close-story'],
    ['open-session'],
    ['background', '/stage.png', {
      fit: 'portrait',
      source: 'preset'
    }],
    ['simulation-view', 'public'],
    ['simulation-advance', 90],
    ['theme', 'ink-night'],
    ['session-id', 'story-b'],
    ['load-state'],
    ['import-click'],
    ['dialog-close'],
    ['work-mode', 'debug'],
    ['work-mode', 'settings', { syncMobileNav: false }],
    ['panel', 'provider', true],
    ['active-view', 'chat'],
    ['close-hint'],
    ['work-mode', 'creative']
  ]);
});

test('Escape closes an open story launcher before leaving immersive mode', () => {
  const calls = [];
  const documentObject = createEventTarget();
  const controller = createAppEventsController({
    els: {
      storyLauncher: createEventTarget(),
      workspace: createEventTarget({ dataset: { workMode: 'immersive' } })
    },
    documentObject,
    actions: {
      closeStoryLauncher: () => calls.push('close-story'),
      closeModuleHint: () => calls.push('close-hint'),
      activateWorkMode: () => calls.push('work-mode')
    }
  });
  controller.bindEvents();

  documentObject.dispatch('keydown', { key: 'Escape' });

  assert.deepEqual(calls, ['close-story']);
});

test('application event controller requires a document event boundary', () => {
  assert.throws(
    () => createAppEventsController({ documentObject: {} }),
    /DOM document with event APIs/
  );
});
