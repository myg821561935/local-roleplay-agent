export function createVoiceController({ state, els, setStatus, escapeHtmlText, humanizeApiError, fetchImpl = globalThis.fetch } = {}) {
  let mediaRecorder = null;
  let recordedChunks = [];
  let recordedBlob = null;
  let lastAudioUrl = '';
  let lastText = '';

  function render() {
    const providers = Array.isArray(state.config?.providers?.providers) ? state.config.providers.providers : [];
    const options = '<option value="">（使用默认 Provider）</option>' + providers.map((provider) => {
      const id = escapeHtmlText(provider.id);
      const label = escapeHtmlText(provider.id + (provider.model ? ` (${provider.model})` : ''));
      return `<option value="${id}">${label}</option>`;
    }).join('');
    if (els.ttsProvider) els.ttsProvider.innerHTML = options;
    if (els.sttProvider) els.sttProvider.innerHTML = options;
  }

  async function speak() {
    if (!els.ttsText || !els.ttsResult) return;
    const text = els.ttsText.value.trim();
    if (!text) {
      setStatus(els.providerStatus, '请输入要朗读的文本', 'error');
      return;
    }
    if (lastAudioUrl) URL.revokeObjectURL(lastAudioUrl);
    els.ttsSpeak.disabled = true;
    els.ttsResult.innerHTML = '<div class="module-empty-note">生成中...</div>';
    try {
      const response = await fetchImpl('/api/voice/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text,
          voice: els.ttsVoice?.value || 'alloy',
          format: els.ttsFormat?.value || 'mp3',
          providerId: els.ttsProvider?.value || ''
        })
      });
      if (!response.ok) {
        let message;
        try { message = (await response.json()).error || `HTTP ${response.status}`; }
        catch { message = `HTTP ${response.status}`; }
        throw new Error(message);
      }
      const blob = await response.blob();
      lastAudioUrl = URL.createObjectURL(blob);
      const format = els.ttsFormat?.value || 'mp3';
      els.ttsResult.innerHTML = `<div class="voice-result"><audio controls autoplay src="${lastAudioUrl}"></audio><span>${format} · ${(blob.size / 1024).toFixed(1)} KB</span><a href="${lastAudioUrl}" download="tts.${format}">下载</a></div>`;
      setStatus(els.providerStatus, '语音生成成功', 'ok');
    } catch (error) {
      els.ttsResult.innerHTML = `<div class="module-inline-error">生成失败：${escapeHtmlText(humanizeApiError(error))}</div>`;
    } finally {
      els.ttsSpeak.disabled = false;
    }
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus(els.providerStatus, '当前环境不支持录音', 'error');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordedChunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunks.push(event.data);
      };
      mediaRecorder.onstop = () => {
        recordedBlob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        stream.getTracks().forEach((track) => track.stop());
        if (els.sttTranscribe) els.sttTranscribe.disabled = false;
        if (els.sttResult) els.sttResult.innerHTML = `<div class="module-empty-note">已录制 ${(recordedBlob.size / 1024).toFixed(1)} KB，点击“转写”</div>`;
      };
      mediaRecorder.start();
      if (els.sttRecord) els.sttRecord.disabled = true;
      if (els.sttStopRecord) els.sttStopRecord.disabled = false;
      if (els.sttTranscribe) els.sttTranscribe.disabled = true;
      if (els.sttResult) els.sttResult.innerHTML = '<div class="module-empty-note">录音中...</div>';
    } catch (error) {
      setStatus(els.providerStatus, `录音失败：${error.message}`, 'error');
    }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    if (els.sttRecord) els.sttRecord.disabled = false;
    if (els.sttStopRecord) els.sttStopRecord.disabled = true;
  }

  function selectFile() {
    if (!els.sttAudioInput?.files?.length) return;
    recordedBlob = els.sttAudioInput.files[0];
    if (els.sttTranscribe) els.sttTranscribe.disabled = false;
    if (els.sttResult) els.sttResult.innerHTML = `<div class="module-empty-note">已选择文件 ${escapeHtmlText(recordedBlob.name)} (${(recordedBlob.size / 1024).toFixed(1)} KB)</div>`;
  }

  async function transcribe() {
    if (!els.sttResult) return;
    if (!recordedBlob) {
      els.sttResult.innerHTML = '<div class="module-inline-error">请先录音或选择音频文件</div>';
      return;
    }
    els.sttResult.innerHTML = '<div class="module-empty-note">识别中...</div>';
    if (els.sttTranscribe) els.sttTranscribe.disabled = true;
    try {
      const formData = new FormData();
      formData.append('audio', recordedBlob, recordedBlob.name || 'audio.webm');
      if (els.sttProvider?.value) formData.append('providerId', els.sttProvider.value);
      if (els.sttLanguage?.value) formData.append('language', els.sttLanguage.value);
      const response = await fetchImpl('/api/voice/stt', { method: 'POST', body: formData });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
      lastText = String(payload.text || '').trim();
      els.sttResult.innerHTML = `<details open><summary>识别结果</summary><div class="voice-transcript">${escapeHtmlText(lastText)}</div></details>`;
      if (els.sttInsertToInput) els.sttInsertToInput.disabled = !lastText;
      setStatus(els.providerStatus, '语音识别完成', 'ok');
    } catch (error) {
      els.sttResult.innerHTML = `<div class="module-inline-error">识别失败：${escapeHtmlText(error.message)}</div>`;
    } finally {
      if (els.sttTranscribe) els.sttTranscribe.disabled = false;
    }
  }

  function insertToChat() {
    if (!lastText || !els.chatInput) return;
    els.chatInput.value = els.chatInput.value ? `${els.chatInput.value}\n${lastText}` : lastText;
    setStatus(els.providerStatus, '已插入到输入框', 'ok');
  }

  function bindEvents() {
    els.ttsSpeak?.addEventListener('click', speak);
    els.sttRecord?.addEventListener('click', startRecording);
    els.sttStopRecord?.addEventListener('click', stopRecording);
    els.sttTranscribe?.addEventListener('click', transcribe);
    els.sttAudioInput?.addEventListener('change', selectFile);
    els.sttInsertToInput?.addEventListener('click', insertToChat);
  }

  return { bindEvents, render, speak, startRecording, stopRecording, transcribe, insertToChat };
}
