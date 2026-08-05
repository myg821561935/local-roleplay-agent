import test from 'node:test';
import assert from 'node:assert/strict';

import { createVoiceController } from '../public/modules/voice.js';

class FakeElement {
  constructor() {
    this.listeners = new Map();
    this.files = [];
    this.value = '';
    this.disabled = false;
    this.innerHTML = '';
    this.focusCount = 0;
  }

  addEventListener(type, handler) {
    this.listeners.set(type, handler);
  }

  async emit(type) {
    await this.listeners.get(type)?.({ target: this });
  }

  focus() {
    this.focusCount += 1;
  }
}

function createEls() {
  return {
    providerStatus: new FakeElement(),
    sttAudioInput: new FakeElement(),
    sttProvider: new FakeElement(),
    sttLanguage: new FakeElement(),
    sttRecord: new FakeElement(),
    sttStopRecord: new FakeElement(),
    sttTranscribe: new FakeElement(),
    sttResult: new FakeElement(),
    sttInsertToInput: new FakeElement(),
    chatInput: new FakeElement()
  };
}

test('voice transcript insertion uses the composer input boundary', async () => {
  const els = createEls();
  const inserted = [];
  const audio = new Blob(['audio'], { type: 'audio/webm' });
  Object.defineProperty(audio, 'name', { value: 'sample.webm' });
  els.sttAudioInput.files = [audio];
  const controller = createVoiceController({
    state: { config: {} },
    els,
    setStatus: () => {},
    escapeHtmlText: String,
    humanizeApiError: String,
    insertIntoChat: (text) => inserted.push(text),
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ text: '雨夜拔剑' })
    })
  });

  controller.bindEvents();
  await els.sttAudioInput.emit('change');
  await controller.transcribe();
  controller.insertToChat();

  assert.deepEqual(inserted, ['雨夜拔剑']);
  assert.equal(els.chatInput.value, '');
  assert.equal(els.sttInsertToInput.disabled, false);
});

test('voice recording stops acquired tracks when recorder initialization fails', async () => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const recorderDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'MediaRecorder');
  let stopped = 0;
  const statuses = [];
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: async () => ({
          getTracks: () => [{ stop: () => { stopped += 1; } }]
        })
      }
    }
  });
  Object.defineProperty(globalThis, 'MediaRecorder', {
    configurable: true,
    value: class {
      constructor() {
        throw new Error('recorder unavailable');
      }
    }
  });

  try {
    const controller = createVoiceController({
      state: { config: {} },
      els: createEls(),
      setStatus: (_element, message, tone) => statuses.push({ message, tone }),
      escapeHtmlText: String,
      humanizeApiError: String
    });
    await controller.startRecording();
  } finally {
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
    else delete globalThis.navigator;
    if (recorderDescriptor) Object.defineProperty(globalThis, 'MediaRecorder', recorderDescriptor);
    else delete globalThis.MediaRecorder;
  }

  assert.equal(stopped, 1);
  assert.ok(statuses.some(({ message, tone }) => (
    message === '录音失败：recorder unavailable' && tone === 'error'
  )));
});
