import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../server/lib/jsonStore.js';
import { StoryProjectService, summarizeStoryProject } from '../server/services/storyProjectService.js';

test('story projects preserve a base script and attach multiple sessions', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'story-project-'));
  const service = new StoryProjectService(new JsonStore(rootDir));

  const project = await service.createProject({
    title: '太虚问道',
    description: '从太虚仙侠内容包开始。',
    basePackId: 'xianxia',
    basePackTitle: '太虚仙侠内容包',
    visualPackId: 'xianxia',
    bindings: {
      protagonistResourceId: 'character-wenxuezhao',
      loreModuleIds: ['lore-a', 'lore-a', 'lore-b']
    },
    runtimePolicy: {
      narrativeMode: 'strict',
      maxPromptTokens: 16000,
      maxInjectedCards: 30
    }
  });

  await service.attachSession(project.id, 'session-a');
  const attached = await service.attachSession(project.id, 'session-b');
  const projects = await service.listProjects();
  const summary = summarizeStoryProject(attached);

  assert.equal(project.spec, 'lra.story-project/v1');
  assert.deepEqual(project.bindings.loreModuleIds, ['lore-a', 'lore-b']);
  assert.equal(attached.activeSessionId, 'session-b');
  assert.deepEqual(attached.sessionIds, ['session-a', 'session-b']);
  assert.equal(projects.length, 1);
  assert.equal(summary.basePackId, 'xianxia');
  assert.equal(summary.sessionCount, 2);
  assert.equal(summary.lifecycleState, 'active');
  assert.equal(summary.canCreateSession, true);
});

test('story projects preserve a detached lifecycle snapshot after their pack is removed', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'story-project-'));
  const service = new StoryProjectService(new JsonStore(rootDir));
  const created = await service.createProject({ title: '旧卷', basePackId: 'custom-pack' });

  const detached = await service.saveProject({
    ...created,
    basePackId: '',
    lifecycle: {
      state: 'detached',
      detachedAt: '2026-08-03T12:00:00.000Z',
      reason: 'content-pack-deleted',
      sourcePack: {
        id: 'custom-pack',
        title: '旧剧本',
        version: '2.0.0',
        visualPackId: 'xianxia'
      }
    }
  });
  const summary = summarizeStoryProject(detached);

  assert.equal(detached.basePackId, '');
  assert.equal(detached.lifecycle.sourcePack.id, 'custom-pack');
  assert.equal(summary.lifecycleState, 'detached');
  assert.equal(summary.canCreateSession, false);
});

test('story projects require a base content pack', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'story-project-'));
  const service = new StoryProjectService(new JsonStore(rootDir));

  await assert.rejects(
    service.createProject({ title: '无根故事' }),
    /STORY_PROJECT_BASE_PACK_REQUIRED/
  );
});

test('story projects can be renamed and removed without deleting session records', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'story-project-'));
  const service = new StoryProjectService(new JsonStore(rootDir));
  const created = await service.createProject({
    title: '旧题名',
    basePackId: 'xianxia'
  });
  const attached = await service.attachSession(created.id, 'session-kept');

  const updated = await service.saveProject({
    ...attached,
    title: '太虚问道 · 新卷',
    description: '保留存档，只整理书架信息。'
  });
  const removed = await service.deleteProject(created.id);

  assert.equal(updated.title, '太虚问道 · 新卷');
  assert.equal(updated.description, '保留存档，只整理书架信息。');
  assert.deepEqual(removed.sessionIds, ['session-kept']);
  assert.equal(await service.getProject(created.id), null);
  assert.equal(await service.deleteProject(created.id), null);
});
