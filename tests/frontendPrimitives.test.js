import test from 'node:test';
import assert from 'node:assert/strict';

import {
  downloadJsonFile,
  inferMimeType
} from '../public/modules/browserFiles.js';
import {
  createCharacterCardTemplate,
  createWorldBookEntryTemplate
} from '../public/modules/editorDefaults.js';
import { createInspectorTabSelectSync } from '../public/modules/inspector.js';
import {
  formatTime,
  parseJsonFromTextarea,
  setStatus
} from '../public/modules/uiPrimitives.js';
import { loadThemePreference } from '../public/modules/visualStage.js';
import { humanizeApiError } from '../public/modules/utils.js';

test('import errors name presets among the supported resource formats', () => {
  assert.match(humanizeApiError({ code: 'INVALID_IMPORT_PAYLOAD' }), /Prompt\/Regex 预设/);
  assert.match(humanizeApiError({ code: 'IMPORT_SOURCE_PREVIEW_FAILED' }), /预设/);
  assert.match(humanizeApiError({ code: 'BACKUP_TOO_LARGE' }), /备份范围过大/);
});

test('browser file helpers infer supported import types', () => {
  assert.equal(inferMimeType('character.PNG'), 'image/png');
  assert.equal(inferMimeType('world.YAML'), 'text/yaml');
  assert.equal(inferMimeType('world.yml'), 'text/yaml');
  assert.equal(inferMimeType('notes.md'), 'text/plain');
  assert.equal(inferMimeType('notes.TXT'), 'text/plain');
  assert.equal(inferMimeType('preset.json'), 'application/json');
  assert.equal(inferMimeType('unknown.bin'), 'application/json');
});

test('JSON download uses one bounded browser lifecycle and always revokes the URL', () => {
  const calls = [];
  class FakeBlob {
    constructor(parts, options) {
      this.parts = parts;
      this.options = options;
    }
  }
  const anchor = {
    click: () => calls.push('click'),
    remove: () => calls.push('remove')
  };
  const documentObject = {
    createElement: (tagName) => {
      calls.push(`create:${tagName}`);
      return anchor;
    },
    body: {
      append: (node) => calls.push(node === anchor ? 'append' : 'append:unknown')
    }
  };
  let createdBlob;
  const urlObject = {
    createObjectURL: (blob) => {
      createdBlob = blob;
      calls.push('create-url');
      return 'blob:roleplay-export';
    },
    revokeObjectURL: (url) => calls.push(`revoke:${url}`)
  };

  downloadJsonFile({ title: '卷一' }, 'story.json', {
    BlobClass: FakeBlob,
    documentObject,
    urlObject
  });

  assert.deepEqual(createdBlob.parts, [JSON.stringify({ title: '卷一' }, null, 2)]);
  assert.deepEqual(createdBlob.options, { type: 'application/json' });
  assert.equal(anchor.href, 'blob:roleplay-export');
  assert.equal(anchor.download, 'story.json');
  assert.deepEqual(calls, [
    'create-url',
    'create:a',
    'append',
    'click',
    'remove',
    'revoke:blob:roleplay-export'
  ]);
  assert.throws(
    () => downloadJsonFile({}, 'broken.json', {
      BlobClass: null,
      documentObject,
      urlObject
    }),
    /browser download boundary unavailable/
  );
});

test('editor defaults create fresh deterministic character and world-book drafts', () => {
  const timestamp = new Date('2026-07-31T10:20:30.000Z');
  const worldBookEntry = createWorldBookEntryTemplate({ now: () => timestamp });
  assert.equal(worldBookEntry.id, `manual-${timestamp.getTime()}`);
  assert.equal(worldBookEntry.updatedAt, timestamp.toISOString());
  assert.equal(worldBookEntry.position, 'after_character');
  assert.equal(worldBookEntry.scope, 'prompt');

  const firstCard = createCharacterCardTemplate();
  const secondCard = createCharacterCardTemplate();
  assert.equal(firstCard.name, '未命名主角');
  assert.equal(firstCard.enabled, true);
  assert.notEqual(firstCard.tags, secondCard.tags);
  assert.notEqual(firstCard.extensions, secondCard.extensions);
});

test('UI primitives parse editor JSON, render status tone and format timestamps', () => {
  assert.deepEqual(parseJsonFromTextarea({ value: '{"name":"沈观澜"}' }, '角色卡'), {
    name: '沈观澜'
  });
  assert.equal(parseJsonFromTextarea({ value: '' }, '空值'), null);
  assert.throws(
    () => parseJsonFromTextarea({ value: '{broken' }, 'NPC 档案'),
    /NPC 档案 解析失败/
  );

  const classes = new Set(['is-error']);
  const element = {
    textContent: '',
    classList: {
      add: (value) => classes.add(value),
      remove: (...values) => values.forEach((value) => classes.delete(value))
    }
  };
  setStatus(element, '正在保存', 'busy');
  assert.equal(element.textContent, '正在保存');
  assert.deepEqual([...classes], ['is-busy']);

  const value = '2026-07-31T10:20:30.000Z';
  assert.equal(formatTime(value), new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }));
  assert.equal(formatTime('invalid'), '');
  assert.equal(formatTime(''), '');
});

test('inspector select synchronization follows the active work mode', () => {
  const buttons = [
    {
      dataset: { tab: 'worldbook', modeGroups: 'creative debug' },
      textContent: ' 世界书 '
    },
    {
      dataset: { tab: 'usage', modeGroups: 'debug' },
      textContent: '用量'
    }
  ];
  let options = [];
  const tabSelect = {
    value: '',
    set innerHTML(value) {
      assert.equal(value, '');
      options = [];
    },
    append(option) {
      options.push(option);
    }
  };
  const syncInspectorTabSelect = createInspectorTabSelectSync({
    tabSelect,
    panel: { querySelectorAll: () => buttons },
    workspace: { dataset: { workMode: 'creative' } },
    documentObject: { createElement: () => ({}) }
  });

  syncInspectorTabSelect('worldbook');

  assert.deepEqual(options, [{ value: 'worldbook', textContent: '世界书' }]);
  assert.equal(tabSelect.value, 'worldbook');
});

test('theme preference loading fails closed to the supported default', () => {
  assert.equal(loadThemePreference({
    getItem: () => 'xianxia-scroll'
  }), 'soft');
  assert.equal(loadThemePreference({
    getItem: () => 'cyber'
  }), 'cyber');
  assert.equal(loadThemePreference({
    getItem: () => ''
  }), 'eye-care');
  assert.equal(loadThemePreference({
    getItem: () => {
      throw new Error('storage denied');
    }
  }), 'eye-care');
});
