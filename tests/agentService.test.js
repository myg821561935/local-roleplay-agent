import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../server/lib/jsonStore.js';
import { ConfigService } from '../server/config/configService.js';
import { SessionService } from '../server/services/sessionService.js';
import { AgentService } from '../server/services/agentService.js';

test('AgentService runs one chat turn and records memory metadata', async () => {
  const { service } = await createHarness();

  const result = await service.sendMessage({ sessionId: 'main', content: '我去镇武司。' });
  assert.equal(result.session.messages.length, 2);
  assert.equal(result.session.memory.eventLedger.length, 1);
  assert.equal(result.debug.injectedCards.length, 1);
});

test('AgentService applies bounded onUser and onAssistant lifecycle updates in order', async () => {
  const { service, configService, sessionService } = await createHarness();
  const globalConfig = await configService.getAll();
  const session = await sessionService.getSession('main');
  session.config = {
    characterCard: globalConfig.characterCard,
    promptModules: globalConfig.promptModules,
    worldBook: globalConfig.worldBook,
    persona: globalConfig.persona,
    lightFrontend: {
      lifecycle: {
        events: {
          onUser: [{ op: 'increment', path: 'variables.turns', amount: 1 }],
          onAssistant: [{ op: 'increment', path: 'variables.turns', amount: 10 }]
        }
      }
    }
  };
  session.memory.lightFrontendState = {
    enabled: true,
    values: { variables: { turns: 0 } },
    revision: 0
  };
  await sessionService.saveSession(session);

  const result = await service.sendMessage({ sessionId: 'main', content: '推进一轮。' });
  const readback = await sessionService.getSession('main');

  assert.equal(result.session.memory.lightFrontendState.values.variables.turns, 11);
  assert.equal(readback.memory.lightFrontendState.revision, 2);
  assert.deepEqual(
    readback.messages[1].lifecycleReports.map((item) => [item.event, item.status]),
    [['onUser', 'applied'], ['onAssistant', 'applied']]
  );
  assert.equal(readback.messages[1].mvuPatches.length, 2);
});

test('AgentService can keep a director quick command in context without rendering it as player speech', async () => {
  const { service, sessionService } = await createHarness();

  await service.sendMessageStream({
    sessionId: 'main',
    content: '（请继续推进剧情）',
    hideUserMessage: true,
    onToken: () => {}
  });
  const readback = await sessionService.getSession('main');

  assert.equal(readback.messages[0].content, '（请继续推进剧情）');
  assert.equal(readback.messages[0].hiddenFromChat, true);
  assert.equal(readback.messages[1].role, 'assistant');
});

test('AgentService records estimated usage on assistant messages', async () => {
  const { service, sessionService } = await createHarness();

  const result = await service.sendMessage({ sessionId: 'main', content: '我去镇武司。' });
  const assistant = result.reply;
  const readback = await sessionService.getSession('main');

  assert.equal(assistant.usage.providerId, 'fake');
  assert.equal(assistant.usage.model, 'fake-model');
  assert.equal(assistant.usage.promptTokens, result.debug.tokenEstimate);
  assert.equal(assistant.usage.completionTokens > 0, true);
  assert.equal(assistant.usage.totalTokens, assistant.usage.promptTokens + assistant.usage.completionTokens);
  assert.deepEqual(readback.messages[1].usage, assistant.usage);
  assert.equal(readback.usageLedger.length, 1);
  assert.equal(readback.usageLedger[0].messageId, assistant.id);
  assert.equal(readback.usageLedger[0].taskKey, 'chat');
});

test('AgentService prefers a session provider over the global active provider', async () => {
  const usedProviders = [];
  const { service, configService, sessionService } = await createHarness({
    providerClient: {
      complete: async ({ provider, messages }) => {
        usedProviders.push(provider.id);
        return { content: `回应：${messages.at(-1).content}`, raw: { providerId: provider.id } };
      }
    }
  });
  await configService.saveProviders({
    activeProviderId: 'fake',
    providers: [
      createFakeProvider({ id: 'fake', model: 'global-model' }),
      createFakeProvider({ id: 'scene', model: 'scene-model' })
    ]
  });
  const session = await sessionService.getSession('main');
  session.settings.providerId = 'scene';
  await sessionService.saveSession(session);

  const result = await service.sendMessage({ sessionId: 'main', content: '换一个场景模型。' });

  assert.deepEqual(usedProviders, ['scene']);
  assert.equal(result.reply.usage.providerId, 'scene');
  assert.equal(result.reply.usage.model, 'scene-model');
});

test('AgentService attributes usage to the provider that actually succeeds after fallback', async () => {
  const usedProviders = [];
  const { service, configService } = await createHarness({
    providerClient: {
      complete: async ({ provider, messages }) => {
        usedProviders.push(provider.id);
        if (provider.id === 'primary') throw new Error('primary down');
        return {
          content: `回退回应：${messages.at(-1).content}`,
          usage: { prompt_tokens: 90, completion_tokens: 10, total_tokens: 100 }
        };
      }
    }
  });
  await configService.saveProviders({
    activeProviderId: 'primary',
    fallbackChain: ['backup'],
    providers: [
      createFakeProvider({ id: 'primary', model: 'primary-model' }),
      createFakeProvider({ id: 'backup', model: 'backup-model' })
    ]
  });

  const result = await service.sendMessage({ sessionId: 'main', content: '测试回退。' });

  assert.deepEqual(usedProviders, ['primary', 'backup']);
  assert.equal(result.reply.usage.requestedProviderId, 'primary');
  assert.equal(result.reply.usage.providerId, 'backup');
  assert.equal(result.reply.usage.model, 'backup-model');
  assert.equal(result.reply.usage.fallbackUsed, true);
  assert.equal(result.session.usageLedger[0].attempts.length, 2);
});

test('AgentService rewrites text with the session provider without saving chat', async () => {
  const usedProviders = [];
  const { service, configService, sessionService } = await createHarness({
    providerClient: {
      complete: async ({ provider, messages }) => {
        usedProviders.push(provider.id);
        assert.match(messages[0].content, /改写/);
        assert.match(messages.at(-1).content, /我推门进去/);
        return { content: '我放轻脚步，缓缓推开那扇门。', raw: { providerId: provider.id } };
      }
    }
  });
  await configService.saveProviders({
    activeProviderId: 'fake',
    providers: [
      createFakeProvider({ id: 'fake', model: 'global-model' }),
      createFakeProvider({ id: 'scene', model: 'scene-model' })
    ]
  });
  const session = await sessionService.getSession('main');
  session.settings.providerId = 'scene';
  await sessionService.saveSession(session);

  const result = await service.rewriteText({
    sessionId: 'main',
    target: 'chat-input',
    text: '我推门进去',
    instruction: '更有画面感'
  });
  const readback = await sessionService.getSession('main');

  assert.deepEqual(usedProviders, ['scene']);
  assert.equal(result.text, '我放轻脚步，缓缓推开那扇门。');
  assert.equal(result.providerId, 'scene');
  assert.equal(result.model, 'scene-model');
  assert.equal(readback.messages.length, 0);
  assert.equal(readback.usageLedger.length, 1);
  assert.equal(readback.usageLedger[0].taskKey, 'rewrite');
});

test('AgentService expands a recommended action with the active protagonist and scene context', async () => {
  let rewritePrompt = '';
  const { service, configService, sessionService } = await createHarness({
    providerClient: {
      complete: async ({ provider, messages }) => {
        rewritePrompt = messages.map((message) => message.content).join('\n');
        return {
          content: '我拢住袖口的雷痕，转向苏月白低声问道：「伤者腕上的魂灯残痕，是从何处来的？」',
          raw: { providerId: provider.id }
        };
      }
    }
  });
  await configService.saveCharacterCard({
    name: '晏清虚',
    role: '雷泽散修',
    personality: '沉静克制，问话前先观察对方反应。',
    description: '清虚宗旧案幸存者。',
    exampleDialog: ['晏清虚说话简短，不轻易暴露底牌。']
  });
  const session = await sessionService.getSession('main');
  session.memory.worldState = {
    protagonist: { name: '晏清虚', realm: '元婴中期' },
    location: { current: '望舒仙市雨檐' }
  };
  session.messages.push({
    id: 'scene-1',
    role: 'assistant',
    content: '苏月白守在药棚伤者身边，晨雾压低了仙市的檐角。',
    roleplayPanels: {
      sceneStatus: '晨雾未散，药棚外仍有雨声。',
      characterStatus: '苏月白：神色疲惫，正在掩饰魂灯残痕。'
    }
  });
  await sessionService.saveSession(session);

  const result = await service.rewriteText({
    sessionId: 'main',
    target: 'recommended-action',
    text: '转向苏月白，直接问她伤者手腕上的魂灯残痕'
  });

  assert.match(rewritePrompt, /主角：晏清虚/);
  assert.match(rewritePrompt, /身份：雷泽散修/);
  assert.match(rewritePrompt, /当前地点：望舒仙市雨檐/);
  assert.match(rewritePrompt, /晨雾未散/);
  assert.match(rewritePrompt, /选定行动意图/);
  assert.match(rewritePrompt, /不得新增行动结果/);
  assert.match(result.text, /我拢住袖口的雷痕/);
});

test('AgentService extracts recommended actions from assistant reply', async () => {
  const { service, sessionService } = await createHarness({
    providerClient: {
      complete: async () => ({
        content: [
          '你看见镇武司门前灯火森严。',
          '',
          '<recommended_actions>',
          '["上前询问守卫", "绕到侧门观察", "先去茶摊打听消息"]',
          '</recommended_actions>'
        ].join('\n'),
        raw: { fake: true }
      })
    }
  });

  const result = await service.sendMessage({ sessionId: 'main', content: '我到镇武司门口。' });
  const reply = result.reply;
  const readback = await sessionService.getSession('main');

  assert.equal(reply.content, '你看见镇武司门前灯火森严。');
  assert.deepEqual(reply.recommendedActions, ['上前询问守卫', '绕到侧门观察', '先去茶摊打听消息']);
  assert.deepEqual(readback.messages[1].recommendedActions, reply.recommendedActions);
});

test('AgentService separates roleplay protocol panels from visible story text', async () => {
  const { service, sessionService } = await createHarness({
    providerClient: {
      complete: async () => ({
        content: [
          '<descriptive_analysis>内部导演分析</descriptive_analysis>',
          '<normal_status>地点：江陵府</normal_status>',
          '<plot>暮鼓落下时，你踏进江陵府。</plot>',
          '<relationship_status>叶惊弦：陌路，戒备上升。</relationship_status>',
          '<special_status>『沈砚状态』\\n身份：游学士子</special_status>'
        ].join('\\n'),
        raw: { fake: true }
      })
    }
  });

  const result = await service.sendMessage({
    sessionId: 'main',
    content: '[ 命途设定：江湖旧案 ]\\n姓名：沈砚'
  });
  const readback = await sessionService.getSession('main');

  assert.equal(result.reply.content, '暮鼓落下时，你踏进江陵府。');
  assert.equal(result.reply.roleplayPanels.sceneStatus, '地点：江陵府');
  assert.match(result.reply.roleplayPanels.relationshipStatus, /叶惊弦/);
  assert.doesNotMatch(result.reply.content, /descriptive_analysis|内部导演分析|沈砚状态/);
  assert.equal(readback.messages[0].kind, 'journey-setup');
  assert.deepEqual(readback.messages[1].swipeMetadata[0].roleplayPanels, result.reply.roleplayPanels);
});

test('AgentService converts Tavern community panels and w2g into stored native fields', async () => {
  const { service, sessionService } = await createHarness({
    providerClient: {
      complete: async () => ({
        content: [
          '<bginfor>时间：下午5:42<br>地点：咖啡厅</bginfor>',
          '她把冰水放在桌边，安静地等你回应。',
          '<w2g>',
          'A：追问店长的麻烦',
          'B：接过水杯回到座位',
          'C：表示必要时可以作证',
          'D：继续观察',
          'E：跳过',
          '</w2g>',
          '<catsay><details><summary>😼咪咪点评</summary>没有硬追问，分寸感尚可。<br>继续观察她的反应。</details></catsay>'
        ].join('\n'),
        raw: { fake: true }
      })
    }
  });

  const result = await service.sendMessage({ sessionId: 'main', content: 'B' });
  const readback = await sessionService.getSession('main');

  assert.equal(result.reply.content, '她把冰水放在桌边，安静地等你回应。');
  assert.deepEqual(result.reply.recommendedActions, [
    '追问店长的麻烦',
    '接过水杯回到座位',
    '表示必要时可以作证',
    '继续观察',
    '跳过'
  ]);
  assert.match(result.reply.roleplayPanels.sceneStatus, /下午5:42/);
  assert.match(result.reply.roleplayPanels.communityComment, /分寸感尚可/);
  assert.doesNotMatch(readback.messages[1].content, /bginfor|w2g|catsay|<br>/i);
});

test('AgentService hides action protocol blocks and commits adjudicated world effects', async () => {
  const { service, sessionService } = await createHarness({
    providerClient: {
      complete: async () => ({
        content: [
          '你从暗格中取出一封密信。',
          '',
          '```lra-actions',
          JSON.stringify({
            actorId: 'narrator',
            summary: '主角取得密信',
            actions: [{ type: 'state.append', path: 'protagonist.inventory', value: '密信' }]
          }),
          '```'
        ].join('\n'),
        raw: { fake: true }
      })
    }
  });

  const result = await service.sendMessage({ sessionId: 'main', content: '检查桌下暗格。' });
  const readback = await sessionService.getSession('main');

  assert.equal(result.reply.content, '你从暗格中取出一封密信。');
  assert.doesNotMatch(result.reply.content, /lra-actions|state\.append/);
  assert.deepEqual(readback.memory.worldState.protagonist.inventory, ['密信']);
  assert.equal(readback.messages[1].adjudication.status, 'accepted');
  assert.equal(readback.memory.eventLedger[0].effects[0].path, 'worldState.protagonist.inventory');
});

test('AgentService replays world effects for regenerate and swipe selection', async () => {
  let replyIndex = 0;
  const { service } = await createHarness({
    providerClient: {
      complete: async () => {
        replyIndex += 1;
        const item = replyIndex === 1 ? '旧钥匙' : '密信';
        return {
          content: [
            `你找到${item}。`,
            '```lra-actions',
            JSON.stringify({ actions: [{ type: 'state.append', path: 'protagonist.inventory', value: item }] }),
            '```'
          ].join('\n'),
          raw: { fake: true }
        };
      }
    }
  });

  const first = await service.sendMessage({ sessionId: 'main', content: '搜索书案。' });
  assert.deepEqual(first.session.memory.worldState.protagonist.inventory, ['旧钥匙']);

  const regenerated = await service.regenerateAssistantMessage({
    sessionId: 'main',
    messageId: first.reply.id
  });
  assert.deepEqual(regenerated.session.memory.worldState.protagonist.inventory, ['密信']);

  const switched = await service.switchMessageSwipe({
    sessionId: 'main',
    messageId: first.reply.id,
    swipeIndex: 0
  });
  assert.deepEqual(switched.session.memory.worldState.protagonist.inventory, ['旧钥匙']);
  assert.equal(switched.session.messages[1].content, '你找到旧钥匙。');
});

test('AgentService applies hidden MVU patches and replays the selected swipe state', async () => {
  let replyIndex = 0;
  const { service, sessionService } = await createHarness({
    providerClient: {
      complete: async ({ messages }) => {
        if (isSummaryRequest(messages) || isFactExtractionRequest(messages)) {
          return { content: '{}', raw: { maintenance: true } };
        }
        replyIndex += 1;
        const clues = replyIndex === 1 ? 1 : 3;
        return {
          content: [
            `<plot>你确认了第${clues}条线索。</plot>`,
            '```lra-mvu-patch',
            JSON.stringify({
              expectedRevision: 0,
              summary: '线索数量更新',
              operations: [{ op: 'set', path: 'clues', value: clues }]
            }),
            '```'
          ].join('\n'),
          raw: { fake: true }
        };
      }
    }
  });
  const session = await sessionService.getSession('main');
  session.memory.lightFrontendBaseline = { enabled: true, revision: 0, values: { clues: 0 } };
  session.memory.lightFrontendState = structuredClone(session.memory.lightFrontendBaseline);
  await sessionService.saveSession(session);

  const first = await service.sendMessage({ sessionId: 'main', content: '检查案发现场。' });
  assert.equal(first.reply.content, '你确认了第1条线索。');
  assert.doesNotMatch(first.reply.content, /lra-mvu-patch/);
  assert.equal(first.session.memory.lightFrontendState.values.clues, 1);
  assert.equal(first.reply.mvuPatches.length, 1);

  const regenerated = await service.regenerateAssistantMessage({
    sessionId: 'main',
    messageId: first.reply.id
  });
  assert.equal(regenerated.session.memory.lightFrontendState.values.clues, 3);

  const switched = await service.switchMessageSwipe({
    sessionId: 'main',
    messageId: first.reply.id,
    swipeIndex: 0
  });
  assert.equal(switched.session.memory.lightFrontendState.values.clues, 1);
  assert.equal(switched.session.messages[1].content, '你确认了第1条线索。');
});

test('AgentService edits a user message and regenerates from that point', async () => {
  const { service, sessionService } = await createHarness();

  await service.sendMessage({ sessionId: 'main', content: '我去镇武司。' });
  await service.sendMessage({ sessionId: 'main', content: '我继续往里走。' });
  const beforeEdit = await sessionService.getSession('main');

  const result = await service.editMessage({
    sessionId: 'main',
    messageId: beforeEdit.messages[0].id,
    content: '我改去听雨楼。'
  });

  assert.equal(result.session.messages.length, 2);
  assert.equal(result.session.messages[0].id, beforeEdit.messages[0].id);
  assert.equal(result.session.messages[0].content, '我改去听雨楼。');
  assert.match(result.session.messages[1].content, /回应：我改去听雨楼。/);
  assert.equal(result.session.memory.eventLedger.length, 1);
});

test('AgentService drops vector index before rebuilding after a user message edit', async () => {
  const vectorEvents = [];
  const vectorMemoryService = {
    isEnabled: async () => true,
    indexMessages: async ({ sessionId, messages }) => {
      vectorEvents.push(`index:${sessionId}:${messages.map((message) => message.content).join('|')}`);
      return { indexed: messages.length };
    },
    getTopK: async () => 5,
    search: async () => {
      vectorEvents.push('search');
      return [];
    },
    dropIndex: (sessionId) => {
      vectorEvents.push(`drop:${sessionId}`);
    }
  };
  const { service, sessionService } = await createHarness({ vectorMemoryService });

  await service.sendMessage({ sessionId: 'main', content: '我去镇武司。' });
  await service.sendMessage({ sessionId: 'main', content: '我继续往里走。' });
  const beforeEdit = await sessionService.getSession('main');

  vectorEvents.length = 0;
  await service.editMessage({
    sessionId: 'main',
    messageId: beforeEdit.messages[0].id,
    content: '我改去听雨楼。'
  });

  assert.equal(vectorEvents[0], 'drop:main');
  assert.match(vectorEvents[1], /我改去听雨楼。/);
  assert.doesNotMatch(vectorEvents[1], /我继续往里走。/);
});

test('AgentService regenerates an assistant message as a new swipe', async () => {
  let replyIndex = 0;
  const { service } = await createHarness({
    providerClient: {
      complete: async ({ messages }) => {
        if (isSummaryRequest(messages) || isFactExtractionRequest(messages)) {
          return { content: '{}', raw: { maintenance: true } };
        }
        replyIndex += 1;
        return { content: `第${replyIndex}版回应：${messages.at(-1).content}`, raw: { fake: true } };
      }
    }
  });

  const first = await service.sendMessage({ sessionId: 'main', content: '我推门进去。' });
  const assistantId = first.reply.id;
  const regenerated = await service.regenerateAssistantMessage({ sessionId: 'main', messageId: assistantId });
  const assistant = regenerated.session.messages[1];

  assert.equal(regenerated.session.messages.length, 2);
  assert.equal(assistant.id, assistantId);
  assert.equal(assistant.content, '第2版回应：我推门进去。');
  assert.deepEqual(assistant.swipes, ['第1版回应：我推门进去。', '第2版回应：我推门进去。']);
  assert.equal(assistant.activeSwipeIndex, 1);
  assert.equal(regenerated.session.usageLedger.length, 2);
  assert.equal(regenerated.session.usageLedger.every((entry) => entry.messageId === assistantId), true);
});

test('AgentService persists world book activation per swipe without duplicating regenerated user input', async () => {
  const providerCalls = [];
  const { service, configService } = await createHarness({
    providerClient: {
      complete: async ({ messages }) => {
        if (isSummaryRequest(messages) || isFactExtractionRequest(messages)) {
          return { content: '{}', raw: { maintenance: true } };
        }
        providerCalls.push(messages);
        return { content: `回应：${messages.at(-1).content}`, raw: { fake: true } };
      }
    }
  });
  await configService.saveWorldBook([{
    id: 'timed-world-entry',
    title: '镇武司时效条目',
    keywords: ['镇武司'],
    content: '镇武司正在封锁内城。',
    priority: 80,
    enabled: true,
    extensions: { scan_depth: 1, sticky: 3, cooldown: 2 }
  }]);

  const first = await service.sendMessage({ sessionId: 'main', content: '我要查镇武司。' });
  assert.deepEqual(first.reply.worldBookActivation.activatedIds, ['timed-world-entry']);
  assert.deepEqual(first.reply.swipeMetadata[0].worldBookActivation.activatedIds, ['timed-world-entry']);

  const regenerated = await service.regenerateAssistantMessage({
    sessionId: 'main',
    messageId: first.reply.id
  });
  const assistant = regenerated.session.messages[1];
  assert.equal(assistant.swipeMetadata.length, 2);
  assert.deepEqual(assistant.swipeMetadata[1].worldBookActivation.activatedIds, ['timed-world-entry']);
  assert.equal(
    providerCalls[1].filter((message) => message.content === '我要查镇武司。').length,
    1
  );

  const switched = await service.switchMessageSwipe({
    sessionId: 'main',
    messageId: first.reply.id,
    swipeIndex: 0
  });
  assert.deepEqual(
    switched.session.messages[1].worldBookActivation,
    switched.session.messages[1].swipeMetadata[0].worldBookActivation
  );

  await service.editMessage({
    sessionId: 'main',
    messageId: switched.session.messages[0].id,
    content: '我改查听雨楼。'
  });
  assert.equal(
    providerCalls[2].filter((message) => message.content === '我改查听雨楼。').length,
    1
  );
});

test('AgentService passes normal, continue, and regenerate generation types to world book activation', async () => {
  const { service, configService } = await createHarness();
  await configService.saveWorldBook([
    {
      id: 'normal-entry', title: '普通生成', content: '普通生成规则。',
      constant: true, enabled: true, extensions: { triggers: ['normal'] }
    },
    {
      id: 'continue-entry', title: '续写生成', content: '续写生成规则。',
      constant: true, enabled: true, extensions: { triggers: ['continue'] }
    },
    {
      id: 'regenerate-entry', title: '重生成', content: '重生成规则。',
      constant: true, enabled: true, extensions: { triggers: ['regenerate'] }
    }
  ]);

  const first = await service.sendMessage({ sessionId: 'main', content: '开始。' });
  assert.deepEqual(first.debug.sections.worldBookActivation.activatedIds, ['normal-entry']);
  assert.equal(first.debug.sections.worldBookActivation.context.generationType, 'normal');

  const continued = await service.continueMessage({ sessionId: 'main', onToken: () => {} });
  assert.deepEqual(continued.debug.sections.worldBookActivation.activatedIds, ['continue-entry']);
  assert.equal(continued.reply.worldBookActivation.context.generationType, 'continue');

  const regenerated = await service.regenerateAssistantMessage({
    sessionId: 'main',
    messageId: first.reply.id
  });
  assert.deepEqual(regenerated.debug.sections.worldBookActivation.activatedIds, ['regenerate-entry']);
  assert.equal(regenerated.reply.worldBookActivation.context.generationType, 'regenerate');
});

test('SessionService rejects unsafe session id on read', async () => {
  const { sessionService } = await createHarness({ configureProvider: false });

  await assert.rejects(
    () => sessionService.getSession('../config/providers.local'),
    /Invalid session id/
  );
});

test('SessionService rejects unsafe session id on save', async () => {
  const { sessionService } = await createHarness({ configureProvider: false });

  await assert.rejects(
    () => sessionService.saveSession({ id: '../config/providers.local' }),
    /Invalid session id/
  );
});

test('AgentService rejects missing active provider without persisting messages', async () => {
  const { service, sessionService } = await createHarness({ configureProvider: false });

  await assert.rejects(
    () => service.sendMessage({ sessionId: 'main', content: '有人吗？' }),
    /NO_ACTIVE_PROVIDER/
  );
  const readback = await sessionService.getSession('main');
  assert.equal(readback.messages.length, 0);
});

test('AgentService provider failure does not persist a partial user message', async () => {
  const { service, sessionService } = await createHarness({
    providerClient: {
      complete: async () => {
        throw new Error('provider down');
      }
    }
  });

  await assert.rejects(
    () => service.sendMessage({ sessionId: 'main', content: '推门进去。' }),
    /provider down/
  );
  const readback = await sessionService.getSession('main');
  assert.equal(readback.messages.length, 0);
});

test('AgentService summary success resets count and writes rolling summary', async () => {
  let summaryCalls = 0;
  const { service } = await createHarness({
    providerClient: {
      complete: async ({ messages }) => {
        if (isSummaryRequest(messages)) {
          summaryCalls += 1;
          return {
            content: JSON.stringify({
              rollingSummary: '新的滚动摘要。',
              sceneTitle: '前四轮行动',
              sceneSummary: '主角完成了前四轮行动。'
            }),
            raw: { summary: true }
          };
        }
        return { content: `回应：${messages.at(-1).content}`, raw: { fake: true } };
      }
    }
  });

  let result;
  for (let turn = 1; turn <= 4; turn += 1) {
    result = await service.sendMessage({ sessionId: 'main', content: `第${turn}轮行动。` });
  }

  assert.equal(summaryCalls, 1);
  assert.equal(result.session.memory.unsummarizedTurnCount, 0);
  assert.equal(result.session.memory.rollingSummary, '新的滚动摘要。');
  assert.equal(result.session.memory.episodicMemory.summaries.scenes.length, 1);
  assert.equal(result.session.memory.episodicMemory.summaries.scenes[0].title, '前四轮行动');
  assert.equal(result.session.memory.episodicMemory.summaries.scenes[0].sourceEpisodeIds.length, 4);
});

test('AgentService summary failure preserves count and records error', async () => {
  const { service } = await createHarness({
    providerClient: {
      complete: async ({ messages }) => {
        if (isSummaryRequest(messages)) {
          throw new Error('summary down');
        }
        return { content: `回应：${messages.at(-1).content}`, raw: { fake: true } };
      }
    }
  });

  let result;
  for (let turn = 1; turn <= 4; turn += 1) {
    result = await service.sendMessage({ sessionId: 'main', content: `第${turn}轮行动。` });
  }

  assert.equal(result.session.memory.unsummarizedTurnCount, 4);
  assert.equal(result.session.memory.lastSummaryError, 'summary down');
});

test('AgentService summary retry includes every unsummarized turn', async () => {
  let summaryCalls = 0;
  const summaryPrompts = [];
  const { service } = await createHarness({
    providerClient: {
      complete: async ({ messages }) => {
        if (isSummaryRequest(messages)) {
          summaryCalls += 1;
          summaryPrompts.push(messages.at(-1).content);
          if (summaryCalls === 1) throw new Error('summary down');
          return { content: '补齐后的滚动摘要。', raw: { summary: true } };
        }
        return { content: `回应：${messages.at(-1).content}`, raw: { fake: true } };
      }
    }
  });

  for (let turn = 1; turn <= 5; turn += 1) {
    await service.sendMessage({ sessionId: 'main', content: `第${turn}轮行动。` });
  }

  assert.equal(summaryCalls, 2);
  assert.match(summaryPrompts[1], /第1轮行动。/);
  assert.match(summaryPrompts[1], /第5轮行动。/);
});

test('AgentService pauses summary maintenance after repeated summary failures', async () => {
  let summaryCalls = 0;
  let chatCalls = 0;
  const { service } = await createHarness({
    providerClient: {
      complete: async ({ messages }) => {
        if (isSummaryRequest(messages)) {
          summaryCalls += 1;
          throw new Error('summary down');
        }
        if (isFactExtractionRequest(messages)) {
          return { content: '{}', raw: { maintenance: true } };
        }
        chatCalls += 1;
        return { content: `回应：${messages.at(-1).content}`, raw: { fake: true } };
      }
    }
  });

  for (let turn = 1; turn <= 8; turn += 1) {
    await service.sendMessage({ sessionId: 'main', content: `第${turn}轮行动。` });
  }

  assert.ok(summaryCalls >= 1 && summaryCalls < 4, `summaryCalls should be limited, got ${summaryCalls}`);
  const lastSummaryCalls = summaryCalls;
  for (let turn = 9; turn <= 12; turn += 1) {
    await service.sendMessage({ sessionId: 'main', content: `第${turn}轮行动。` });
  }
  assert.equal(summaryCalls, lastSummaryCalls);
  assert.equal(chatCalls, 12);
});

test('AgentService dynamic memory trigger extracts new facts into world state', async () => {
  const { service } = await createHarness({
    providerClient: {
      complete: async ({ messages }) => {
        if (isFactExtractionRequest(messages)) {
          return {
            content: JSON.stringify({
              worldState: {
                protagonist: { name: '沈观澜', traits: ['守诺'] },
                location: { current: '镇武司门前' },
                flags: { 已见守卫: true }
              }
            }),
            raw: { facts: true }
          };
        }
        if (isSummaryRequest(messages)) {
          return { content: '新的滚动摘要。', raw: { summary: true } };
        }
        return { content: `回应：${messages.at(-1).content}`, raw: { fake: true } };
      }
    }
  });

  let result;
  for (let turn = 1; turn <= 4; turn += 1) {
    result = await service.sendMessage({ sessionId: 'main', content: `第${turn}轮行动。` });
  }

  assert.equal(result.session.memory.worldState.protagonist.name, '沈观澜');
  assert.deepEqual(result.session.memory.worldState.protagonist.traits, ['守诺']);
  assert.equal(result.session.memory.worldState.location.current, '镇武司门前');
  assert.equal(result.session.memory.worldState.flags.已见守卫, true);
  assert.equal(result.session.memory.lastFactExtractionError, '');
});

test('AgentService dynamic memory trigger appends stable facts to world book', async () => {
  const { service, configService } = await createHarness({
    providerClient: {
      complete: async ({ messages }) => {
        if (isFactExtractionRequest(messages)) {
          return {
            content: JSON.stringify({
              worldBook: [{
                title: '名刀雪照',
                keywords: ['雪照', '名刀'],
                content: '沈观澜获得名刀雪照，刀身寒白，疑似与镇武司旧案有关。',
                priority: 85,
                depth: 6,
                extensions: {
                  stability: 'confirmed',
                  genre: 'custom',
                  narrativeRole: 'core',
                  returnsToPillar: '推进镇武司旧案与主角物品线'
                }
              }]
            }),
            raw: { facts: true }
          };
        }
        if (isSummaryRequest(messages)) return { content: '新的滚动摘要。', raw: { summary: true } };
        return { content: `回应：${messages.at(-1).content}`, raw: { fake: true } };
      }
    }
  });

  for (let turn = 1; turn <= 4; turn += 1) {
    await service.sendMessage({ sessionId: 'main', content: `第${turn}轮行动。` });
  }
  const session = await service.sessionService.getSession('main');
  const entry = session.config.worldBook.find((item) => item.title === '名刀雪照');

  assert.ok(entry);
  assert.deepEqual(entry.keywords, ['雪照', '名刀']);
  assert.equal(entry.depth, 6);
  assert.equal(entry.source, 'dynamic-memory');
});

test('AgentService dynamic memory failure preserves chat and records error', async () => {
  const { service } = await createHarness({
    providerClient: {
      complete: async ({ messages }) => {
        if (isFactExtractionRequest(messages)) throw new Error('facts down');
        if (isSummaryRequest(messages)) return { content: '摘要仍然更新。', raw: { summary: true } };
        return { content: `回应：${messages.at(-1).content}`, raw: { fake: true } };
      }
    }
  });

  let result;
  for (let turn = 1; turn <= 4; turn += 1) {
    result = await service.sendMessage({ sessionId: 'main', content: `第${turn}轮行动。` });
  }

  assert.equal(result.session.messages.length, 8);
  assert.equal(result.session.memory.lastFactExtractionError, 'facts down');
  assert.equal(result.session.memory.rollingSummary, '摘要仍然更新。');
});

test('SessionService reads back saved chat messages', async () => {
  const { service, sessionService } = await createHarness();

  await service.sendMessage({ sessionId: 'main', content: '查探镇武司门口。' });

  const readback = await sessionService.getSession('main');
  assert.equal(readback.messages.length, 2);
  assert.equal(readback.messages[0].content, '查探镇武司门口。');
  assert.match(readback.messages[1].content, /回应：查探镇武司门口。/);
});

test('SessionService lists saved session ids', async () => {
  const { sessionService } = await createHarness({ configureProvider: false });
  const alpha = await sessionService.getSession('alpha');
  const beta = await sessionService.getSession('beta_2');

  await sessionService.saveSession(alpha);
  await sessionService.saveSession(beta);

  assert.deepEqual((await sessionService.listSessions()).sort(), ['alpha', 'beta_2']);
});

test('SessionService enriches legacy genre sessions without overwriting a custom active arc', async () => {
  const { sessionService } = await createHarness({ configureProvider: false });
  const legacy = await sessionService.getSession('legacy_lingyi');
  legacy.memory.worldState.flags.genre = 'lingyi';
  legacy.memory.narrativeState = {
    activeArc: '追查白事街失踪案',
    supportingArcs: [],
    lockedGenre: '',
    lastConfirmedBy: 'user'
  };
  await sessionService.saveSession(legacy);

  const readback = await sessionService.getSession('legacy_lingyi');
  assert.equal(readback.memory.narrativeState.activeArc, '追查白事街失踪案');
  assert.equal(readback.memory.narrativeState.lockedGenre, 'lingyi');
  assert.equal(readback.memory.narrativeState.corePillars.length >= 4, true);
  assert.equal(readback.memory.narrativeState.referenceFocus.length >= 4, true);
  assert.match(readback.memory.narrativeState.routeReturnRule, /证据|假设/);
  assert.equal(readback.memory.narrativeState.lastConfirmedBy, 'user');
});

async function createHarness({ configureProvider = true, providerClient = createEchoProviderClient(), vectorMemoryService } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-loop-'));
  const store = new JsonStore(root);
  const configService = new ConfigService(store);
  const sessionService = new SessionService(store);
  if (configureProvider) {
    await configService.saveProviders({
      activeProviderId: 'fake',
      providers: [createFakeProvider()]
    });
  }

  return {
    root,
    store,
    configService,
    sessionService,
    providerClient,
    service: new AgentService({
      configService,
      sessionService,
      providerClient,
      vectorMemoryService
    })
  };
}

function createFakeProvider(overrides = {}) {
  return {
    id: 'fake',
    kind: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'secret',
    model: 'fake-model',
    temperature: 0.9,
    maxTokens: 2000,
    headers: {},
    ...overrides
  };
}

function createEchoProviderClient() {
  return {
    complete: async ({ messages }) => ({
      content: `回应：${messages.at(-1).content}`,
      raw: { fake: true }
    })
  };
}

function isSummaryRequest(messages) {
  return String(messages?.[0]?.content || '').includes('记忆整理器');
}

function isFactExtractionRequest(messages) {
  return String(messages?.[0]?.content || '').includes('事实提取器');
}
