import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { migrateData } from '../server/data/migrations.js';
import { exportCharacterCardPng } from '../server/character/characterCardExport.js';

test('GET /api/state returns config and session', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, { url: '/api/state' });
  const payload = response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.session.id, 'main');
  assert.equal(Array.isArray(payload.config.promptModules), true);
  assert.equal(payload.config.characterCard.name, '未命名主角');
  assert.equal(payload.session.authoring.spec, 'lra.authoring-ledger/v1');
  assert.equal(payload.session.settings.activeAgentProfileId, 'story-director');
});

test('light frontend MVU API applies revisioned declarative patches', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const first = await request(app, {
    method: 'PATCH',
    url: '/api/sessions/main/light-frontend/mvu',
    headers: { 'content-type': 'application/json' },
    body: {
      expectedRevision: 0,
      operations: [
        { op: 'set', path: 'relationships.shen', value: 10 },
        { op: 'increment', path: 'clues', value: 1 }
      ]
    }
  });
  const conflict = await request(app, {
    method: 'PATCH',
    url: '/api/sessions/main/light-frontend/mvu',
    headers: { 'content-type': 'application/json' },
    body: {
      expectedRevision: 0,
      operations: [{ op: 'increment', path: 'clues', value: 1 }]
    }
  });

  assert.equal(first.status, 200);
  assert.deepEqual(first.json().mvu, {
    enabled: true,
    values: { relationships: { shen: 10 }, clues: 1 },
    revision: 1
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.json().error, 'MVU_REVISION_CONFLICT');
});

test('authoring API lists profiles and persists a session ledger', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const profilesResponse = await request(app, { url: '/api/agent-profiles' });
  const saveResponse = await request(app, {
    method: 'PUT',
    url: '/api/sessions/main/authoring',
    headers: { 'content-type': 'application/json' },
    body: {
      agentProfileId: 'continuity-guard',
      ledger: {
        scene: {
          title: '旧档房',
          objective: '找到被抽走的卷宗',
          mustHide: ['内应身份'],
          forbidden: ['不要转成寻宝']
        },
        promises: [{ title: '旧案回响', status: 'open', importance: 'core' }],
        decisions: [{ title: '主角控制权', decision: '不代替用户行动', status: 'active' }]
      }
    }
  });
  const readResponse = await request(app, { url: '/api/sessions/main/authoring' });
  const saved = saveResponse.json();
  const read = readResponse.json();

  assert.equal(profilesResponse.status, 200);
  assert.ok(profilesResponse.json().profiles.some((profile) => profile.id === 'character-ensemble'));
  assert.equal(saveResponse.status, 200);
  assert.equal(saved.summary.openPromises, 1);
  assert.equal(saved.agentProfileId, 'continuity-guard');
  assert.equal(readResponse.status, 200);
  assert.equal(read.ledger.scene.title, '旧档房');
  assert.deepEqual(read.ledger.scene.mustHide, ['内应身份']);
  assert.equal(read.agentProfileId, 'continuity-guard');
});

test('story project API creates a pack-bound project and opening session', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const projectResponse = await request(app, {
    method: 'POST',
    url: '/api/story-projects',
    headers: { 'content-type': 'application/json' },
    body: { basePackId: 'xianxia', title: '太虚问道' }
  });
  const project = projectResponse.json().project;
  const sessionResponse = await request(app, {
    method: 'POST',
    url: `/api/story-projects/${encodeURIComponent(project.id)}/sessions`,
    headers: { 'content-type': 'application/json' },
    body: {}
  });
  const sessionPayload = sessionResponse.json();
  const state = (await request(app, {
    url: `/api/state?sessionId=${encodeURIComponent(sessionPayload.session.id)}`
  })).json();
  const projects = (await request(app, { url: '/api/story-projects' })).json().projects;
  const sessions = (await request(app, { url: '/api/sessions' })).json();

  assert.equal(projectResponse.status, 200);
  assert.equal(sessionResponse.status, 200);
  assert.equal(project.basePackId, 'xianxia');
  assert.equal(sessionPayload.session.storyProjectId, project.id);
  assert.equal(sessionPayload.session.basePackId, 'xianxia');
  assert.equal(sessionPayload.session.settings.visualContentPack, 'xianxia');
  assert.equal(state.config.characterCard.extensions.contentPack, 'xianxia');
  assert.equal(state.session.memory.ruleSystem.contentPackId, 'xianxia');
  assert.equal(projects[0].activeSessionId, sessionPayload.session.id);
  assert.equal(projects[0].sessionCount, 1);
  assert.ok(sessions.sessions.includes(sessionPayload.session.id));
  assert.equal(sessions.sessionSummaries[0].storyProjectId, project.id);
});

test('story project API rejects an unknown base content pack', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'POST',
    url: '/api/story-projects',
    headers: { 'content-type': 'application/json' },
    body: { basePackId: 'missing-pack' }
  });

  assert.equal(response.status, 404);
  assert.equal(response.json().error, 'CONTENT_PACK_NOT_FOUND');
});

test('story project API edits and removes a bookshelf entry while preserving its session', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const created = (await request(app, {
    method: 'POST',
    url: '/api/story-projects',
    headers: { 'content-type': 'application/json' },
    body: { basePackId: 'xianxia', title: '旧题名' }
  })).json().project;
  const session = (await request(app, {
    method: 'POST',
    url: `/api/story-projects/${encodeURIComponent(created.id)}/sessions`,
    headers: { 'content-type': 'application/json' },
    body: {}
  })).json().session;
  const updatedResponse = await request(app, {
    method: 'PUT',
    url: `/api/story-projects/${encodeURIComponent(created.id)}`,
    headers: { 'content-type': 'application/json' },
    body: { title: '太虚问道 · 新卷', description: '书架说明' }
  });
  const deleteResponse = await request(app, {
    method: 'DELETE',
    url: `/api/story-projects/${encodeURIComponent(created.id)}`,
    headers: { 'content-type': 'application/json' },
    body: {}
  });
  const readAfterDelete = await request(app, {
    url: `/api/story-projects/${encodeURIComponent(created.id)}`
  });
  const sessions = (await request(app, { url: '/api/sessions' })).json().sessions;

  assert.equal(updatedResponse.status, 200);
  assert.equal(updatedResponse.json().summary.title, '太虚问道 · 新卷');
  assert.equal(deleteResponse.status, 200);
  assert.deepEqual(deleteResponse.json().preservedSessionIds, [session.id]);
  assert.equal(readAfterDelete.status, 404);
  assert.ok(sessions.includes(session.id));
});

test('PUT /api/character-card saves character card', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'PUT',
    url: '/api/character-card',
    headers: { 'content-type': 'application/json' },
    body: {
      characterCard: {
        name: '沈观澜',
        role: '游侠',
        description: '初入江湖的刀客。',
        personality: '沉稳，重诺。',
        scenario: '正在调查镇武司旧案。',
        firstMessage: '夜雨打在刀鞘上。',
        exampleDialog: ['用户：你是谁？', '沈观澜：过路人。'],
        tags: ['武侠'],
        enabled: true
      }
    }
  });
  const payload = response.json();
  const state = (await request(app, { url: '/api/state' })).json();

  assert.equal(response.status, 200);
  assert.equal(payload.characterCard.name, '沈观澜');
  assert.equal(state.config.characterCard.name, '沈观澜');
});

test('PUT /api/character-card rejects non-object payload', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'PUT',
    url: '/api/character-card',
    headers: { 'content-type': 'application/json' },
    body: { characterCard: [] }
  });
  const payload = response.json();

  assert.equal(response.status, 400);
  assert.deepEqual(payload, { error: 'INVALID_CHARACTER_CARD' });
});

test('POST /api/character-card/import saves Character Card V2 and imports character book', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'POST',
    url: '/api/character-card/import',
    headers: { 'content-type': 'application/json' },
    body: {
      fileName: 'shen.json',
      mimeType: 'application/json',
      data: JSON.stringify(createV2CardPayload())
    }
  });
  const payload = response.json();
  const state = (await request(app, { url: '/api/state' })).json();

  assert.equal(response.status, 200);
  assert.equal(payload.characterCard.name, '沈观澜');
  assert.equal(payload.worldBook.length, 1);
  assert.ok(payload.worldBook.find((entry) => entry.title === '镇武司暗线'));
});

test('preset creation routes use UUID-backed ids', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const characterResponse = await request(app, {
    method: 'POST',
    url: '/api/character-presets',
    headers: { 'content-type': 'application/json' },
    body: { name: '夜雨刀客' }
  });
  const promptResponse = await request(app, {
    method: 'POST',
    url: '/api/prompt-presets',
    headers: { 'content-type': 'application/json' },
    body: { name: '叙事预设', promptModules: [] }
  });

  assert.equal(characterResponse.status, 200);
  assert.equal(promptResponse.status, 200);
  assert.match(characterResponse.json().preset.id, /^preset-[0-9a-f-]{36}$/);
  assert.match(promptResponse.json().preset.id, /^prompt-preset-[0-9a-f-]{36}$/);
});

test('POST /api/import/preview parses Character Card V2 without saving state', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'POST',
    url: '/api/import/preview',
    headers: { 'content-type': 'application/json' },
    body: {
      fileName: 'shen.json',
      mimeType: 'application/json',
      data: JSON.stringify(createV2CardPayload())
    }
  });
  const payload = response.json();
  const state = (await request(app, { url: '/api/state' })).json();

  assert.equal(response.status, 200);
  assert.equal(payload.preview.kind, 'character-card');
  assert.equal(payload.preview.summary.characterName, '沈观澜');
  assert.equal(payload.preview.summary.worldBookCount, 1);
  assert.equal(payload.preview.inspection.adapter.id, 'character-card-v2');
  assert.equal(payload.preview.inspection.resources.length, 2);
  assert.equal(payload.preview.inspection.dimensions.length, 5);
  assert.equal(payload.preview.inspection.verdict, 'recommended');
  assert.ok(payload.preview.inspection.estimatedTokens > 0);
  assert.equal(state.config.characterCard.name, '未命名主角');
});

test('POST /api/import/commit can store a resource without changing active creative config', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'POST',
    url: '/api/import/commit',
    headers: { 'content-type': 'application/json' },
    body: {
      payload: {
        fileName: 'shen.json',
        mimeType: 'application/json',
        data: JSON.stringify(createV2CardPayload())
      },
      source: { site: 'local-file', fileName: 'shen.json' },
      applyToActiveConfig: false
    }
  });
  const payload = response.json();
  const state = (await request(app, { url: '/api/state' })).json();
  const library = (await request(app, { url: '/api/resource-library/resources' })).json();

  assert.equal(response.status, 200);
  assert.equal(payload.applyMode, 'library-only');
  assert.equal(payload.libraryResources.length, 2);
  assert.equal(library.resources.length, 2);
  assert.equal(state.config.characterCard.name, '未命名主角');
});

test('POST /api/import/commit stores SillyTavern prompt presets without executing helper scripts', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const preset = {
    name: '社区叙事预设',
    settings: { max_context: 32768, max_completion_tokens: 4096, temperature: 0.8 },
    prompts: [
      {
        id: 'main',
        name: '主提示',
        enabled: true,
        role: 'system',
        content: '保持人物边界与长篇连续性。',
        position: { type: 'relative' }
      },
      {
        id: 'post-history',
        name: '历史后约束',
        enabled: true,
        role: 'user',
        content: '延续当前冲突，不解释系统规则。',
        position: { type: 'in_chat', depth: 1, order: 3 }
      }
    ],
    extensions: {
      tavern_helper: { scripts: [{ id: 'runtime-hook' }] }
    }
  };

  const previewResponse = await request(app, {
    method: 'POST',
    url: '/api/import/preview',
    headers: { 'content-type': 'application/json' },
    body: {
      payload: {
        fileName: 'community-preset.json',
        mimeType: 'application/json',
        data: JSON.stringify(preset)
      },
      source: { site: '类脑社区', fileName: 'community-preset.json' }
    }
  });
  const commitResponse = await request(app, {
    method: 'POST',
    url: '/api/import/commit',
    headers: { 'content-type': 'application/json' },
    body: {
      payload: {
        fileName: 'community-preset.json',
        mimeType: 'application/json',
        data: JSON.stringify(preset)
      },
      source: { site: '类脑社区', fileName: 'community-preset.json' },
      applyToActiveConfig: true
    }
  });
  const preview = previewResponse.json().preview;
  const committed = commitResponse.json();
  const state = (await request(app, { url: '/api/state' })).json();

  assert.equal(previewResponse.status, 200);
  assert.equal(preview.kind, 'prompt-preset');
  assert.equal(preview.inspection.adapter.id, 'sillytavern-prompt-preset');
  assert.equal(preview.inspection.communityCompatibility.readyToPlay, false);
  assert.equal(commitResponse.status, 200);
  assert.equal(committed.applyMode, 'prompt-library');
  assert.equal(committed.promptModuleCount, 2);
  assert.equal(committed.generationSettings.maxContext, 32768);
  assert.equal(committed.libraryResources[1].payload.position, 'in_chat');
  assert.equal(
    committed.libraryResources[0].payload.extensions.sillyTavernPreset.dependencySignals.tavern_helper.execution,
    'disabled'
  );
  assert.equal(state.config.promptModules.some((item) => item.title === '主提示'), false);
});

test('PNG character import persists its portrait through the session, library and custom story pack', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const png = exportCharacterCardPng({
    name: '谢停云',
    role: '问剑人',
    description: '负剑入山的年轻修士。',
    personality: '克制，敏锐。',
    scenario: '正在追查失踪的同门。',
    firstMessage: '山门外的雪没有停。',
    tags: ['仙侠']
  });

  const committed = await request(app, {
    method: 'POST',
    url: '/api/import/commit',
    headers: { 'content-type': 'application/json' },
    body: {
      payload: {
        fileName: 'xie-tingyun.png',
        mimeType: 'image/png',
        data: png.toString('base64'),
        encoding: 'base64'
      },
      sessionId: 'main'
    }
  });
  const committedPayload = committed.json();
  const portrait = committedPayload.characterCard.portrait;
  const state = (await request(app, { url: '/api/state?sessionId=main' })).json();
  const portraitResponse = await request(app, { url: portrait.url });
  const resources = (await request(app, { url: '/api/resource-library/resources' })).json().resources;
  const characterResource = resources.find((item) => item.kind === 'character');
  const packResponse = await request(app, {
    method: 'POST',
    url: '/api/resource-library/packs',
    headers: { 'content-type': 'application/json' },
    body: {
      title: '雪夜问剑',
      basePackId: 'xianxia',
      characterResourceId: characterResource.id,
      worldBookResourceIds: [],
      useCharacterPortraitAsBackground: true
    }
  });
  const pack = packResponse.json().pack;
  const projectResponse = await request(app, {
    method: 'POST',
    url: '/api/story-projects',
    headers: { 'content-type': 'application/json' },
    body: { basePackId: pack.id, title: '雪夜问剑' }
  });
  const project = projectResponse.json().project;
  const sessionResponse = await request(app, {
    method: 'POST',
    url: `/api/story-projects/${encodeURIComponent(project.id)}/sessions`,
    headers: { 'content-type': 'application/json' },
    body: {}
  });

  assert.equal(committed.status, 200);
  assert.match(portrait.assetId, /^[a-f0-9]{64}$/);
  assert.equal(portrait.width, 256);
  assert.equal(portrait.height, 256);
  assert.equal(state.config.characterCard.portrait.url, portrait.url);
  assert.equal(characterResource.payload.portrait.url, portrait.url);
  assert.equal(portraitResponse.status, 200);
  assert.equal(portraitResponse.headers['content-type'], 'image/png');
  assert.deepEqual(portraitResponse.buffer, png);
  assert.equal(packResponse.status, 200);
  assert.equal(pack.characterCard.portrait.url, portrait.url);
  assert.equal(pack.stageBackground.url, portrait.url);
  assert.equal(pack.stageBackground.fit, 'portrait');
  assert.equal(sessionResponse.status, 200);
  assert.equal(sessionResponse.json().session.settings.backgroundImage, portrait.url);
  assert.equal(sessionResponse.json().session.settings.backgroundFit, 'portrait');
});

test('GET /api/import-sources lists online material sources', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, { url: '/api/import-sources' });
  const payload = response.json();

  assert.equal(response.status, 200);
  assert.ok(payload.sources.find((source) => source.id === 'chub'));
  assert.ok(payload.sources.find((source) => source.id === 'aicharactercards'));
});

test('GET /api/import-sources/search searches source cards with injected fetch', async () => {
  const app = createApp({
    rootDir: await createTestRoot(),
    fetchImpl: async (url) => {
      const requestUrl = new URL(String(url));
      assert.equal(requestUrl.hostname, 'gateway.chub.ai');
      assert.equal(requestUrl.searchParams.get('search'), 'wuxia');
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({
          results: [{
            name: '沈观澜',
            fullPath: 'liufeng/shen-guanlan',
            nTokens: 2048,
            topics: ['wuxia'],
            max_res_url: 'https://avatars.charhub.io/characters/liufeng/shen-guanlan/chara_card_v2.png'
          }]
        })
      };
    }
  });

  const response = await request(app, { url: '/api/import-sources/search?source=chub&kind=characters&q=wuxia' });
  const payload = response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.source.id, 'chub');
  assert.equal(payload.items[0].title, '沈观澜');
  assert.equal(payload.items[0].downloadable, true);
});

test('POST /api/import-sources/download previews downloaded PNG cards', async () => {
  const png = createPngWithTextChunk(
    'Chara',
    Buffer.from(JSON.stringify(createV2CardPayload()), 'utf8').toString('base64')
  );
  const app = createApp({
    rootDir: await createTestRoot(),
    fetchImpl: async (url) => {
      assert.equal(String(url), 'https://avatars.charhub.io/characters/liufeng/shen-guanlan/chara_card_v2.png');
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'image/png' },
        arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength)
      };
    }
  });

  const response = await request(app, {
    method: 'POST',
    url: '/api/import-sources/download',
    headers: { 'content-type': 'application/json' },
    body: {
      source: 'chub',
      downloadUrl: 'https://avatars.charhub.io/characters/liufeng/shen-guanlan/chara_card_v2.png',
      fileName: 'shen-guanlan.png'
    }
  });
  const payload = response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.preview.kind, 'character-card');
  assert.equal(payload.preview.summary.characterName, '沈观澜');
  assert.equal(payload.payload.mimeType, 'image/png');
});

test('POST /api/import/commit saves standalone world book import', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'POST',
    url: '/api/import/commit',
    headers: { 'content-type': 'application/json' },
    body: {
      payload: {
        fileName: 'world.json',
        mimeType: 'application/json',
        data: JSON.stringify({
          entries: {
            '1': {
              comment: '听雨楼',
              key: ['听雨楼'],
              content: '听雨楼贩卖秘密。',
              enabled: true
            }
          }
        })
      }
    }
  });
  const payload = response.json();
  const imported = payload.worldBook.entries.filter((entry) => entry.source === 'sillytavern-worldbook');

  assert.equal(response.status, 200);
  assert.equal(payload.preview.kind, 'world-book');
  assert.equal(imported.length, 1);
  assert.equal(imported[0].title, '听雨楼');
  assert.equal(payload.libraryResources.length, 1);
  const library = (await request(app, { url: '/api/resource-library/resources' })).json();
  assert.equal(library.resources.length, 1);
  assert.equal(library.resources[0].title, '导入的世界书');
});

test('v0.2 resource library deduplicates imports and composes an applicable custom pack', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const importBody = {
    payload: {
      fileName: 'shen.json',
      mimeType: 'application/json',
      data: JSON.stringify(createV2CardPayload())
    },
    source: {
      adapterId: 'liunao-community-generic',
      site: '类脑社区',
      author: '社区作者',
      fileName: 'shen.json'
    }
  };
  const firstImport = await request(app, {
    method: 'POST',
    url: '/api/import/commit',
    headers: { 'content-type': 'application/json' },
    body: importBody
  });
  const secondImport = await request(app, {
    method: 'POST',
    url: '/api/import/commit',
    headers: { 'content-type': 'application/json' },
    body: importBody
  });
  const firstPayload = firstImport.json();
  const resources = (await request(app, { url: '/api/resource-library/resources' })).json().resources;
  const character = resources.find((item) => item.kind === 'character');
  const worldBook = resources.find((item) => item.kind === 'worldbook');

  assert.equal(firstImport.status, 200);
  assert.equal(firstPayload.preview.inspection.adapter.id, 'liunao-community-generic');
  assert.equal(secondImport.json().libraryResources.every((item) => item.importStatus === 'duplicate'), true);
  assert.equal(resources.length, 2);
  assert.equal(character.source.site, '类脑社区');

  const createPackResponse = await request(app, {
    method: 'POST',
    url: '/api/resource-library/packs',
    headers: { 'content-type': 'application/json' },
    body: {
      title: '听雨仙途',
      basePackId: 'xianxia',
      characterResourceId: character.id,
      worldBookResourceIds: [worldBook.id]
    }
  });
  const createdPack = createPackResponse.json().pack;
  assert.equal(createPackResponse.status, 200);
  assert.equal(createdPack.characterCard.name, '沈观澜');
  assert.equal(createdPack.visualPackId, 'xianxia');

  const listedPacks = (await request(app, { url: '/api/content-packs' })).json().contentPacks;
  assert.ok(listedPacks.find((pack) => pack.id === createdPack.id && pack.custom === true));

  const applyResponse = await request(app, {
    method: 'POST',
    url: `/api/content-packs/${createdPack.id}/apply`,
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'main' }
  });
  const applied = applyResponse.json();
  assert.equal(applyResponse.status, 200);
  assert.equal(applied.appliedPack.visualPackId, 'xianxia');
  assert.equal(applied.characterCard.name, '沈观澜');
  assert.equal(applied.session.memory.resourcePackId, createdPack.id);
  assert.equal(applied.session.memory.ruleSystem.contentPackId, createdPack.id);
  assert.ok(applied.worldBook.find((entry) => entry.title === '镇武司暗线'));
  assert.equal((await request(app, { url: '/api/state' })).json().config.characterCard.name, '沈观澜');
});

test('PATCH /api/resource-library/resources/:id updates asset center metadata', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  await request(app, {
    method: 'POST',
    url: '/api/import/commit',
    headers: { 'content-type': 'application/json' },
    body: {
      payload: {
        fileName: 'shen.json',
        mimeType: 'application/json',
        data: JSON.stringify(createV2CardPayload())
      },
      source: { site: '类脑社区', author: '社区作者' },
      applyToActiveConfig: false
    }
  });
  const resources = (await request(app, { url: '/api/resource-library/resources' })).json().resources;
  const character = resources.find((item) => item.kind === 'character');

  const response = await request(app, {
    method: 'PATCH',
    url: `/api/resource-library/resources/${encodeURIComponent(character.id)}`,
    headers: { 'content-type': 'application/json' },
    body: {
      title: '听雨刀客',
      tags: ['武侠', '旧案'],
      collections: ['英雄群像'],
      favorite: true
    }
  });
  const updated = response.json().resource;
  const search = (await request(app, { url: '/api/resource-library/resources?query=英雄群像' })).json().resources;

  assert.equal(response.status, 200);
  assert.equal(updated.title, '听雨刀客');
  assert.equal(updated.favorite, true);
  assert.deepEqual(updated.collections, ['英雄群像']);
  assert.equal(search[0].id, character.id);
});

test('PATCH /api/resource-library/resources/:id/content manages world books and prompt presets', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  await request(app, {
    method: 'POST',
    url: '/api/import/commit',
    headers: { 'content-type': 'application/json' },
    body: {
      payload: {
        fileName: 'shen.json',
        mimeType: 'application/json',
        data: JSON.stringify(createV2CardPayload())
      },
      source: { site: 'local-file' },
      applyToActiveConfig: false
    }
  });
  const resources = (await request(app, { url: '/api/resource-library/resources' })).json().resources;
  const worldBook = resources.find((item) => item.kind === 'worldbook');
  const character = resources.find((item) => item.kind === 'character');
  const worldBookResponse = await request(app, {
    method: 'PATCH',
    url: `/api/resource-library/resources/${encodeURIComponent(worldBook.id)}/content`,
    headers: { 'content-type': 'application/json' },
    body: {
      payload: {
        entries: [{
          id: 'lore-revised',
          title: '修订设定',
          keywords: ['修订'],
          content: '这是素材中心保存后的世界书内容。',
          enabled: true
        }]
      }
    }
  });
  const promptCreated = await request(app, {
    method: 'POST',
    url: '/api/resource-library/resources/prompt',
    headers: { 'content-type': 'application/json' },
    body: {
      title: '叙事约束',
      content: '保持角色视角。',
      enabled: true,
      source: { site: 'local-file' }
    }
  });
  const prompt = promptCreated.json().resources[0];
  const promptResponse = await request(app, {
    method: 'PATCH',
    url: `/api/resource-library/resources/${encodeURIComponent(prompt.id)}/content`,
    headers: { 'content-type': 'application/json' },
    body: {
      title: '叙事约束 · 修订',
      payload: {
        ...prompt.payload,
        role: 'system',
        content: '保持角色视角，不替用户决定行动。',
        enabled: true
      }
    }
  });
  const unsupported = await request(app, {
    method: 'PATCH',
    url: `/api/resource-library/resources/${encodeURIComponent(character.id)}/content`,
    headers: { 'content-type': 'application/json' },
    body: { payload: character.payload }
  });

  assert.equal(worldBookResponse.status, 200);
  assert.equal(worldBookResponse.json().resource.payload.entries[0].title, '修订设定');
  assert.equal(promptResponse.status, 200);
  assert.equal(promptResponse.json().resource.title, '叙事约束 · 修订');
  assert.equal(promptResponse.json().resource.payload.content.includes('不替用户决定行动'), true);
  assert.equal(unsupported.status, 400);
  assert.equal(unsupported.json().error, 'RESOURCE_CONTENT_KIND_UNSUPPORTED');
});

test('POST /api/resource-library/resources/:id/reevaluate refreshes legacy diagnostics', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  await request(app, {
    method: 'POST',
    url: '/api/import/commit',
    headers: { 'content-type': 'application/json' },
    body: {
      payload: {
        fileName: 'shen.json',
        mimeType: 'application/json',
        data: JSON.stringify(createV2CardPayload())
      },
      source: { site: '类脑社区', author: '社区作者' },
      applyToActiveConfig: false
    }
  });
  const resources = (await request(app, { url: '/api/resource-library/resources' })).json().resources;
  const character = resources.find((item) => item.kind === 'character');

  const response = await request(app, {
    method: 'POST',
    url: `/api/resource-library/resources/${encodeURIComponent(character.id)}/reevaluate`,
    headers: { 'content-type': 'application/json' },
    body: {}
  });

  assert.equal(response.status, 200);
  assert.equal(response.json().resource.id, character.id);
  assert.ok(response.json().resource.diagnostics.score > 0);
  assert.ok(response.json().resource.diagnostics.communityCompatibility);
  assert.equal(response.json().resource.payload.extensions.local_roleplay_agent.enrichment.version, 1);
});

test('PATCH /api/resource-library/resources/:id rejects non-object metadata', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const response = await request(app, {
    method: 'PATCH',
    url: '/api/resource-library/resources/missing',
    headers: { 'content-type': 'application/json' },
    body: null
  });

  assert.equal(response.status, 400);
  assert.equal(response.json().error, 'RESOURCE_METADATA_INVALID');
});

test('resource library batch endpoints organize, export and remove selected assets', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  await request(app, {
    method: 'POST',
    url: '/api/import/commit',
    headers: { 'content-type': 'application/json' },
    body: {
      payload: {
        fileName: 'shen.json',
        mimeType: 'application/json',
        data: JSON.stringify(createV2CardPayload())
      },
      source: { site: '类脑社区', author: '社区作者' },
      applyToActiveConfig: false
    }
  });
  const resources = (await request(app, { url: '/api/resource-library/resources' })).json().resources;
  const resourceIds = resources.map((item) => item.id);

  const organizeResponse = await request(app, {
    method: 'PATCH',
    url: '/api/resource-library/resources',
    headers: { 'content-type': 'application/json' },
    body: { resourceIds, tags: ['候选'], collections: ['新剧本'], mode: 'merge' }
  });
  const exportResponse = await request(app, {
    method: 'POST',
    url: '/api/resource-library/resources/export',
    headers: { 'content-type': 'application/json' },
    body: { resourceIds }
  });
  const deleteResponse = await request(app, {
    method: 'DELETE',
    url: '/api/resource-library/resources',
    headers: { 'content-type': 'application/json' },
    body: { resourceIds: [resourceIds[0]] }
  });

  assert.equal(organizeResponse.status, 200);
  assert.equal(organizeResponse.json().updated.length, resourceIds.length);
  assert.deepEqual(organizeResponse.json().updated[0].collections, ['新剧本']);
  assert.equal(exportResponse.status, 200);
  assert.equal(exportResponse.json().bundle.schema, 'local-roleplay-agent.asset-bundle/v1');
  assert.equal(exportResponse.json().bundle.resources.length, resourceIds.length);
  assert.equal(deleteResponse.status, 200);
  assert.deepEqual(deleteResponse.json().removed, [resourceIds[0]]);
});

test('custom story composition endpoint previews conflicts and creates an original baseline pack', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const original = {
    title: '九州残卷',
    worldBookMergeMode: 'smart',
    customBaseline: {
      worldName: '九州残卷',
      genre: '低魔武侠',
      premise: '九州诸侯割据，盐路与驿道决定江湖门派的兴衰。',
      proseStyle: '重对白潜台词和行动后果。',
      hardRules: '伤势、路引和钱粮持续有效。',
      visualPackId: 'yingxiongzhi'
    }
  };
  const inspectionResponse = await request(app, {
    method: 'POST',
    url: '/api/resource-library/packs/inspect',
    headers: { 'content-type': 'application/json' },
    body: original
  });
  const createResponse = await request(app, {
    method: 'POST',
    url: '/api/resource-library/packs',
    headers: { 'content-type': 'application/json' },
    body: original
  });
  const pack = createResponse.json().pack;
  const projectResponse = await request(app, {
    method: 'POST',
    url: '/api/story-projects',
    headers: { 'content-type': 'application/json' },
    body: { basePackId: pack.id, title: '九州残卷 · 第一卷' }
  });

  assert.equal(inspectionResponse.status, 200);
  assert.equal(inspectionResponse.json().composition.summary.finalEntries, 2);
  assert.equal(createResponse.status, 200);
  assert.equal(pack.resourceManifest.basePackId, '');
  assert.equal(pack.visualPackId, 'yingxiongzhi');
  assert.equal(projectResponse.status, 200);
  assert.equal(projectResponse.json().project.basePackId, pack.id);
});

test('custom pack API edits bookshelf metadata and removes only the stored pack', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const created = (await request(app, {
    method: 'POST',
    url: '/api/resource-library/packs',
    headers: { 'content-type': 'application/json' },
    body: {
      title: '旧剧本名',
      customBaseline: { worldName: '九州残卷', genre: '低魔武侠' }
    }
  })).json().pack;
  const updatedResponse = await request(app, {
    method: 'PATCH',
    url: `/api/resource-library/packs/${encodeURIComponent(created.id)}`,
    headers: { 'content-type': 'application/json' },
    body: { title: '九州残卷 · 新卷', description: '书架说明', sessionTitle: '九州残卷' }
  });
  const deleteResponse = await request(app, {
    method: 'DELETE',
    url: `/api/resource-library/packs/${encodeURIComponent(created.id)}`,
    headers: { 'content-type': 'application/json' },
    body: {}
  });
  const packs = (await request(app, { url: '/api/content-packs' })).json().contentPacks;

  assert.equal(updatedResponse.status, 200);
  assert.equal(updatedResponse.json().pack.title, '九州残卷 · 新卷');
  assert.equal(updatedResponse.json().pack.manifest.title, '九州残卷 · 新卷');
  assert.equal(deleteResponse.status, 200);
  assert.equal(packs.some((pack) => pack.id === created.id), false);
});

test('v0.2.2 plugin manifest preview installs declarative adapters and blocks executable plugins', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const manifest = {
    spec: 'lra.plugin/v1',
    id: 'community.rain-night',
    version: '1.0.0',
    name: '雨夜适配',
    engine: '>=0.2.2 <1.0.0',
    adapters: [{
      id: 'rain-night-lore',
      label: '雨夜世界书',
      kinds: ['worldbook'],
      formats: ['json'],
      match: { previewKinds: ['world-book'], sourceIncludes: ['rain-night'] }
    }]
  };
  const preview = await request(app, {
    method: 'POST',
    url: '/api/import/preview',
    headers: { 'content-type': 'application/json' },
    body: { payload: { mimeType: 'application/json', data: JSON.stringify(manifest) } }
  });
  const committed = await request(app, {
    method: 'POST',
    url: '/api/import/commit',
    headers: { 'content-type': 'application/json' },
    body: { payload: { mimeType: 'application/json', data: JSON.stringify(manifest) } }
  });
  const plugins = (await request(app, { url: '/api/plugins' })).json();
  const adapters = (await request(app, { url: '/api/resource-library/adapters' })).json().adapters;
  const blocked = await request(app, {
    method: 'POST',
    url: '/api/import/commit',
    headers: { 'content-type': 'application/json' },
    body: { payload: { mimeType: 'application/json', data: JSON.stringify({ ...manifest, id: 'community.unsafe', script: 'run.js' }) } }
  });

  assert.equal(preview.status, 200);
  assert.equal(preview.json().preview.kind, 'plugin-manifest');
  assert.equal(preview.json().preview.inspection.adapter.id, 'lra-plugin-manifest-v1');
  assert.equal(committed.status, 200);
  assert.equal(committed.json().applyMode, 'plugin-registry');
  assert.ok(plugins.plugins.find((item) => item.id === manifest.id && item.origin === 'local'));
  assert.ok(adapters.find((item) => item.id === 'rain-night-lore'));
  assert.equal(blocked.status, 422);
});

test('v0.2.2 imports, exports and applies a versioned content pack bundle', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const bundle = createContentPackBundlePayload();
  const preview = await request(app, {
    method: 'POST',
    url: '/api/import/preview',
    headers: { 'content-type': 'application/json' },
    body: { payload: { mimeType: 'application/json', data: JSON.stringify(bundle) } }
  });
  const committed = await request(app, {
    method: 'POST',
    url: '/api/import/commit',
    headers: { 'content-type': 'application/json' },
    body: {
      payload: { mimeType: 'application/json', fileName: 'rain-night.json', data: JSON.stringify(bundle) },
      source: { site: 'local-file', fileName: 'rain-night.json' }
    }
  });
  const installed = committed.json().pack;
  const listed = (await request(app, { url: '/api/content-packs' })).json().contentPacks;
  const exported = await request(app, { url: `/api/content-packs/${installed.id}/export` });
  const applied = await request(app, {
    method: 'POST',
    url: `/api/content-packs/${installed.id}/apply`,
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'main' }
  });

  assert.equal(preview.status, 200);
  assert.equal(preview.json().preview.inspection.adapter.id, 'lra-content-pack-v1');
  assert.equal(preview.json().preview.inspection.canImport, true);
  assert.equal(committed.status, 200);
  assert.equal(committed.json().applyMode, 'content-pack-library');
  assert.equal(committed.json().installStatus, 'created');
  assert.ok(listed.find((pack) => pack.id === installed.id && pack.version === '1.1.0'));
  assert.equal(exported.status, 200);
  assert.equal(exported.json().manifest.id, 'community.rain-night');
  assert.equal(applied.status, 200);
  assert.equal(applied.json().characterCard.name, '沈观澜');
});

test('GET /api/content-packs lists linked genre packs', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, { url: '/api/content-packs' });
  const payload = response.json();

  assert.equal(response.status, 200);
  assert.ok(payload.contentPacks.find((pack) => pack.id === 'xuanhuan'));
  const lingyi = payload.contentPacks.find((pack) => pack.id === 'lingyi');
  assert.ok(lingyi);
  assert.equal(lingyi.title, '民俗灵异内容包');
  assert.equal(lingyi.counts.promptModules >= 10, true);
  assert.equal(lingyi.counts.worldBook >= 16, true);
  assert.equal(lingyi.counts.memoryCards >= 4, true);
  assert.equal(lingyi.ruleSystem.id, 'lingyi-rule-system');
  assert.match(lingyi.ruleSystem.boundary, /不引入玄幻修炼/);
  const mingmo = payload.contentPacks.find((pack) => pack.id === 'mingmo');
  assert.ok(mingmo);
  assert.equal(mingmo.title, '明末风云内容包');
  assert.equal(mingmo.counts.promptModules >= 10, true);
  assert.equal(mingmo.counts.worldBook >= 18, true);
  assert.equal(mingmo.counts.memoryCards >= 4, true);
  assert.equal(mingmo.ruleSystem.id, 'mingmo-rule-system');
  assert.match(mingmo.ruleSystem.boundary, /银粮/);
  const yingxiongzhi = payload.contentPacks.find((pack) => pack.id === 'yingxiongzhi');
  assert.ok(yingxiongzhi);
  assert.equal(yingxiongzhi.characterName, '卢云');
  assert.equal(yingxiongzhi.counts.worldBook >= 148, true);
  assert.equal(yingxiongzhi.counts.characterPresets, 12);
});

test('GET /api/content-packs/:packId/characters exposes curated Hero presets', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, { url: '/api/content-packs/yingxiongzhi/characters' });
  const payload = response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.characterPresets.length, 12);
  assert.ok(payload.characterPresets.find((preset) => preset.characterCard.name === '卢云'));
  assert.ok(payload.characterPresets.find((preset) => preset.characterCard.name === '杨肃观'));
  assert.ok(payload.characterPresets.every((preset) => preset.characterCard.extensions.contentPack === 'yingxiongzhi'));
});

test('POST /api/content-packs/:packId/apply synchronizes prompt world character and facts', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'POST',
    url: '/api/content-packs/lingyi/apply',
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'main' }
  });
  const payload = response.json();
  const state = (await request(app, { url: '/api/state' })).json();

  assert.equal(response.status, 200);
  assert.equal(payload.appliedPack.id, 'lingyi');
  assert.ok(payload.promptModules.find((module) => module.id === 'lingyi-fear-pacing'));
  assert.ok(payload.worldBook.find((entry) => entry.id === 'location-yongan-building'));
  assert.equal(payload.characterCard.name, '陈默');
  assert.equal(payload.session.memory.worldState.protagonist.name, '陈默');
  assert.equal(payload.session.memory.ruleSystem.id, 'lingyi-rule-system');
  assert.ok(payload.session.memory.memoryCards.find((fact) => fact.id === 'fact-lingyi-current-case'));
  assert.equal(payload.session.config.contentPackId, 'lingyi');
  assert.equal(payload.session.config.characterPresets.length >= 4, true);
  assert.equal(payload.session.memory.simulation.actors.length >= 4, true);
  assert.equal(state.config.characterCard.name, '陈默');
  assert.ok(state.config.worldBook.find((entry) => entry.id === 'quest-smile-murders'));
  assert.equal(state.session.memory.worldState.flags.genre, 'lingyi');
});

test('POST /api/content-packs/:packId/apply synchronizes Mingmo historical pack', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'POST',
    url: '/api/content-packs/mingmo/apply',
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'main' }
  });
  const payload = response.json();
  const state = (await request(app, { url: '/api/state' })).json();

  assert.equal(response.status, 200);
  assert.equal(payload.appliedPack.id, 'mingmo');
  assert.ok(payload.promptModules.find((module) => module.id === 'mingmo-history-pacing'));
  assert.ok(payload.worldBook.find((entry) => entry.id === 'event-chongzhen-last-years'));
  assert.equal(payload.characterCard.name, '顾怀砚');
  assert.equal(payload.session.memory.worldState.protagonist.name, '顾怀砚');
  assert.equal(payload.session.memory.ruleSystem.id, 'mingmo-rule-system');
  assert.ok(payload.session.memory.memoryCards.find((fact) => fact.id === 'fact-mingmo-current-crisis'));
  assert.equal(state.config.characterCard.name, '顾怀砚');
  assert.ok(state.config.worldBook.find((entry) => entry.id === 'quest-secret-edict'));
  assert.equal(state.session.memory.worldState.flags.genre, 'mingmo');
});

test('POST /api/content-packs/:packId/apply synchronizes Hero multi-agent pack', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'POST',
    url: '/api/content-packs/yingxiongzhi/apply',
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'main' }
  });
  const payload = response.json();
  const state = (await request(app, { url: '/api/state' })).json();

  assert.equal(response.status, 200);
  assert.equal(payload.appliedPack.id, 'yingxiongzhi');
  assert.equal(payload.characterCard.name, '卢云');
  assert.equal(payload.worldBook.filter((entry) => entry.type === 'story-node').length, 45);
  assert.ok(payload.worldBook.find((entry) => entry.extensions?.agentId === 'wu_chonghua'));
  assert.equal(payload.session.memory.ruleSystem.id, 'yingxiongzhi-rules');
  assert.equal(state.session.memory.worldState.flags.currentNode, 'E02');
  assert.equal(state.config.worldBook.length >= 148, true);
});

test('applying a content pack replaces stale session-scoped character and world book', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const createResponse = await request(app, {
    method: 'POST',
    url: '/api/sessions',
    headers: { 'content-type': 'application/json' },
    body: {
      id: 'story_pack_switch',
      title: '题材切换验证',
      packId: 'yingxiongzhi'
    }
  });
  const before = (await request(app, { url: '/api/state?sessionId=story_pack_switch' })).json();
  const applyResponse = await request(app, {
    method: 'POST',
    url: '/api/content-packs/xianxia/apply',
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'story_pack_switch' }
  });
  const payload = applyResponse.json();
  const after = (await request(app, { url: '/api/state?sessionId=story_pack_switch' })).json();

  assert.equal(createResponse.status, 200);
  assert.equal(before.config.characterCard.extensions.contentPack, 'yingxiongzhi');
  assert.ok(before.config.worldBook.find((entry) => entry.id === 'constant-yingxiongzhi-premise'));
  assert.equal(applyResponse.status, 200);
  assert.equal(payload.session.config.characterCard.extensions.contentPack, 'xianxia');
  assert.equal(after.config.characterCard.extensions.contentPack, 'xianxia');
  assert.ok(after.config.worldBook.find((entry) => entry.id === 'constant-xianxia-premise'));
  assert.equal(after.config.worldBook.some((entry) => entry.id === 'constant-yingxiongzhi-premise'), false);
  assert.equal(after.session.memory.worldState.flags.genre, 'xianxia');
});

test('POST /api/content-packs/:packId/apply rejects missing pack', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'POST',
    url: '/api/content-packs/missing/apply',
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'main' }
  });

  assert.equal(response.status, 404);
  assert.deepEqual(response.json(), { error: 'CONTENT_PACK_NOT_FOUND' });
});

test('GET /api/state returns selected session scoped config', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const createResponse = await request(app, {
    method: 'POST',
    url: '/api/sessions',
    headers: { 'content-type': 'application/json' },
    body: {
      id: 'story_lingyi',
      title: '灵异支线',
      packId: 'lingyi'
    }
  });
  const response = await request(app, { url: '/api/state?sessionId=story_lingyi' });
  const payload = response.json();

  assert.equal(createResponse.status, 200);
  assert.equal(response.status, 200);
  assert.equal(payload.session.id, 'story_lingyi');
  assert.equal(payload.config.characterCard.name, '陈默');
  assert.ok(payload.config.worldBook.find((entry) => entry.id === 'quest-smile-murders'));
  assert.ok(payload.config.promptModules.find((module) => module.id === 'lingyi-fear-pacing'));
  assert.ok(payload.config.providers);
  assert.equal(payload.session.memory.ruleSystem.id, 'lingyi-rule-system');
});

test('session scoped editors initialize config for legacy sessions', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const worldResponse = await request(app, {
    method: 'PUT',
    url: '/api/world-book',
    headers: { 'content-type': 'application/json' },
    body: {
      sessionId: 'main',
      worldBook: [{
        id: 'manual-town',
        title: '雾镇',
        keywords: ['雾镇'],
        content: '雾镇三更后无人点灯。',
        enabled: true
      }]
    }
  });
  const characterResponse = await request(app, {
    method: 'PUT',
    url: '/api/character-card',
    headers: { 'content-type': 'application/json' },
    body: {
      sessionId: 'main',
      characterCard: {
        name: '周闻灯',
        role: '守夜人',
        enabled: true
      }
    }
  });
  const promptResponse = await request(app, {
    method: 'PUT',
    url: '/api/prompt-modules',
    headers: { 'content-type': 'application/json' },
    body: {
      sessionId: 'main',
      promptModules: [{
        id: 'local-rule',
        title: '本会话规则',
        content: '保持民俗悬疑氛围。',
        enabled: true
      }]
    }
  });
  const state = (await request(app, { url: '/api/state?sessionId=main' })).json();

  assert.equal(worldResponse.status, 200);
  assert.equal(characterResponse.status, 200);
  assert.equal(promptResponse.status, 200);
  assert.equal(state.config.characterCard.name, '周闻灯');
  assert.equal(state.config.worldBook[0].title, '雾镇');
  assert.equal(state.config.promptModules[0].title, '本会话规则');
});

test('PUT /api/session/settings saves per-session provider settings', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'PUT',
    url: '/api/session/settings',
    headers: { 'content-type': 'application/json' },
    body: {
      sessionId: 'main',
      settings: {
        providerId: 'scene',
        recentPairs: 12,
        maxInjectedCards: 7,
        maxPromptTokens: 12000,
        narrativeMode: 'strict',
        taskProviderOverrides: { fact: 'fact-local', unknown: 'ignored' },
        taskFallbackOverrides: { summary: ['summary-backup'], unknown: ['ignored'] },
        backgroundImage: '/assets/wuxia-stage.png',
        theme: 'default-dark',
        visualContentPack: 'yingxiongzhi'
      }
    }
  });
  const payload = response.json();
  const state = (await request(app, { url: '/api/state' })).json();

  assert.equal(response.status, 200);
  assert.equal(payload.session.settings.providerId, 'scene');
  assert.equal(payload.session.settings.recentPairs, 12);
  assert.equal(payload.session.settings.maxInjectedCards, 7);
  assert.equal(payload.session.settings.maxPromptTokens, 12000);
  assert.equal(payload.session.settings.narrativeMode, 'strict');
  assert.deepEqual(payload.session.settings.taskProviderOverrides, { fact: 'fact-local' });
  assert.deepEqual(payload.session.settings.taskFallbackOverrides, { summary: ['summary-backup'] });
  assert.equal(payload.session.settings.backgroundImage, '/assets/wuxia-stage.png');
  assert.equal(payload.session.settings.theme, 'default-dark');
  assert.equal(payload.session.settings.visualContentPack, 'yingxiongzhi');
  assert.equal(state.session.settings.narrativeMode, 'strict');
  assert.deepEqual(state.session.settings, payload.session.settings);
});

test('POST /api/rewrite returns a Magic Rewrite suggestion without mutating chat', async () => {
  const app = createApp({
    rootDir: await createTestRoot(),
    providerClient: {
      complete: async ({ messages }) => {
        assert.match(messages[0].content, /Magic Rewrite/);
        assert.match(messages.at(-1).content, /我推门进去/);
        return { content: '我放轻脚步，缓缓推开那扇门。', raw: { rewrite: true } };
      }
    }
  });
  await request(app, {
    method: 'PUT',
    url: '/api/providers',
    headers: { 'content-type': 'application/json' },
    body: {
      activeProviderId: 'local',
      providers: [{
        id: 'local',
        kind: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret',
        model: 'rewrite-model',
        temperature: 0.5,
        maxTokens: 1024,
        headers: {}
      }]
    }
  });

  const response = await request(app, {
    method: 'POST',
    url: '/api/rewrite',
    headers: { 'content-type': 'application/json' },
    body: {
      sessionId: 'main',
      target: 'chat-input',
      text: '我推门进去',
      instruction: '更有画面感'
    }
  });
  const payload = response.json();
  const state = (await request(app, { url: '/api/state' })).json();

  assert.equal(response.status, 200);
  assert.equal(payload.text, '我放轻脚步，缓缓推开那扇门。');
  assert.equal(payload.providerId, 'local');
  assert.equal(payload.model, 'rewrite-model');
  assert.equal(state.session.messages.length, 0);
  assert.equal(state.session.usageLedger.length, 1);
  assert.equal(state.session.usageLedger[0].taskKey, 'rewrite');
});

test('GET /api/usage returns live session token usage', async () => {
  const app = createApp({
    rootDir: await createTestRoot(),
    providerClient: {
      complete: async () => ({
        content: '一段回应。',
        usage: {
          prompt_tokens: 100,
          completion_tokens: 20,
          total_tokens: 120
        }
      })
    }
  });
  await saveHttpProvider(app);
  await request(app, {
    method: 'POST',
    url: '/api/chat',
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'main', content: '开始' }
  });

  const response = await request(app, { url: '/api/usage?sessionId=main' });
  const payload = response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.usage.scope, 'session');
  assert.equal(payload.usage.sessionId, 'main');
  assert.equal(payload.usage.totals.calls, 1);
  assert.equal(payload.usage.byTask[0].taskKey, 'chat');
  assert.equal(payload.usage.totals.totalTokens, 120);
  assert.equal(payload.usage.byProvider[0].providerId, 'local');
});

test('GET /api/usage can aggregate all sessions', async () => {
  const rootDir = await createTestRoot();
  const app = createApp({
    rootDir,
    providerClient: createHttpEchoProviderClient()
  });
  await saveHttpProvider(app);
  await request(app, {
    method: 'POST',
    url: '/api/chat',
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'main', content: '主线' }
  });
  await request(app, {
    method: 'POST',
    url: '/api/sessions',
    headers: { 'content-type': 'application/json' },
    body: { id: 'side_story', title: '支线' }
  });
  await request(app, {
    method: 'POST',
    url: '/api/chat',
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'side_story', content: '支线' }
  });

  const response = await request(app, { url: '/api/usage?scope=all' });
  const payload = response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.usage.scope, 'all');
  assert.equal(payload.usage.totals.calls, 2);
  assert.deepEqual(new Set(payload.usage.recent.map((row) => row.sessionId)), new Set(['main', 'side_story']));
});

test('PUT /api/providers saves provider and GET /api/state masks apiKey and sensitive headers', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const providerConfig = {
    activeProviderId: 'local',
    providers: [{
      id: 'local',
      kind: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'secret',
      model: 'model-a',
      temperature: 0.8,
      maxTokens: 1024,
      headers: {
        Authorization: 'Bearer secret-token',
        'x-api-key': 'header-secret',
        'x-auth-token': 'auth-secret',
        'x-request-id': 'visible-request'
      }
    }]
  };

  const saveResponse = await request(app, {
    method: 'PUT',
    url: '/api/providers',
    headers: { 'content-type': 'application/json' },
    body: providerConfig
  });
  assert.equal(saveResponse.status, 200);

  const stateResponse = await request(app, { url: '/api/state' });
  const payload = stateResponse.json();

  assert.equal(payload.config.providers.activeProviderId, 'local');
  assert.equal(payload.config.providers.providers[0].apiKey, '********');
  assert.equal(payload.config.providers.providers[0].headers.Authorization, '********');
  assert.equal(payload.config.providers.providers[0].headers['x-api-key'], '********');
  assert.equal(payload.config.providers.providers[0].headers['x-auth-token'], '********');
  assert.equal(payload.config.providers.providers[0].headers['x-request-id'], 'visible-request');
  assert.equal(payload.config.providers.providers[0].model, 'model-a');
});

test('PUT /api/providers preserves real apiKey and sensitive headers when saving masked provider config', async () => {
  const rootDir = await createTestRoot();
  const app = createApp({ rootDir });
  const providerConfig = {
    activeProviderId: 'local',
    providers: [{
      id: 'local',
      kind: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'secret',
      model: 'model-a',
      temperature: 0.8,
      maxTokens: 1024,
      headers: {
        Authorization: 'Bearer secret-token',
        'x-api-key': 'header-secret',
        'x-request-id': 'visible-request'
      }
    }]
  };

  await request(app, {
    method: 'PUT',
    url: '/api/providers',
    headers: { 'content-type': 'application/json' },
    body: providerConfig
  });
  const stateResponse = await request(app, { url: '/api/state' });
  const maskedConfig = stateResponse.json().config.providers;
  maskedConfig.providers[0].model = 'model-b';
  maskedConfig.providers[0].headers['x-request-id'] = 'next-request';

  const saveMaskedResponse = await request(app, {
    method: 'PUT',
    url: '/api/providers',
    headers: { 'content-type': 'application/json' },
    body: maskedConfig
  });
  const nextState = (await request(app, { url: '/api/state' })).json();
  const savedProviderConfig = JSON.parse(
    await readFile(path.join(rootDir, 'data', 'config', 'providers.local.json'), 'utf8')
  );

  assert.equal(saveMaskedResponse.status, 200);
  assert.equal(nextState.config.providers.providers[0].apiKey, '********');
  assert.equal(nextState.config.providers.providers[0].model, 'model-b');
  assert.equal(nextState.config.providers.providers[0].headers.Authorization, '********');
  assert.equal(nextState.config.providers.providers[0].headers['x-api-key'], '********');
  assert.equal(nextState.config.providers.providers[0].headers['x-request-id'], 'next-request');
  assert.equal(savedProviderConfig.providers[0].apiKey, 'secret');
  assert.equal(savedProviderConfig.providers[0].model, 'model-b');
  assert.equal(savedProviderConfig.providers[0].headers.Authorization, 'Bearer secret-token');
  assert.equal(savedProviderConfig.providers[0].headers['x-api-key'], 'header-secret');
  assert.equal(savedProviderConfig.providers[0].headers['x-request-id'], 'next-request');
});

test('PUT /api/providers normalizes non-object headers to empty object', async () => {
  const rootDir = await createTestRoot();
  const app = createApp({ rootDir });

  const response = await request(app, {
    method: 'PUT',
    url: '/api/providers',
    headers: { 'content-type': 'application/json' },
    body: {
      activeProviderId: 'local',
      providers: [{
        id: 'local',
        kind: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret',
        model: 'model-a',
        temperature: 0.8,
        maxTokens: 1024,
        headers: ['x-api-key', 'secret']
      }]
    }
  });
  const savedProviderConfig = JSON.parse(
    await readFile(path.join(rootDir, 'data', 'config', 'providers.local.json'), 'utf8')
  );

  assert.equal(response.status, 200);
  assert.deepEqual(savedProviderConfig.providers[0].headers, {});
});

test('GET /api/health returns ok', async () => {
  const rootDir = await createTestRoot();
  await migrateData({ rootDir });
  const app = createApp({ rootDir });

  const response = await request(app, { url: '/api/health' });
  const payload = response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload, {
    ok: true,
    app: 'local-roleplay-agent',
    version: '0.5.0-rc.1',
    releaseChannel: 'release-candidate-local',
    dataSchemaVersion: 3,
    targetDataSchemaVersion: 3
  });
});

test('POST /api/providers/test verifies masked saved credentials without changing config', async () => {
  const rootDir = await createTestRoot();
  let testedProvider;
  const app = createApp({
    rootDir,
    providerClient: {
      complete: async ({ provider }) => {
        testedProvider = provider;
        return { content: 'OK' };
      }
    }
  });
  await saveHttpProvider(app);
  const state = (await request(app, { url: '/api/state' })).json();
  const provider = state.config.providers.providers[0];

  const response = await request(app, {
    method: 'POST',
    url: '/api/providers/test',
    headers: { 'content-type': 'application/json' },
    body: { provider }
  });
  const saved = JSON.parse(await readFile(path.join(rootDir, 'data', 'config', 'providers.local.json'), 'utf8'));

  assert.equal(response.status, 200);
  assert.equal(response.json().result.ok, true);
  assert.equal(response.json().result.responsePreview, 'OK');
  assert.equal(testedProvider.apiKey, 'secret');
  assert.equal(testedProvider.maxTokens >= 128, true);
  assert.equal(testedProvider.maxTokens <= 256, true);
  assert.equal(saved.providers[0].apiKey, 'secret');
});

test('POST /api/providers/test redacts the API key from connection errors', async () => {
  const app = createApp({
    rootDir: await createTestRoot(),
    providerClient: {
      complete: async ({ provider }) => {
        throw new Error(`upstream rejected ${provider.apiKey}`);
      }
    }
  });

  const response = await request(app, {
    method: 'POST',
    url: '/api/providers/test',
    headers: { 'content-type': 'application/json' },
    body: {
      provider: {
        id: 'test',
        kind: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'top-secret-key',
        model: 'model-a'
      }
    }
  });

  assert.equal(response.status, 502);
  assert.equal(response.json().error, 'PROVIDER_TEST_FAILED');
  assert.doesNotMatch(response.text, /top-secret-key/);
  assert.match(response.json().detail, /\*{8}/);
});

test('unknown API route returns JSON 404', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, { url: '/api/missing' });
  const payload = response.json();

  assert.equal(response.status, 404);
  assert.deepEqual(payload, { error: 'NOT_FOUND' });
});

test('invalid JSON body returns INVALID_JSON', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'PUT',
    url: '/api/providers',
    headers: { 'content-type': 'application/json' },
    body: '{not-json'
  });
  const payload = response.json();

  assert.equal(response.status, 400);
  assert.deepEqual(payload, { error: 'INVALID_JSON' });
});

test('mutating API route rejects unsupported media type', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'PUT',
    url: '/api/providers',
    headers: { 'content-type': 'text/plain' },
    body: '{}'
  });
  const payload = response.json();

  assert.equal(response.status, 415);
  assert.deepEqual(payload, { error: 'UNSUPPORTED_MEDIA_TYPE' });
});

test('mutating API route rejects forbidden origin', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'PUT',
    url: '/api/providers',
    headers: {
      'content-type': 'application/json',
      origin: 'https://evil.example'
    },
    body: {}
  });
  const payload = response.json();

  assert.equal(response.status, 403);
  assert.deepEqual(payload, { error: 'FORBIDDEN_ORIGIN' });
});

test('MCP connect and disconnect routes reject forbidden origin', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const connectResponse = await request(app, {
    method: 'POST',
    url: '/api/mcp/servers/filesystem/connect',
    headers: {
      origin: 'https://evil.example',
      'content-type': 'application/json'
    },
    body: {}
  });
  const disconnectResponse = await request(app, {
    method: 'POST',
    url: '/api/mcp/servers/filesystem/disconnect',
    headers: {
      origin: 'https://evil.example',
      'content-type': 'application/json'
    },
    body: {}
  });

  assert.equal(connectResponse.status, 403);
  assert.deepEqual(connectResponse.json(), { error: 'FORBIDDEN_ORIGIN' });
  assert.equal(disconnectResponse.status, 403);
  assert.deepEqual(disconnectResponse.json(), { error: 'FORBIDDEN_ORIGIN' });
});

test('PUT /api/prompt-modules rejects non-array payload', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'PUT',
    url: '/api/prompt-modules',
    headers: { 'content-type': 'application/json' },
    body: { promptModules: { id: 'not-an-array' } }
  });
  const payload = response.json();

  assert.equal(response.status, 400);
  assert.deepEqual(payload, { error: 'INVALID_PROMPT_MODULES' });
});

test('PUT /api/world-book rejects non-array payload', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'PUT',
    url: '/api/world-book',
    headers: { 'content-type': 'application/json' },
    body: { worldBook: 'not-an-array' }
  });
  const payload = response.json();

  assert.equal(response.status, 400);
  assert.deepEqual(payload, { error: 'INVALID_WORLD_BOOK' });
});

test('POST /api/chat without active provider returns NO_ACTIVE_PROVIDER', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'POST',
    url: '/api/chat',
    headers: { 'content-type': 'application/json' },
    body: { content: '有人吗？' }
  });
  const payload = response.json();

  assert.equal(response.status, 409);
  assert.deepEqual(payload, { error: 'NO_ACTIVE_PROVIDER' });
});

test('POST /api/chat maps provider failure to PROVIDER_ERROR', async () => {
  const rootDir = await createTestRoot();
  const app = createApp({
    rootDir,
    providerClient: {
      complete: async () => {
        throw new Error('provider down');
      }
    }
  });

  await request(app, {
    method: 'PUT',
    url: '/api/providers',
    headers: { 'content-type': 'application/json' },
    body: {
      activeProviderId: 'local',
      providers: [{
        id: 'local',
        kind: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret',
        model: 'model-a',
        temperature: 0.8,
        maxTokens: 1024,
        headers: {}
      }]
    }
  });

  const response = await request(app, {
    method: 'POST',
    url: '/api/chat',
    headers: { 'content-type': 'application/json' },
    body: { content: '推门进去。' }
  });
  const payload = response.json();

  assert.equal(response.status, 502);
  assert.deepEqual(payload, { error: 'PROVIDER_ERROR' });
});

test('POST /api/chat/stream returns SSE chunks and persists the turn', async () => {
  const rootDir = await createTestRoot();
  const app = createApp({
    rootDir,
    providerClient: {
      complete: async ({ messages }) => ({
        content: `流式回应：${messages.at(-1).content}`,
        raw: { fake: true }
      })
    }
  });
  await saveHttpProvider(app);

  const response = await request(app, {
    method: 'POST',
    url: '/api/chat/stream',
    headers: { 'content-type': 'application/json' },
    body: { content: '我拔刀。' }
  });
  const state = (await request(app, { url: '/api/state' })).json();

  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /^text\/event-stream/);
  assert.match(response.text, /event: token/);
  assert.match(response.text, /流式回应/);
  assert.match(response.text, /event: done/);
  assert.equal(state.session.messages.length, 2);
  assert.equal(state.session.messages[1].content, '流式回应：我拔刀。');
});

test('POST /api/chat/stream reports reasoning-only output without saving an empty turn', async () => {
  const rootDir = await createTestRoot();
  const app = createApp({
    rootDir,
    providerClient: {
      stream: async () => {
        throw new Error('PROVIDER_REASONING_ONLY_RESPONSE:length');
      }
    }
  });
  await saveHttpProvider(app);

  const response = await request(app, {
    method: 'POST',
    url: '/api/chat/stream',
    headers: { 'content-type': 'application/json' },
    body: { content: '请生成开场。' }
  });
  const state = (await request(app, { url: '/api/state' })).json();

  assert.equal(response.status, 200);
  assert.match(response.text, /event: error/);
  assert.match(response.text, /PROVIDER_REASONING_ONLY_RESPONSE/);
  assert.equal(state.session.messages.length, 0);
});

test('POST /api/chat/stream reports exhausted provider quota without saving the opening turn', async () => {
  const rootDir = await createTestRoot();
  const app = createApp({
    rootDir,
    providerClient: {
      stream: async () => {
        throw new Error('Provider error 403: insufficient_user_quota, 剩余额度: $0.000000');
      }
    }
  });
  await saveHttpProvider(app);

  const response = await request(app, {
    method: 'POST',
    url: '/api/chat/stream',
    headers: { 'content-type': 'application/json' },
    body: { content: '请生成开场。' }
  });
  const state = (await request(app, { url: '/api/state' })).json();

  assert.equal(response.status, 200);
  assert.match(response.text, /PROVIDER_QUOTA_EXHAUSTED/);
  assert.equal(state.session.messages.length, 0);
});

test('PATCH /api/messages/:messageId edits a user message and trims later history', async () => {
  const rootDir = await createTestRoot();
  const app = createApp({ rootDir, providerClient: createHttpEchoProviderClient() });
  await saveHttpProvider(app);

  const firstTurn = await request(app, {
    method: 'POST',
    url: '/api/chat',
    headers: { 'content-type': 'application/json' },
    body: { content: '我去镇武司。' }
  });
  await request(app, {
    method: 'POST',
    url: '/api/chat',
    headers: { 'content-type': 'application/json' },
    body: { content: '我继续前进。' }
  });
  const userId = firstTurn.json().session.messages[0].id;

  const response = await request(app, {
    method: 'PATCH',
    url: `/api/messages/${userId}`,
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'main', content: '我改去听雨楼。' }
  });
  const payload = response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.session.messages.length, 2);
  assert.equal(payload.session.messages[0].content, '我改去听雨楼。');
  assert.match(payload.session.messages[1].content, /回应：我改去听雨楼。/);
});

test('POST /api/messages/:messageId/regenerate stores assistant swipes', async () => {
  const rootDir = await createTestRoot();
  let turn = 0;
  const app = createApp({
    rootDir,
    providerClient: {
      complete: async ({ messages }) => {
        turn += 1;
        return { content: `第${turn}版回应：${messages.at(-1).content}`, raw: { fake: true } };
      }
    }
  });
  await saveHttpProvider(app);

  const firstTurn = await request(app, {
    method: 'POST',
    url: '/api/chat',
    headers: { 'content-type': 'application/json' },
    body: { content: '我推门进去。' }
  });
  const assistantId = firstTurn.json().reply.id;

  const response = await request(app, {
    method: 'POST',
    url: `/api/messages/${assistantId}/regenerate`,
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'main' }
  });
  const assistant = response.json().session.messages[1];

  assert.equal(response.status, 200);
  assert.equal(assistant.activeSwipeIndex, 1);
  assert.deepEqual(assistant.swipes, ['第1版回应：我推门进去。', '第2版回应：我推门进去。']);
});

test('PUT /api/memory/facts saves normalized memory facts', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'PUT',
    url: '/api/memory/facts',
    headers: { 'content-type': 'application/json' },
    body: {
      sessionId: 'main',
      facts: [{
        title: '名刀雪照',
        content: '沈观澜持有名刀雪照。',
        keywords: ['雪照'],
        type: 'item',
        enabled: false
      }]
    }
  });
  const payload = response.json();
  const state = (await request(app, { url: '/api/state' })).json();

  assert.equal(response.status, 200);
  assert.equal(payload.facts.length, 1);
  assert.equal(payload.facts[0].title, '名刀雪照');
  assert.equal(payload.facts[0].enabled, false);
  assert.equal(state.session.memory.memoryCards[0].content, '沈观澜持有名刀雪照。');
});

test('PUT /api/memory/facts rejects non-array facts', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'PUT',
    url: '/api/memory/facts',
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'main', facts: { content: 'not-array' } }
  });

  assert.equal(response.status, 400);
  assert.deepEqual(response.json(), { error: 'INVALID_MEMORY_FACTS' });
});

test('PUT /api/memory/facts rejects invalid session id', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'PUT',
    url: '/api/memory/facts',
    headers: { 'content-type': 'application/json' },
    body: { sessionId: '../bad', facts: [] }
  });

  assert.equal(response.status, 400);
  assert.deepEqual(response.json(), { error: 'INVALID_SESSION_ID' });
});

test('POST /api/memory/facts/:factId/promote creates one world book entry', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  await request(app, {
    method: 'PUT',
    url: '/api/memory/facts',
    headers: { 'content-type': 'application/json' },
    body: {
      sessionId: 'main',
      facts: [{ id: 'fact-sword', title: '名刀雪照', content: '沈观澜持有名刀雪照。', keywords: ['雪照'] }]
    }
  });

  const first = await request(app, {
    method: 'POST',
    url: '/api/memory/facts/fact-sword/promote',
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'main' }
  });
  const second = await request(app, {
    method: 'POST',
    url: '/api/memory/facts/fact-sword/promote',
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'main' }
  });
  const worldBook = second.json().worldBook.filter((entry) => entry.source === 'fact-management');

  assert.equal(first.status, 200);
  assert.equal(worldBook.length, 1);
  assert.equal(worldBook[0].title, '名刀雪照');
  assert.equal(worldBook[0].extensions.sourceFactId, 'fact-sword');
});

test('POST /api/memory/facts/:factId/promote rejects missing fact', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'POST',
    url: '/api/memory/facts/missing/promote',
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'main' }
  });

  assert.equal(response.status, 404);
  assert.deepEqual(response.json(), { error: 'MEMORY_FACT_NOT_FOUND' });
});

test('POST /api/memory/facts/:factId/promote rejects invalid session id', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    method: 'POST',
    url: '/api/memory/facts/fact-sword/promote',
    headers: { 'content-type': 'application/json' },
    body: { sessionId: '../bad' }
  });

  assert.equal(response.status, 400);
  assert.deepEqual(response.json(), { error: 'INVALID_SESSION_ID' });
});

test('static / returns the HTML page', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, { url: '/' });

  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /^text\/html/);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.match(response.text, /本地角色扮演 Agent/);
});

test('GET /api/proxy-image rejects forbidden origin', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, {
    url: '/api/proxy-image?url=https://example.com/image.png',
    headers: { origin: 'https://evil.example' }
  });

  assert.equal(response.status, 403);
  assert.deepEqual(response.json(), { error: 'FORBIDDEN_ORIGIN' });
});

test('GET /api/proxy-image rejects non-https protocols', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, { url: '/api/proxy-image?url=http://example.com/image.png' });

  assert.equal(response.status, 400);
  assert.deepEqual(response.json(), { error: 'INVALID_URL' });
});

test('GET /api/proxy-image rejects private network addresses', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const targets = [
    'https://127.0.0.1/image.png',
    'https://localhost/image.png',
    'https://169.254.169.254/latest/meta-data/',
    'https://10.0.0.1/image.png',
    'https://192.168.1.1/image.png'
  ];
  for (const target of targets) {
    const response = await request(app, { url: `/api/proxy-image?url=${encodeURIComponent(target)}` });
    assert.equal(response.status, 400, `${target} should be blocked`);
    assert.deepEqual(response.json(), { error: 'INVALID_URL' });
  }
});

test('GET /api/proxy-image rejects malformed url', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, { url: '/api/proxy-image?url=not-a-url' });

  assert.equal(response.status, 400);
  assert.deepEqual(response.json(), { error: 'INVALID_URL' });
});

test('static PNG assets return image/png content type', async () => {
  const rootDir = await createTestRoot();
  await mkdir(path.join(rootDir, 'public', 'assets'), { recursive: true });
  await writeFile(path.join(rootDir, 'public', 'assets', 'wuxia-stage.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const app = createApp({ rootDir });

  const response = await request(app, { url: '/assets/wuxia-stage.png' });

  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /^image\/png/);
  assert.equal(response.headers['cache-control'], 'public, max-age=86400');
});

test('world simulation APIs keep private NPC state out of the public projection', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const saved = await request(app, {
    method: 'PUT',
    url: '/api/sessions/main/simulation/actors',
    headers: { 'content-type': 'application/json' },
    body: {
      actors: [{
        id: 'luo-qing',
        name: '洛青',
        role: '巡夜人',
        location: '南门',
        publicKnowledge: ['城中正在宵禁'],
        privateKnowledge: ['密令来自内廷'],
        schedule: [{ at: '09:00', location: '旧档房', activity: '暗查卷宗', visibility: 'private' }],
        agenda: [{ title: '找出泄密者', visibility: 'private' }]
      }]
    }
  });
  const director = (await request(app, { url: '/api/sessions/main/simulation?view=director' })).json().snapshot;
  const publicView = (await request(app, { url: '/api/sessions/main/simulation?view=public' })).json().snapshot;

  assert.equal(saved.status, 200);
  assert.deepEqual(director.simulation.actors[0].privateKnowledge, ['密令来自内廷']);
  assert.equal(director.simulation.actors[0].schedule.length, 1);
  assert.equal(Object.hasOwn(publicView.simulation.actors[0], 'privateKnowledge'), false);
  assert.equal(publicView.simulation.actors[0].schedule.length, 0);
  assert.equal(publicView.simulation.actors[0].agenda.length, 0);
});

test('legacy content-pack sessions lazily restore their NPC roster', async () => {
  const rootDir = await createTestRoot();
  const app = createApp({ rootDir });
  await request(app, {
    method: 'POST',
    url: '/api/content-packs/lingyi/apply',
    headers: { 'content-type': 'application/json' },
    body: { sessionId: 'main' }
  });
  const sessionFile = path.join(rootDir, 'data', 'sessions', 'main.json');
  const legacySession = JSON.parse(await readFile(sessionFile, 'utf8'));
  delete legacySession.config.contentPackId;
  delete legacySession.config.characterPresets;
  legacySession.memory.simulation.actors = [];
  legacySession.memory.simulation.revision = 0;
  delete legacySession.memory.simulation.settings.rosterInitialized;
  await writeFile(sessionFile, `${JSON.stringify(legacySession, null, 2)}\n`, 'utf8');

  const response = await request(app, { url: '/api/sessions/main/simulation?view=director' });
  const payload = response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.snapshot.simulation.actors.length >= 4, true);
  assert.ok(payload.snapshot.simulation.actors.find((actor) => actor.name === '唐月'));
  assert.ok(payload.snapshot.simulation.actors.find((actor) => actor.name === '张婆婆'));
});

test('action preview is dry-run while commit and clock advance append durable ledger events', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  await request(app, {
    method: 'PUT',
    url: '/api/sessions/main/simulation/actors',
    headers: { 'content-type': 'application/json' },
    body: {
      actors: [{
        id: 'luo-qing',
        name: '洛青',
        schedule: [{ at: '09:00', location: '旧档房', activity: '暗查卷宗', visibility: 'private' }]
      }]
    }
  });

  const action = {
    actorId: 'creator',
    summary: '把密信交给主角',
    actions: [{ type: 'state.append', path: 'protagonist.inventory', value: '密信' }]
  };
  const preview = await request(app, {
    method: 'POST',
    url: '/api/sessions/main/actions/preview',
    headers: { 'content-type': 'application/json' },
    body: { envelope: action }
  });
  const afterPreview = (await request(app, { url: '/api/sessions/main/simulation' })).json().snapshot;
  const committed = await request(app, {
    method: 'POST',
    url: '/api/sessions/main/actions/commit',
    headers: { 'content-type': 'application/json' },
    body: { envelope: action }
  });
  const ledgerAfterCommit = (await request(app, { url: '/api/sessions/main/events?view=director' })).json();
  const advanced = await request(app, {
    method: 'POST',
    url: '/api/sessions/main/simulation/advance',
    headers: { 'content-type': 'application/json' },
    body: { minutes: 60, reason: '测试推进' }
  });
  const ledger = (await request(app, { url: '/api/sessions/main/events?view=director' })).json();
  assert.equal(preview.status, 200);
  assert.deepEqual(preview.json().snapshot.worldState.protagonist.inventory, ['密信']);
  assert.deepEqual(afterPreview.worldState.protagonist.inventory, []);
  assert.equal(committed.status, 200);
  assert.ok(ledgerAfterCommit.events.some((event) => event.kind === 'manual-action'));
  assert.deepEqual(committed.json().snapshot.worldState.protagonist.inventory, ['密信']);
  assert.equal(advanced.status, 200);
  assert.equal(advanced.json().snapshot.simulation.clock.label, '第1日 09:00');
  assert.equal(advanced.json().snapshot.simulation.actors[0].location, '旧档房');
  assert.ok(ledger.events.some((event) => event.kind === 'manual-action'));
  assert.ok(ledger.events.some((event) => event.kind === 'simulation-tick'));
});

test('simulation action routes reject malformed action envelopes', async () => {
  const app = createApp({ rootDir: await createTestRoot() });
  const response = await request(app, {
    method: 'POST',
    url: '/api/sessions/main/actions/commit',
    headers: { 'content-type': 'application/json' },
    body: { envelope: { actions: [] } }
  });

  assert.equal(response.status, 400);
  assert.equal(response.json().error, 'ACTION_LIST_EMPTY');
});

test('static path traversal attempt returns non-200 and does not expose files', async () => {
  const app = createApp({ rootDir: await createTestRoot() });

  const response = await request(app, { url: '/%2e%2e/secret.txt' });

  assert.notEqual(response.status, 200);
  assert.doesNotMatch(response.text, /do-not-expose/);
});

async function request(app, { method = 'GET', url = '/', body, headers = {} } = {}) {
  const rawBody = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  const req = Readable.from(rawBody ? [Buffer.from(rawBody)] : []);
  req.method = method;
  req.url = url;
  req.headers = headers;

  const chunks = [];
  let statusCode = 200;
  let responseHeaders = {};
  let resolveEnd;
  const ended = new Promise((resolve) => {
    resolveEnd = resolve;
  });

  const res = {
    writeHead(code, writtenHeaders = {}) {
      statusCode = code;
      responseHeaders = normalizeHeaders(writtenHeaders);
    },
    write(chunk = '') {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    },
    end(chunk = '') {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      resolveEnd();
    }
  };

  await app(req, res);
  await ended;
  const buffer = Buffer.concat(chunks);
  const text = buffer.toString('utf8');
  return {
    status: statusCode,
    headers: responseHeaders,
    buffer,
    text,
    json: () => JSON.parse(text)
  };
}

function normalizeHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
}

async function createTestRoot() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'agent-http-'));
  await mkdir(path.join(rootDir, 'public'), { recursive: true });
  await writeFile(
    path.join(rootDir, 'public', 'index.html'),
    '<!doctype html><html><body><h1>本地角色扮演 Agent</h1></body></html>',
    'utf8'
  );
  await writeFile(path.join(rootDir, 'secret.txt'), 'do-not-expose', 'utf8');
  return rootDir;
}

async function saveHttpProvider(app) {
  await request(app, {
    method: 'PUT',
    url: '/api/providers',
    headers: { 'content-type': 'application/json' },
    body: {
      activeProviderId: 'local',
      providers: [{
        id: 'local',
        kind: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret',
        model: 'model-a',
        temperature: 0.8,
        maxTokens: 1024,
        headers: {}
      }]
    }
  });
}

function createHttpEchoProviderClient() {
  return {
    complete: async ({ messages }) => ({
      content: `回应：${messages.at(-1).content}`,
      raw: { fake: true }
    })
  };
}

function createV2CardPayload() {
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: '沈观澜',
      description: '初入江湖的刀客。',
      personality: '沉稳。',
      scenario: '旧案开局。',
      first_mes: '夜雨打在刀鞘上。',
      mes_example: '',
      creator_notes: '',
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: [],
      tags: ['武侠'],
      creator: 'liufeng',
      character_version: '1.0.0',
      extensions: {},
      character_book: {
        scan_depth: 5,
        extensions: {},
        entries: [{
          name: '镇武司暗线',
          keys: ['镇武司'],
          content: '镇武司旧案背后另有朝堂暗线。',
          enabled: true,
          insertion_order: 1,
          extensions: {}
        }]
      }
    }
  };
}

function createContentPackBundlePayload() {
  return {
    spec: 'lra.content-pack/v1',
    manifest: {
      spec: 'lra.content-pack/v1',
      id: 'community.rain-night',
      version: '1.1.0',
      title: '听雨仙途',
      description: '雨夜旧案与仙门因果。',
      engine: '>=0.2.2 <1.0.0',
      dependencies: [{ kind: 'plugin', id: 'core.character-card-v2', range: '^1.0.0', scope: 'runtime' }],
      capabilities: ['character', 'worldbook', 'prompt', 'rule-system']
    },
    content: {
      sessionTitle: '听雨楼夜话',
      visualPackId: 'xianxia',
      characterCard: { name: '沈观澜', description: '负刀问道。' },
      worldBook: [{ id: 'rain-lore', title: '听雨楼', keywords: ['听雨楼'], content: '听雨楼不问来路。', enabled: true }],
      promptModules: [{ id: 'rain-prompt', title: '雨夜文风', content: '克制叙事。', enabled: true }],
      memory: { memoryCards: [], worldState: { flags: { genre: 'xianxia' } } },
      ruleSystem: { id: 'rain-rules', title: '听雨规则', boundary: '仙侠悬案', panels: [] },
      characterPresets: []
    }
  };
}

function createPngWithTextChunk(keyword, text) {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    createChunk('tEXt', Buffer.from(`${keyword}\0${text}`, 'latin1')),
    createChunk('IEND', Buffer.alloc(0))
  ]);
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  return Buffer.concat([
    length,
    Buffer.from(type, 'ascii'),
    data,
    Buffer.alloc(4)
  ]);
}
