import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMediaGenerationController,
  resolveGeneratedImageSource
} from '../public/modules/mediaGeneration.js';

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.value = '';
    this.disabled = false;
    this.textContent = '';
    this.className = '';
    this.src = '';
    this.alt = '';
    this.children = [];
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = children;
    this.textContent = '';
  }
}

function createHarness(overrides = {}) {
  const els = {
    imageGenPrompt: new FakeElement('textarea'),
    imageGenSize: new FakeElement('select'),
    imageGenResult: new FakeElement(),
    generateImage: new FakeElement('button'),
    insertImageToBackground: new FakeElement('button'),
    providerStatus: new FakeElement()
  };
  els.imageGenSize.value = '1024x1536';
  const statuses = [];
  const requests = [];
  const backgrounds = [];
  const controller = createMediaGenerationController({
    els,
    apiRequest: async (...args) => {
      requests.push(args);
      return { urls: ['https://images.example/generated.png'], b64: [] };
    },
    setBackgroundImage: async (...args) => {
      backgrounds.push(args);
      return { id: 'main' };
    },
    setStatus: (element, message, tone) => {
      statuses.push({ element, message, tone });
    },
    humanizeApiError: (error) => error.message,
    documentObject: {
      createElement: (tagName) => new FakeElement(tagName)
    },
    ...overrides
  });
  return { backgrounds, controller, els, requests, statuses };
}

test('generated image source prefers URL and falls back to PNG base64', () => {
  assert.deepEqual(
    resolveGeneratedImageSource({ urls: [' https://images.example/a.png '], b64: ['ignored'] }),
    { src: 'https://images.example/a.png', kind: 'URL' }
  );
  assert.deepEqual(
    resolveGeneratedImageSource({ urls: [], b64: [' cG5n ']}),
    { src: 'data:image/png;base64,cG5n', kind: 'base64' }
  );
  assert.deepEqual(resolveGeneratedImageSource(null), { src: '', kind: '' });
});

test('empty image prompt is rejected without calling the provider API', async () => {
  const { controller, els, requests, statuses } = createHarness();

  const result = await controller.generateImage();

  assert.equal(result, null);
  assert.equal(requests.length, 0);
  assert.equal(els.insertImageToBackground.disabled, true);
  assert.deepEqual(statuses.at(-1), {
    element: els.providerStatus,
    message: '请输入 prompt',
    tone: 'error'
  });
});

test('image generation renders a DOM-safe URL preview and enables background application', async () => {
  const { controller, els, requests, statuses } = createHarness();
  els.imageGenPrompt.value = ' moonlit mountain pass ';

  const generated = await controller.generateImage();
  const preview = els.imageGenResult.children[0];

  assert.deepEqual(generated, {
    src: 'https://images.example/generated.png',
    kind: 'URL'
  });
  assert.deepEqual(requests, [[
    '/api/image/generate',
    {
      method: 'POST',
      body: {
        prompt: 'moonlit mountain pass',
        size: '1024x1536'
      }
    }
  ]]);
  assert.equal(preview.className, 'media-generation-preview');
  assert.equal(preview.children[0].tagName, 'IMG');
  assert.equal(preview.children[0].src, generated.src);
  assert.equal(preview.children[1].textContent, 'URL');
  assert.equal(els.generateImage.disabled, false);
  assert.equal(els.insertImageToBackground.disabled, false);
  assert.equal(statuses.at(-1).message, '图像生成成功');
});

test('base64 response is rendered without interpolating provider content into HTML', async () => {
  const { controller, els } = createHarness({
    apiRequest: async () => ({ b64: ['YWJj'], urls: [] })
  });
  els.imageGenPrompt.value = 'portrait';

  await controller.generateImage();

  const preview = els.imageGenResult.children[0];
  assert.equal(preview.children[0].src, 'data:image/png;base64,YWJj');
  assert.equal(preview.children[1].textContent, 'base64');
});

test('missing and failed image responses reset the preview action safely', async () => {
  const missing = createHarness({
    apiRequest: async () => ({ urls: [], b64: [] })
  });
  missing.els.imageGenPrompt.value = 'empty response';
  assert.equal(await missing.controller.generateImage(), null);
  assert.equal(missing.els.imageGenResult.children[0].textContent, '未返回图像');
  assert.equal(missing.els.insertImageToBackground.disabled, true);

  const failed = createHarness({
    apiRequest: async () => {
      throw new Error('provider offline');
    }
  });
  failed.els.imageGenPrompt.value = 'failed response';
  assert.equal(await failed.controller.generateImage(), null);
  assert.equal(failed.els.imageGenResult.children[0].textContent, '生成失败：provider offline');
  assert.equal(failed.els.generateImage.disabled, false);
  assert.equal(failed.els.insertImageToBackground.disabled, true);
  assert.equal(failed.statuses.at(-1).message, '图像生成失败：provider offline');
});

test('generation and background application share one operation lock', async () => {
  let releaseRequest;
  const pendingRequest = new Promise((resolve) => {
    releaseRequest = resolve;
  });
  let requestCount = 0;
  const harness = createHarness({
    apiRequest: async () => {
      requestCount += 1;
      return pendingRequest;
    }
  });
  harness.els.imageGenPrompt.value = 'slow generation';

  const first = harness.controller.generateImage();
  const duplicate = await harness.controller.generateImage();
  const earlyApply = await harness.controller.applyGeneratedImageAsBackground();

  assert.equal(duplicate, null);
  assert.equal(earlyApply, null);
  assert.equal(requestCount, 1);
  assert.equal(harness.controller.isOperationPending(), true);
  assert.equal(harness.els.generateImage.disabled, true);

  releaseRequest({ urls: ['https://images.example/slow.png'] });
  await first;
  assert.equal(harness.controller.isOperationPending(), false);
});

test('generated image is applied through the visual stage boundary', async () => {
  const { backgrounds, controller, els, statuses } = createHarness();
  els.imageGenPrompt.value = 'stage backdrop';
  await controller.generateImage();

  const saved = await controller.applyGeneratedImageAsBackground();

  assert.deepEqual(saved, { id: 'main' });
  assert.deepEqual(backgrounds, [[
    'https://images.example/generated.png',
    {
      fit: 'cover',
      source: 'generated-image'
    }
  ]]);
  assert.equal(els.insertImageToBackground.disabled, false);
  assert.equal(statuses.at(-1).message, '已设为会话背景');
});

test('event binding is idempotent and initializes control state', () => {
  const { controller, els } = createHarness();

  controller.bindEvents();
  controller.bindEvents();

  assert.equal(els.generateImage.listeners.get('click').length, 1);
  assert.equal(els.insertImageToBackground.listeners.get('click').length, 1);
  assert.equal(els.generateImage.disabled, false);
  assert.equal(els.insertImageToBackground.disabled, true);
});
