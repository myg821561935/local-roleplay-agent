export function resolveGeneratedImageSource(result = {}) {
  const url = String(result?.urls?.[0] || '').trim();
  if (url) return { src: url, kind: 'URL' };

  const base64 = String(result?.b64?.[0] || '').trim();
  if (base64) {
    return {
      src: `data:image/png;base64,${base64}`,
      kind: 'base64'
    };
  }

  return { src: '', kind: '' };
}

export function createMediaGenerationController({
  els = {},
  apiRequest = async () => ({}),
  setBackgroundImage = async () => null,
  setStatus = () => {},
  humanizeApiError = (error) => error?.message || String(error),
  documentObject = globalThis.document
} = {}) {
  let eventsBound = false;
  let operationPending = false;
  let lastGeneratedImageUrl = '';

  function syncActionState() {
    if (els.generateImage) els.generateImage.disabled = operationPending;
    if (els.insertImageToBackground) {
      els.insertImageToBackground.disabled = operationPending || !lastGeneratedImageUrl;
    }
  }

  function replaceResultContent(...nodes) {
    if (!els.imageGenResult) return;
    if (typeof els.imageGenResult.replaceChildren === 'function') {
      els.imageGenResult.replaceChildren(...nodes);
      return;
    }
    els.imageGenResult.textContent = '';
    els.imageGenResult.append?.(...nodes);
  }

  function renderMessage(message, tone = 'muted') {
    if (!els.imageGenResult) return;
    if (!documentObject?.createElement) {
      els.imageGenResult.textContent = message;
      return;
    }
    const notice = documentObject.createElement('div');
    notice.className = `media-generation-message is-${tone}`;
    notice.textContent = message;
    replaceResultContent(notice);
  }

  function renderPreview(src, kind) {
    if (!els.imageGenResult || !documentObject?.createElement) return;
    const preview = documentObject.createElement('div');
    preview.className = 'media-generation-preview';

    const image = documentObject.createElement('img');
    image.className = 'media-generation-preview-image';
    image.src = src;
    image.alt = 'generated';

    const meta = documentObject.createElement('div');
    meta.className = 'media-generation-preview-meta';
    meta.textContent = kind;

    preview.append(image, meta);
    replaceResultContent(preview);
  }

  async function generateImage() {
    if (operationPending || !els.imageGenPrompt || !els.imageGenResult) return null;
    const prompt = String(els.imageGenPrompt.value || '').trim();
    if (!prompt) {
      setStatus(els.providerStatus, '请输入 prompt', 'error');
      return null;
    }

    operationPending = true;
    lastGeneratedImageUrl = '';
    syncActionState();
    renderMessage('生成中...');

    try {
      const result = await apiRequest('/api/image/generate', {
        method: 'POST',
        body: {
          prompt,
          size: els.imageGenSize?.value || '1024x1024'
        }
      });
      const generated = resolveGeneratedImageSource(result);
      if (!generated.src) {
        renderMessage('未返回图像', 'error');
        setStatus(els.providerStatus, '图像生成未返回可用结果', 'error');
        return null;
      }

      lastGeneratedImageUrl = generated.src;
      renderPreview(generated.src, generated.kind);
      setStatus(els.providerStatus, '图像生成成功', 'ok');
      return generated;
    } catch (error) {
      const message = humanizeApiError(error);
      renderMessage(`生成失败：${message}`, 'error');
      setStatus(els.providerStatus, `图像生成失败：${message}`, 'error');
      return null;
    } finally {
      operationPending = false;
      syncActionState();
    }
  }

  async function applyGeneratedImageAsBackground() {
    if (operationPending || !lastGeneratedImageUrl) return null;
    operationPending = true;
    syncActionState();
    try {
      const savedSession = await setBackgroundImage(lastGeneratedImageUrl, {
        fit: 'cover',
        source: 'generated-image'
      });
      if (savedSession) {
        setStatus(els.providerStatus, '已设为会话背景', 'ok');
      }
      return savedSession;
    } catch (error) {
      setStatus(
        els.providerStatus,
        `设置背景失败：${humanizeApiError(error)}`,
        'error'
      );
      return null;
    } finally {
      operationPending = false;
      syncActionState();
    }
  }

  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;
    els.generateImage?.addEventListener('click', () => {
      void generateImage();
    });
    els.insertImageToBackground?.addEventListener('click', () => {
      void applyGeneratedImageAsBackground();
    });
    syncActionState();
  }

  syncActionState();

  return {
    applyGeneratedImageAsBackground,
    bindEvents,
    generateImage,
    getLastGeneratedImageUrl: () => lastGeneratedImageUrl,
    isOperationPending: () => operationPending,
    syncActionState
  };
}
