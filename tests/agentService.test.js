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

  assert.equal(summaryCalls, 1);
  assert.equal(result.session.memory.unsummarizedTurnCount, 0);
  assert.equal(result.session.memory.rollingSummary, '新的滚动摘要。');
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

async function createHarness({ configureProvider = true, providerClient = createEchoProviderClient() } = {}) {
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
      providerClient
    })
  };
}

function createFakeProvider() {
  return {
    id: 'fake',
    kind: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'secret',
    model: 'fake-model',
    temperature: 0.9,
    maxTokens: 2000,
    headers: {}
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
