import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createConversationStreamController,
  originalOpeningStatus,
  parseSseEvent,
  readSseResponse
} from '../public/modules/conversationStream.js';

class FakeClassList {
  constructor(element) {
    this.element = element;
    this.values = new Set();
  }

  setFromClassName(value) {
    this.values = new Set(String(value || '').split(/\s+/).filter(Boolean));
  }

  syncClassName() {
    this.element._className = [...this.values].join(' ');
  }

  add(...values) {
    values.forEach((value) => this.values.add(value));
    this.syncClassName();
  }

  remove(...values) {
    values.forEach((value) => this.values.delete(value));
    this.syncClassName();
  }

  contains(value) {
    return this.values.has(value);
  }
}

function descendantsOf(element) {
  return element.children.flatMap((child) => [child, ...descendantsOf(child)]);
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.classList = new FakeClassList(this);
    this._className = '';
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this.hidden = false;
    this.focusCount = 0;
  }

  set className(value) {
    this._className = String(value || '');
    this.classList.setFromClassName(this._className);
  }

  get className() {
    return this._className;
  }

  append(...nodes) {
    nodes.forEach((node) => {
      node.parentElement = this;
      this.children.push(node);
    });
  }

  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }

  querySelector(selector) {
    if (!selector.startsWith('.')) return null;
    const className = selector.slice(1);
    return descendantsOf(this).find((element) => element.classList.contains(className)) || null;
  }

  querySelectorAll(selector) {
    const classNames = selector.split(',').map((part) => part.trim().replace(/^\./, ''));
    return descendantsOf(this).filter((element) => (
      classNames.some((className) => element.classList.contains(className))
    ));
  }

  focus() {
    this.focusCount += 1;
  }
}

function createSseResponse(events, { status = 200, statusText = 'OK' } = {}) {
  const encoder = new TextEncoder();
  const chunks = Array.isArray(events) ? events : [events];
  const body = new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    }
  });
  return new Response(body, {
    status,
    statusText,
    headers: { 'content-type': 'text/event-stream' }
  });
}

function createHarness({
  fetchImpl,
  sessionMessages = [],
  pendingJourneyDraft = null,
  pendingQuickReply = null
} = {}) {
  const messages = new FakeElement('section');
  messages.classList.add('has-cover-page', 'has-journey-draft');
  const emptyState = new FakeElement();
  emptyState.className = 'empty-state';
  const cover = new FakeElement();
  cover.className = 'epic-cover-page';
  messages.append(emptyState, cover);

  const state = {
    chatStreaming: false,
    openingError: '',
    pendingJourneyDraft,
    pendingQuickReply,
    targetSpeaker: '沈观澜',
    session: {
      id: 'story/session',
      messages: sessionMessages,
      memory: { rollingSummary: '旧摘要' }
    }
  };
  const els = {
    appStatus: { name: 'app' },
    sessionStatus: { name: 'session' },
    chatInput: new FakeElement('textarea'),
    memoryView: new FakeElement('pre'),
    messages
  };
  const statuses = [];
  const streamingChanges = [];
  const requests = [];
  const restoredInputs = [];
  let renderCount = 0;
  let inspectorCount = 0;
  let targetRenderCount = 0;
  let captureCount = 0;
  let restoreCount = 0;

  const controller = createConversationStreamController({
    state,
    els,
    fetchImpl: async (...args) => {
      requests.push(args);
      return fetchImpl(...args);
    },
    getSessionId: () => state.session.id,
    replaceSession: (session) => {
      state.session = session;
      return session;
    },
    renderMessages: () => { renderCount += 1; },
    refreshInspector: () => { inspectorCount += 1; },
    setStreamingState: (streaming, message) => {
      state.chatStreaming = Boolean(streaming);
      streamingChanges.push({ streaming: Boolean(streaming), message });
    },
    clearComposerInput: () => { els.chatInput.value = ''; },
    setComposerInputValue: (value, options) => {
      els.chatInput.value = value;
      state.pendingQuickReply = options?.pendingQuickReply || null;
      restoredInputs.push({ value, options });
    },
    renderTargetSpeakerIndicator: () => { targetRenderCount += 1; },
    captureScrollState: () => {
      captureCount += 1;
      return { followLatest: true };
    },
    restoreScrollState: () => { restoreCount += 1; },
    serializeValue: (value) => `memory:${value.rollingSummary}`,
    setStatus: (element, message, tone) => statuses.push({ element: element.name, message, tone }),
    humanizeApiError: (error) => error.message,
    documentObject: { createElement: (tagName) => new FakeElement(tagName) }
  });

  return {
    controller,
    els,
    requests,
    restoredInputs,
    state,
    statuses,
    streamingChanges,
    counts: () => ({
      captureCount,
      inspectorCount,
      renderCount,
      restoreCount,
      targetRenderCount
    })
  };
}

test('SSE helpers parse CRLF, chunk boundaries and a trailing completion event', async () => {
  assert.deepEqual(parseSseEvent('event: token\r\ndata: {"content":"雨"}'), {
    event: 'token',
    data: { content: '雨' }
  });
  assert.equal(parseSseEvent('data: {}'), null);
  assert.deepEqual(parseSseEvent('event: done\ndata: not-json'), {
    event: 'done',
    data: undefined
  });
  assert.equal(originalOpeningStatus(null), '故事正在续写...');
  assert.equal(originalOpeningStatus({ title: '第一幕' }), '正在依据设定生成第一幕...');

  const tokens = [];
  const payload = await readSseResponse(createSseResponse([
    'event: token\r\ndata: {"content":"雨"}\r\n',
    '\r\nevent: token\ndata: {"content":"声"}\n\n',
    'event: done\ndata: {"session":{"id":"main"}}'
  ]), {
    onToken: async (token) => tokens.push(token)
  });

  assert.deepEqual(tokens, ['雨', '声']);
  assert.deepEqual(payload, { session: { id: 'main' } });
});

test('SSE reader preserves protocol and HTTP errors and rejects missing completion', async () => {
  await assert.rejects(
    readSseResponse(createSseResponse('event: error\ndata: {"error":"NO_ACTIVE_PROVIDER"}\n\n')),
    (error) => error.code === 'NO_ACTIVE_PROVIDER'
  );
  await assert.rejects(
    readSseResponse(createSseResponse('event: token\ndata: {"content":"半句"}\n\n')),
    /流式响应缺少完成事件/
  );

  const httpResponse = new Response(JSON.stringify({
    error: 'PROVIDER_ERROR',
    detail: '模型不可用'
  }), {
    status: 502,
    statusText: 'Bad Gateway',
    headers: { 'content-type': 'application/json' }
  });
  await assert.rejects(
    readSseResponse(httpResponse),
    (error) => error.code === 'PROVIDER_ERROR' && error.status === 502 && error.message === '模型不可用'
  );

  let cancelCount = 0;
  const errorChunk = new TextEncoder().encode(
    'event: error\ndata: {"error":"BROKEN_STREAM"}\n\n'
  );
  const cancellableResponse = {
    ok: true,
    body: {
      getReader: () => ({
        read: async () => ({ value: errorChunk, done: false }),
        cancel: async () => { cancelCount += 1; }
      })
    }
  };
  await assert.rejects(
    readSseResponse(cancellableResponse),
    (error) => error.code === 'BROKEN_STREAM'
  );
  assert.equal(cancelCount, 1);
});

test('send lifecycle streams a preview, applies the session and synchronizes composer state', async () => {
  const newSession = {
    id: 'story/session',
    messages: [
      { role: 'user', content: '推门' },
      { role: 'assistant', content: '雨声渐近。' }
    ],
    memory: { rollingSummary: '新摘要' }
  };
  const harness = createHarness({
    pendingJourneyDraft: { title: '第一幕' },
    pendingQuickReply: { content: '推门', hiddenFromChat: true },
    fetchImpl: async () => createSseResponse([
      'event: token\ndata: {"content":"雨声"}\n\n',
      `event: done\ndata: ${JSON.stringify({ session: newSession })}\n\n`
    ])
  });
  harness.els.chatInput.value = '  推门  ';

  const payload = await harness.controller.sendMessage();

  assert.deepEqual(payload, { session: newSession });
  assert.equal(harness.requests.length, 1);
  assert.equal(harness.requests[0][0], '/api/chat/stream');
  assert.deepEqual(JSON.parse(harness.requests[0][1].body), {
    sessionId: 'story/session',
    content: '推门',
    targetSpeaker: '沈观澜',
    hideUserMessage: true
  });
  assert.deepEqual(harness.state.session, newSession);
  assert.equal(harness.state.pendingJourneyDraft, null);
  assert.equal(harness.state.targetSpeaker, '');
  assert.equal(harness.els.chatInput.value, '');
  assert.equal(harness.els.chatInput.focusCount, 1);
  assert.equal(harness.els.memoryView.textContent, 'memory:新摘要');
  assert.equal(harness.els.messages.children[0].hidden, true);
  assert.match(harness.els.messages.children[1].querySelector('.message-content').innerHTML, /雨声/);
  assert.deepEqual(harness.streamingChanges, [
    { streaming: true, message: '正在依据设定生成第一幕...' },
    { streaming: false, message: undefined }
  ]);
  assert.deepEqual(harness.counts(), {
    captureCount: 2,
    inspectorCount: 0,
    renderCount: 1,
    restoreCount: 2,
    targetRenderCount: 1
  });
});

test('preview setup failures restore the draft and input instead of leaving streaming stuck', async () => {
  const draft = { title: '第一幕' };
  const quickReply = { content: '推门', hiddenFromChat: true };
  const harness = createHarness({
    pendingJourneyDraft: draft,
    pendingQuickReply: quickReply,
    fetchImpl: async () => {
      throw new Error('fetch should not run');
    }
  });
  harness.els.chatInput.value = '推门';
  harness.els.messages.querySelectorAll = () => {
    throw new Error('preview DOM failed');
  };

  const payload = await harness.controller.sendMessage();

  assert.equal(payload, null);
  assert.equal(harness.requests.length, 0);
  assert.equal(harness.state.chatStreaming, false);
  assert.equal(harness.state.pendingJourneyDraft, draft);
  assert.equal(harness.els.chatInput.value, '推门');
  assert.deepEqual(harness.restoredInputs, [{
    value: '推门',
    options: { pendingQuickReply: quickReply }
  }]);
  assert.equal(harness.state.openingError, '第一幕生成失败：preview DOM failed');
  assert.deepEqual(harness.statuses.at(-1), {
    element: 'session',
    message: '发送失败：preview DOM failed',
    tone: 'error'
  });
  assert.deepEqual(harness.streamingChanges.map(({ streaming }) => streaming), [true, false]);
});

test('a second send is rejected while the first stream keeps the next draft intact', async () => {
  let resolveFetch;
  const responsePromise = new Promise((resolve) => {
    resolveFetch = resolve;
  });
  const harness = createHarness({
    fetchImpl: async () => responsePromise
  });
  harness.els.chatInput.value = '第一步';

  const firstSend = harness.controller.sendMessage();
  harness.els.chatInput.value = '第二步草稿';
  const secondSend = await harness.controller.sendMessage();

  assert.equal(secondSend, null);
  assert.equal(harness.requests.length, 1);
  assert.equal(harness.els.chatInput.value, '第二步草稿');
  assert.deepEqual(harness.statuses.at(-1), {
    element: 'session',
    message: '旁白仍在生成，可先继续起草下一步',
    tone: 'busy'
  });

  resolveFetch(createSseResponse(
    'event: done\ndata: {"session":{"id":"story/session","messages":[],"memory":{}}}\n\n'
  ));
  await firstSend;
  assert.equal(harness.els.chatInput.value, '第二步草稿');
  assert.equal(harness.state.chatStreaming, false);
});

test('continue validates concurrency and last-message role before streaming', async () => {
  const harness = createHarness({
    sessionMessages: [{ role: 'user', content: '推门' }],
    fetchImpl: async () => {
      throw new Error('fetch should not run');
    }
  });

  await harness.controller.continueLastMessage();
  assert.equal(harness.requests.length, 0);
  assert.deepEqual(harness.statuses.at(-1), {
    element: 'session',
    message: '最后一条消息不是旁白回复',
    tone: 'error'
  });

  harness.state.chatStreaming = true;
  await harness.controller.continueLastMessage();
  assert.equal(harness.requests.length, 0);
  assert.deepEqual(harness.statuses.at(-1), {
    element: 'session',
    message: '旁白仍在生成，可先继续起草下一步',
    tone: 'busy'
  });
});

test('continue uses the shared SSE transport and refreshes inspector-owned state', async () => {
  const newSession = {
    id: 'story/session',
    messages: [{ role: 'assistant', content: '续写完成。' }],
    memory: {}
  };
  const harness = createHarness({
    sessionMessages: [{ role: 'assistant', content: '上一段。' }],
    fetchImpl: async () => createSseResponse(
      `event: done\ndata: ${JSON.stringify({ session: newSession })}\n\n`
    )
  });

  await harness.controller.continueLastMessage();

  assert.equal(harness.requests[0][0], '/api/chat/continue');
  assert.deepEqual(JSON.parse(harness.requests[0][1].body), {
    sessionId: 'story/session'
  });
  assert.equal(harness.els.messages.children[0].hidden, true);
  assert.deepEqual(harness.counts(), {
    captureCount: 1,
    inspectorCount: 1,
    renderCount: 1,
    restoreCount: 1,
    targetRenderCount: 0
  });
  assert.deepEqual(harness.streamingChanges.map(({ streaming }) => streaming), [true, false]);
});
