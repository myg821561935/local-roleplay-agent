import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectWorldBookTagMappingIssues,
  createWorldBookTagMappingController,
  extractWorldBookTagRegistryDocument
} from '../public/modules/worldBookTagMapping.js';

const tagId = '31f7b74e-9828-4cd2-b7ac-3d93840d471c';

test('tag mapping issues include only selected world books with opaque unresolved ids', () => {
  const resources = [createWorldBook('world-one', tagId), createWorldBook('world-two', '武侠')];

  assert.deepEqual(collectWorldBookTagMappingIssues(resources, ['world-one']), [{
    resourceId: 'world-one',
    resourceTitle: '待修复世界书',
    tags: [{ id: tagId, entryTitles: ['仅限武侠角色'] }]
  }]);
  assert.deepEqual(collectWorldBookTagMappingIssues(resources, ['world-two']), []);
});

test('settings sidecar extraction keeps only tag ids and names', () => {
  const extracted = extractWorldBookTagRegistryDocument({
    settings: {
      tags: [{ id: tagId, name: '武侠' }],
      api_key: 'must-not-leave-browser'
    },
    provider: { secret: 'also-private' }
  });

  assert.deepEqual(extracted, { tags: [{ id: tagId, name: '武侠' }] });
  assert.equal(JSON.stringify(extracted).includes('must-not-leave-browser'), false);
  assert.equal(JSON.stringify(extracted).includes('also-private'), false);
});

test('tag mapping controller applies a sanitized sidecar and refreshes preflight', async () => {
  const documentObject = createFakeDocument();
  const requests = [];
  const events = [];
  const controller = createWorldBookTagMappingController({
    documentObject,
    apiRequest: async (path, options) => {
      requests.push([path, options]);
      return {
        report: {
          appliedMappings: [{ id: tagId, name: '武侠' }],
          unresolvedAfter: []
        }
      };
    },
    loadResourceLibrary: async () => events.push('reload'),
    invalidateInspection: () => events.push('invalidate'),
    persistDraft: () => events.push('persist'),
    renderBuilder: () => events.push('render'),
    reportStatus: (message, tone) => events.push(`${tone}:${message}`)
  });
  const section = controller.render({
    resources: [createWorldBook('world-one', tagId)],
    selectedIds: ['world-one']
  });
  const file = findNode(section, (node) => node.type === 'file');
  const button = findNode(section, (node) => node.textContent === '读取并自动配对');
  file.files = [{
    size: 200,
    text: async () => JSON.stringify({
      settings: { tags: [{ id: tagId, name: '武侠' }], api_key: 'private-value' }
    })
  }];

  await button.listeners.click();

  assert.equal(requests[0][0], `/api/resource-library/resources/world-one/tag-registry`);
  assert.deepEqual(requests[0][1].body.registryDocument, {
    tags: [{ id: tagId, name: '武侠' }]
  });
  assert.equal(JSON.stringify(requests[0][1].body).includes('private-value'), false);
  assert.deepEqual(events.slice(1, 5), ['reload', 'invalidate', 'persist', 'render']);
  assert.match(events.at(-1), /已写入 1 个标签映射/);
});

test('manual mapping skips selected books that have no entered mapping', async () => {
  const secondId = '94efce85-103c-4cf0-94e7-c6005d8c7996';
  const documentObject = createFakeDocument();
  const requests = [];
  const controller = createWorldBookTagMappingController({
    documentObject,
    apiRequest: async (path, options) => {
      requests.push([path, options]);
      return { report: { appliedMappings: options.body.mappings, unresolvedAfter: [] } };
    }
  });
  const section = controller.render({
    resources: [createWorldBook('world-one', tagId), createWorldBook('world-two', secondId)],
    selectedIds: ['world-one', 'world-two']
  });
  const firstInput = findNode(section, (node) => node.dataset?.tagId === tagId);
  const button = findNode(section, (node) => node.textContent === '保存人工映射');
  firstInput.value = '武侠';

  await button.listeners.click();

  assert.equal(requests.length, 1);
  assert.match(requests[0][0], /world-one\/tag-registry$/);
  assert.deepEqual(requests[0][1].body.mappings, [{ id: tagId, name: '武侠' }]);
});

function createWorldBook(id, filterTag) {
  return {
    id,
    kind: 'worldbook',
    title: '待修复世界书',
    payload: {
      entries: [{
        title: '仅限武侠角色',
        characterFilter: {
          tags: [filterTag],
          unresolvedTagIds: filterTag.includes('-') ? [filterTag] : []
        }
      }]
    }
  };
}

function createFakeDocument() {
  return {
    createElement(tagName) {
      return {
        tagName,
        className: '',
        textContent: '',
        type: '',
        value: '',
        files: [],
        dataset: {},
        children: [],
        listeners: {},
        append(...nodes) { this.children.push(...nodes); },
        addEventListener(type, listener) { this.listeners[type] = listener; },
        setAttribute(name, value) { this[name] = value; },
        querySelectorAll(selector) {
          if (selector !== '[data-tag-id]') return [];
          return walk(this).filter((node) => node.dataset?.tagId);
        }
      };
    }
  };
}

function findNode(root, predicate) {
  return walk(root).find(predicate);
}

function walk(root) {
  return [root, ...(root?.children || []).flatMap(walk)];
}
