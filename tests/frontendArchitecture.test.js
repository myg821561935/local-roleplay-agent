import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createProviderOnboardingBanner,
  isProviderConfigured
} from '../public/modules/chat.js';
import {
  INSPECTOR_GROUPS,
  WORLD_BOOK_ENTRY_FIELDS,
  createInspectorController,
  getInspectorGroupForTab
} from '../public/modules/inspector.js';
import { createMcpController } from '../public/modules/mcp.js';
import { createVoiceController } from '../public/modules/voice.js';
import { createAuthoringController } from '../public/modules/authoring.js';
import {
  STORY_CATEGORY_LABELS,
  filterStoryPacks
} from '../public/modules/storyLauncher.js';
import { createWorkspaceController } from '../public/modules/workspace.js';
import { createStoryOpeningController } from '../public/modules/storyOpening.js';
import { createAssetLibraryController } from '../public/modules/assetLibrary.js';
import { createProviderSettingsController } from '../public/modules/providerSettings.js';
import { createVisualStageController } from '../public/modules/visualStage.js';
import { createSessionController } from '../public/modules/session.js';

test('provider onboarding distinguishes usable local and remote providers', () => {
  assert.equal(isProviderConfigured({ activeProviderId: '', providers: [] }), false);
  assert.equal(isProviderConfigured({
    activeProviderId: 'local',
    providers: [{ id: 'local', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1', model: 'qwen3' }]
  }), true);
  assert.equal(isProviderConfigured({
    activeProviderId: 'remote',
    providers: [{ id: 'remote', kind: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'model-name' }]
  }), false);
  assert.equal(isProviderConfigured({
    activeProviderId: 'remote',
    providers: [{ id: 'remote', kind: 'openai-compatible', baseUrl: 'https://api.example.com/v1', apiKey: '********', model: 'model-name' }]
  }), true);
  assert.equal(isProviderConfigured({
    activeProviderId: 'anthropic',
    providers: [{ id: 'anthropic', kind: 'anthropic', baseUrl: '', apiKey: '********', model: 'claude-sonnet' }]
  }), true);
  assert.equal(isProviderConfigured({
    activeProviderId: 'gemini',
    providers: [{ id: 'gemini', kind: 'gemini', baseUrl: '', apiKey: '********', model: 'gemini-pro' }]
  }), true);
  assert.equal(typeof createProviderOnboardingBanner, 'function');
});

test('inspector exposes three levels and worldbook fields have simple and advanced modes', () => {
  assert.deepEqual(Object.keys(INSPECTOR_GROUPS), ['core', 'advanced', 'debug']);
  assert.equal(getInspectorGroupForTab('worldbook'), 'core');
  assert.equal(getInspectorGroupForTab('authoring'), 'core');
  assert.equal(getInspectorGroupForTab('macro'), 'advanced');
  assert.equal(getInspectorGroupForTab('facts'), 'debug');
  assert.equal(WORLD_BOOK_ENTRY_FIELDS.length, 11);
  assert.ok(WORLD_BOOK_ENTRY_FIELDS.some((field) => field.mode === 'simple'));
  assert.ok(WORLD_BOOK_ENTRY_FIELDS.some((field) => field.mode === 'advanced'));
  assert.equal(typeof createInspectorController, 'function');
});

test('feature modules expose real controllers and story filtering', () => {
  assert.equal(typeof createMcpController, 'function');
  assert.equal(typeof createVoiceController, 'function');
  assert.equal(typeof createAuthoringController, 'function');
  assert.equal(STORY_CATEGORY_LABELS.xianxia, '仙侠');

  const packs = [
    { id: 'xianxia', title: '太虚仙侠', description: '仙门与因果' },
    { id: 'lingyi', title: '民俗灵异', description: '旧楼调查' }
  ];
  assert.deepEqual(filterStoryPacks(packs, { category: 'xianxia', query: '' }).map((pack) => pack.id), ['xianxia']);
  assert.deepEqual(filterStoryPacks(packs, { category: 'all', query: '调查' }).map((pack) => pack.id), ['lingyi']);
});

test('convergence controllers expose the six frontend ownership boundaries', () => {
  assert.equal(typeof createWorkspaceController, 'function');
  assert.equal(typeof createStoryOpeningController, 'function');
  assert.equal(typeof createAssetLibraryController, 'function');
  assert.equal(typeof createProviderSettingsController, 'function');
  assert.equal(typeof createVisualStageController, 'function');
  assert.equal(typeof createSessionController, 'function');

  const visualStage = createVisualStageController({
    state: {},
    els: {},
    apiRequest: async () => ({}),
    getSessionId: () => 'main',
    getCharacterPortraitUrl: () => '',
    saveSessionVisualSettings: async () => ({}),
    setStatus: () => {},
    humanizeApiError: String
  });
  assert.equal(typeof visualStage.backgroundUrlsMatch, 'function');
  assert.equal(typeof visualStage.getBackgroundLabelForUrl, 'function');
});

test('frontend entry imports feature modules and documents the three-step quick start', async () => {
  const app = await readFile('public/app.js', 'utf8');
  const html = await readFile('public/index.html', 'utf8');
  const cssEntry = await readFile('public/styles.css', 'utf8');
  const css = (await Promise.all([
    'foundation.css',
    'asset-center.css',
    'themes.css',
    'workbench-header.css',
    'bookshelf.css',
    'workbench-shell.css',
    'immersive.css',
    'workbench.css'
  ].map((file) => readFile(`public/styles/${file}`, 'utf8')))).join('\n');
  const readme = await readFile('README.md', 'utf8');

  for (const moduleName of [
    'chat',
    'inspector',
    'mcp',
    'voice',
    'storyLauncher',
    'authoring',
    'workspace',
    'storyOpening',
    'assetLibrary',
    'providerSettings',
    'visualStage',
    'session'
  ]) {
    assert.match(app, new RegExp(`from './modules/${moduleName}\\.js'`));
  }
  assert.match(html, /data-inspector-group="core"/);
  assert.match(html, /data-inspector-group="advanced"/);
  assert.match(html, /data-inspector-group="debug"/);
  assert.match(html, /data-open-provider-section="vector-memory-panel"/);
  assert.match(html, /data-open-provider-section="mcp-panel"/);
  assert.match(html, /data-pane="authoring"/);
  assert.match(html, /id="authoring-agent-profile"/);
  assert.match(css, /\.provider-onboarding-banner\s*\{/);
  assert.match(css, /\.inspector-panel \.tab-button\[hidden\]\s*\{[\s\S]*display:\s*none\s*!important;/);
  assert.match(css, /\.wb-editor-mode-switch\s*\{/);
  assert.match(css, /\.inspector-panel\.authoring-workbench-open \.content-stack-summary/);
  assert.match(cssEntry, /@import url\('\.\/styles\/asset-center\.css'\);/);
  assert.match(cssEntry, /@import url\('\.\/styles\/bookshelf\.css'\);/);
  assert.match(cssEntry, /@import url\('\.\/styles\/immersive\.css'\);/);
  assert.match(cssEntry, /@import url\('\.\/styles\/themes\.css'\);/);
  assert.match(readme, /## 快速开始（3 步）/);
  assert.match(readme, /1\. 启动本地服务/);
  assert.match(readme, /2\. 配置 Provider/);
  assert.match(readme, /3\. 选择剧本并入局/);
});
