import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildEditableSessionConfig,
  buildSessionScopedConfig,
  hasCompleteSessionConfig,
  materializeSessionOwnedConfig
} from '../server/config/sessionScopedConfig.js';

const globalConfig = {
  characterCard: { name: '系统主角' },
  characterPresets: [{ id: 'system-actor', characterCard: { name: '系统演员' } }],
  groupMembers: [{ id: 'system-group', name: '系统群聊成员' }],
  promptModules: [{ id: 'system-prompt' }],
  worldBook: [{ id: 'system-world' }],
  worldSystems: { topology: { nodes: [{ id: 'system-world' }] } },
  persona: {},
  lightFrontend: {}
};

test('story-scoped narrative config fails closed for missing actor and group arrays', () => {
  const session = {
    config: {
      characterCard: { name: '导入角色' },
      promptModules: [{ id: 'custom-prompt' }],
      worldBook: [{ id: 'custom-world' }],
      persona: {},
      lightFrontend: {}
    }
  };

  const scoped = buildSessionScopedConfig(globalConfig, session);
  assert.deepEqual(scoped.characterPresets, []);
  assert.deepEqual(scoped.groupMembers, []);
  assert.deepEqual(scoped.worldSystems, {});
  assert.equal(scoped.characterCard.name, '导入角色');
});

test('explicit session actor group and world-system fields remain session owned', () => {
  const session = {
    config: {
      characterCard: { name: '导入角色' },
      characterPresets: [{ id: 'custom-actor' }],
      groupMembers: [{ id: 'custom-group', name: '自定义成员' }],
      promptModules: [],
      worldBook: [],
      worldSystems: { topology: { nodes: [{ id: 'custom-world' }] } },
      persona: {},
      lightFrontend: {}
    }
  };

  const editable = buildEditableSessionConfig(globalConfig, session);
  assert.deepEqual(editable.characterPresets, [{ id: 'custom-actor' }]);
  assert.deepEqual(editable.groupMembers, [{ id: 'custom-group', name: '自定义成员' }]);
  assert.equal(editable.worldSystems.topology.nodes[0].id, 'custom-world');
});

test('truly legacy sessions keep the global compatibility fallback', () => {
  const scoped = buildSessionScopedConfig(globalConfig, { config: {} });
  assert.equal(scoped.characterPresets[0].id, 'system-actor');
  assert.equal(scoped.groupMembers[0].id, 'system-group');
  assert.equal(scoped.worldSystems.topology.nodes[0].id, 'system-world');
});

test('new session configs materialize explicit empty ownership without copying global content', () => {
  const config = materializeSessionOwnedConfig({
    characterCard: { name: '本会话主角' },
    promptModules: [{ id: 'local-prompt' }],
    worldBook: []
  });
  const scoped = buildSessionScopedConfig(globalConfig, { config });

  assert.equal(hasCompleteSessionConfig(config), true);
  assert.deepEqual(config.persona, {});
  assert.deepEqual(config.lightFrontend, {});
  assert.equal(scoped.characterCard.name, '本会话主角');
  assert.equal(scoped.promptModules[0].id, 'local-prompt');
  assert.deepEqual(scoped.worldBook, []);
  assert.deepEqual(scoped.characterPresets, []);
  assert.deepEqual(scoped.groupMembers, []);
});
