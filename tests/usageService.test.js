import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeAllUsage, summarizeSessionUsage } from '../server/services/usageService.js';

test('summarizeSessionUsage aggregates assistant message token usage', () => {
  const session = {
    id: 'main',
    messages: [
      { id: 'u1', role: 'user', content: '开始' },
      {
        id: 'a1',
        role: 'assistant',
        content: '回应',
        createdAt: '2026-07-02T10:00:00.000Z',
        usage: {
          providerId: 'deepseek',
          model: 'deepseek-chat',
          promptTokens: 1200,
          completionTokens: 300,
          totalTokens: 1500,
          estimated: false
        }
      },
      {
        id: 'a2',
        role: 'assistant',
        content: '估算回应',
        createdAt: '2026-07-02T10:05:00.000Z',
        usage: {
          providerId: 'deepseek',
          model: 'deepseek-chat',
          promptTokens: 900,
          completionTokens: 250,
          totalTokens: 1150,
          estimated: true
        }
      }
    ]
  };

  const usage = summarizeSessionUsage(session);

  assert.equal(usage.scope, 'session');
  assert.equal(usage.sessionId, 'main');
  assert.deepEqual(usage.totals, {
    calls: 2,
    promptTokens: 2100,
    completionTokens: 550,
    totalTokens: 2650,
    estimatedCalls: 1,
    providerReportedCalls: 1
  });
  assert.equal(usage.byProvider[0].providerId, 'deepseek');
  assert.equal(usage.byProvider[0].calls, 2);
  assert.equal(usage.recent[0].messageId, 'a2');
});

test('summarizeAllUsage aggregates multiple sessions and keeps session ids', () => {
  const usage = summarizeAllUsage([
    {
      id: 'main',
      messages: [{
        id: 'a1',
        role: 'assistant',
        usage: {
          providerId: 'qwen',
          model: 'qwen-plus',
          promptTokens: 100,
          completionTokens: 20,
          totalTokens: 120,
          estimated: false
        }
      }]
    },
    {
      id: 'side',
      messages: [{
        id: 'a2',
        role: 'assistant',
        usage: {
          providerId: 'qwen',
          model: 'qwen-plus',
          promptTokens: 80,
          completionTokens: 10,
          totalTokens: 90,
          estimated: true
        }
      }]
    }
  ]);

  assert.equal(usage.scope, 'all');
  assert.equal(usage.totals.calls, 2);
  assert.equal(usage.totals.totalTokens, 210);
  assert.deepEqual(new Set(usage.recent.map((row) => row.sessionId)), new Set(['main', 'side']));
});

test('summarizeSessionUsage includes background calls and avoids double counting linked chat messages', () => {
  const session = {
    id: 'main',
    messages: [{
      id: 'a1',
      role: 'assistant',
      createdAt: '2026-07-02T10:00:00.000Z',
      usage: {
        callId: 'chat-call',
        taskKey: 'chat',
        providerId: 'premium',
        model: 'premium-model',
        promptTokens: 100,
        completionTokens: 20,
        totalTokens: 120,
        estimated: false
      }
    }],
    usageLedger: [
      {
        callId: 'chat-call',
        messageId: 'a1',
        taskKey: 'chat',
        createdAt: '2026-07-02T10:00:00.000Z',
        requestedProviderId: 'premium',
        providerId: 'premium',
        model: 'premium-model',
        promptTokens: 100,
        completionTokens: 20,
        totalTokens: 120,
        estimated: false
      },
      {
        callId: 'summary-call',
        taskKey: 'summary',
        createdAt: '2026-07-02T10:01:00.000Z',
        requestedProviderId: 'cheap-primary',
        providerId: 'cheap-backup',
        model: 'summary-model',
        fallbackUsed: true,
        promptTokens: 60,
        completionTokens: 10,
        totalTokens: 70,
        estimated: true
      }
    ]
  };

  const usage = summarizeSessionUsage(session);

  assert.equal(usage.totals.calls, 2);
  assert.equal(usage.totals.totalTokens, 190);
  assert.deepEqual(new Set(usage.byTask.map((row) => row.taskKey)), new Set(['chat', 'summary']));
  assert.equal(usage.byTask.find((row) => row.taskKey === 'summary').fallbackCalls, 1);
  assert.equal(usage.recent[0].taskKey, 'summary');
  assert.equal(usage.recent[0].requestedProviderId, 'cheap-primary');
});
