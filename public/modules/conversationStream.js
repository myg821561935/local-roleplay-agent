import { renderSafeMarkdown } from '../markdown.js';
import { extractRoleplayPresentation } from './roleplayResponse.js';
import { createHttpError, parseJsonResponse } from './apiClient.js';

export function parseSseEvent(text) {
  const lines = String(text || '').split(/\r?\n/);
  let event = '';
  const dataLines = [];

  lines.forEach((line) => {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  });
  if (!event) return null;

  const dataText = dataLines.join('\n');
  if (!dataText) return { event, data: undefined };
  try {
    return { event, data: JSON.parse(dataText) };
  } catch {
    return { event, data: undefined };
  }
}

function createSseError(data) {
  const error = new Error(data?.error || 'STREAM_ERROR');
  error.code = data?.error;
  return error;
}

async function assertStreamingResponse(response) {
  if (response.ok) return;
  const text = await response.text();
  throw createHttpError(response, text, parseJsonResponse(text));
}

export async function readSseResponse(response, {
  onToken = () => {},
  missingBodyMessage = '当前浏览器不支持流式响应',
  missingDoneMessage = '流式响应缺少完成事件'
} = {}) {
  await assertStreamingResponse(response);
  if (!response.body) throw new Error(missingBodyMessage);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let donePayload;
  let doneReceived = false;

  async function consumeEvent(eventText) {
    const event = parseSseEvent(eventText);
    if (!event) return;
    if (event.event === 'token') {
      const content = String(event.data?.content || '');
      if (content) await onToken(content);
      return;
    }
    if (event.event === 'done') {
      doneReceived = true;
      donePayload = event.data;
      return;
    }
    if (event.event === 'error') throw createSseError(event.data);
  }

  async function drainCompleteEvents({ flush = false } = {}) {
    let boundary = buffer.match(/\r?\n\r?\n/);
    while (boundary) {
      const eventText = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary[0].length);
      if (eventText.trim()) await consumeEvent(eventText);
      boundary = buffer.match(/\r?\n\r?\n/);
    }
    if (flush && buffer.trim()) {
      const eventText = buffer;
      buffer = '';
      await consumeEvent(eventText);
    }
  }

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      await drainCompleteEvents();
    }
    buffer += decoder.decode();
    await drainCompleteEvents({ flush: true });
  } finally {
    await reader.cancel().catch(() => {});
  }

  if (!doneReceived) throw new Error(missingDoneMessage);
  return donePayload || {};
}

export function originalOpeningStatus(pendingDraft) {
  return pendingDraft ? '正在依据设定生成第一幕...' : '故事正在续写...';
}

export function createConversationStreamController({
  state = {},
  els = {},
  fetchImpl = globalThis.fetch,
  getSessionId = () => 'main',
  replaceSession = () => state.session,
  renderMessages = () => {},
  refreshInspector = () => {},
  setStreamingState = () => {},
  clearComposerInput = () => {},
  setComposerInputValue = () => {},
  renderTargetSpeakerIndicator = () => {},
  captureScrollState = () => ({}),
  restoreScrollState = () => {},
  serializeValue = (value) => JSON.stringify(value, null, 2),
  setStatus = () => {},
  humanizeApiError = (error) => error?.message || String(error),
  documentObject = globalThis.document
} = {}) {
  function isStreaming() {
    return Boolean(state.chatStreaming);
  }

  function reportStreaming() {
    setStatus(els.sessionStatus, '旁白仍在生成，可先继续起草下一步', 'busy');
  }

  function createPreviewNode(role, content) {
    const article = documentObject.createElement('article');
    article.className = `message ${role}`;
    const meta = documentObject.createElement('div');
    meta.className = 'message-meta';
    const roleText = documentObject.createElement('span');
    roleText.className = 'message-role';
    roleText.textContent = role === 'user' ? '你' : '旁白';
    meta.append(roleText);
    const body = documentObject.createElement('div');
    body.className = 'message-content';
    body.innerHTML = renderSafeMarkdown(content);
    article.append(meta, body);
    return article;
  }

  function appendStreamingPreview(userContent) {
    const scrollState = captureScrollState();
    els.messages.querySelectorAll('.empty-state, .epic-cover-page').forEach((node) => node.remove());
    els.messages.classList.remove('has-cover-page');
    els.messages.classList.remove('has-journey-draft');

    const userNode = createPreviewNode('user', userContent);
    const assistantNode = createPreviewNode('assistant', '');
    assistantNode.classList.add('is-streaming');
    els.messages.append(userNode, assistantNode);
    restoreScrollState(scrollState);
    return {
      content: '',
      userNode,
      node: assistantNode,
      contentNode: assistantNode.querySelector('.message-content')
    };
  }

  function updateStreamingPreview(preview, token) {
    if (!preview?.contentNode) return;
    const scrollState = captureScrollState();
    preview.content += token;
    const presentation = extractRoleplayPresentation(preview.content);
    const visible = presentation.content || (
      presentation.protocolDetected ? '正在铺陈场景…' : preview.content
    );
    preview.contentNode.innerHTML = renderSafeMarkdown(visible);
    restoreScrollState(scrollState);
  }

  async function requestStream(path, body, onToken) {
    const response = await fetchImpl(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    return readSseResponse(response, { onToken });
  }

  function renderMemorySnapshot() {
    if (els.memoryView) els.memoryView.textContent = serializeValue(state.session?.memory || {});
  }

  async function sendMessage() {
    if (isStreaming()) {
      reportStreaming();
      return null;
    }
    const content = String(els.chatInput?.value || '').trim();
    if (!content) return null;

    const pendingQuickReply = state.pendingQuickReply;
    const hideUserMessage = Boolean(
      pendingQuickReply?.hiddenFromChat
      && pendingQuickReply.content === content
    );
    const originalDraft = state.pendingJourneyDraft;
    state.pendingQuickReply = null;
    setStreamingState(true, originalOpeningStatus(originalDraft));

    try {
      state.pendingJourneyDraft = null;
      clearComposerInput();
      const preview = appendStreamingPreview(content);
      if (originalDraft || hideUserMessage) preview.userNode.hidden = true;

      const payload = await requestStream('/api/chat/stream', {
        sessionId: getSessionId(),
        content,
        targetSpeaker: state.targetSpeaker || undefined,
        hideUserMessage
      }, (token) => updateStreamingPreview(preview, token));

      replaceSession(payload.session, { fallback: state.session });
      state.openingError = '';
      state.targetSpeaker = '';
      renderMessages();
      renderMemorySnapshot();
      renderTargetSpeakerIndicator();
      setStatus(els.appStatus, '对话已更新', 'ok');
      return payload;
    } catch (error) {
      state.pendingJourneyDraft = originalDraft;
      if (!String(els.chatInput?.value || '').trim()) {
        setComposerInputValue(content, { pendingQuickReply });
      }
      if (originalDraft) {
        state.openingError = `第一幕生成失败：${humanizeApiError(error)}`;
      }
      renderMessages();
      setStatus(els.sessionStatus, `发送失败：${humanizeApiError(error)}`, 'error');
      return null;
    } finally {
      setStreamingState(false);
      els.chatInput?.focus?.();
    }
  }

  async function continueLastMessage() {
    if (isStreaming()) {
      reportStreaming();
      return null;
    }
    const messages = Array.isArray(state.session?.messages) ? state.session.messages : [];
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'assistant') {
      setStatus(els.sessionStatus, '最后一条消息不是旁白回复', 'error');
      return null;
    }

    setStreamingState(true, '正在继续生成...');
    try {
      const preview = appendStreamingPreview('（继续生成）');
      preview.userNode.hidden = true;
      const payload = await requestStream('/api/chat/continue', {
        sessionId: getSessionId()
      }, (token) => updateStreamingPreview(preview, token));

      replaceSession(payload.session, { fallback: state.session });
      renderMessages();
      refreshInspector();
      setStatus(els.appStatus, '已继续生成', 'ok');
      return payload;
    } catch (error) {
      renderMessages();
      setStatus(els.sessionStatus, `继续生成失败：${humanizeApiError(error)}`, 'error');
      return null;
    } finally {
      setStreamingState(false);
    }
  }

  return {
    appendStreamingPreview,
    continueLastMessage,
    isStreaming,
    requestStream,
    sendMessage,
    updateStreamingPreview
  };
}
