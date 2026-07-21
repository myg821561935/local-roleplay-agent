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
});

test('story projects require a base content pack', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'story-project-'));
  const service = new StoryProjectService(new JsonStore(rootDir));

  await assert.rejects(
    service.createProject({ title: '无根故事' }),
    /STORY_PROJECT_BASE_PACK_REQUIRED/
  );
});
