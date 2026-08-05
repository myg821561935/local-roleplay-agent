import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCharacterPortraitImage,
  createCharacterPresentation,
  getCharacterPortraitUrl
} from '../public/modules/characterPresentation.js';

const VALID_PORTRAIT_URL = `/api/character-images/${'a'.repeat(64)}.png`;

test('character portrait URLs accept only managed local portrait assets', () => {
  assert.equal(getCharacterPortraitUrl({ url: VALID_PORTRAIT_URL }), VALID_PORTRAIT_URL);
  assert.equal(getCharacterPortraitUrl({
    portrait: { url: `  ${VALID_PORTRAIT_URL}  ` }
  }), VALID_PORTRAIT_URL);
  assert.equal(getCharacterPortraitUrl({
    characterPortrait: { url: VALID_PORTRAIT_URL }
  }), VALID_PORTRAIT_URL);

  for (const url of [
    `https://example.com${VALID_PORTRAIT_URL}`,
    `/api/character-images/${'A'.repeat(64)}.png`,
    `/api/character-images/${'a'.repeat(63)}.png`,
    `${VALID_PORTRAIT_URL}?download=1`,
    '/api/assets/portrait/content',
    'data:image/png;base64,AAAA',
    'javascript:alert(1)'
  ]) {
    assert.equal(getCharacterPortraitUrl({ url }), '');
  }
});

test('character portrait images use safe defaults and lazy decoding', () => {
  const createdTags = [];
  const documentObject = {
    createElement(tagName) {
      createdTags.push(tagName);
      return {};
    }
  };

  const image = createCharacterPortraitImage(
    { name: '沈观澜', portrait: { url: VALID_PORTRAIT_URL } },
    'message-avatar',
    '',
    { documentObject }
  );

  assert.deepEqual(createdTags, ['img']);
  assert.deepEqual(image, {
    className: 'message-avatar',
    src: VALID_PORTRAIT_URL,
    alt: '沈观澜立绘',
    loading: 'lazy',
    decoding: 'async'
  });
  assert.equal(createCharacterPortraitImage(
    { url: 'https://example.com/portrait.png' },
    'message-avatar',
    '外部角色',
    { documentObject }
  ), null);
  assert.equal(createCharacterPortraitImage(
    { url: VALID_PORTRAIT_URL },
    'message-avatar',
    '无 DOM',
    { documentObject: null }
  ), null);
});

test('character presentation factory binds one explicit document boundary', () => {
  const documentObject = {
    createElement: () => ({})
  };
  const presentation = createCharacterPresentation({ documentObject });
  const image = presentation.createCharacterPortraitImage(
    { url: VALID_PORTRAIT_URL },
    'story-card-portrait',
    '林霜'
  );

  assert.equal(presentation.getCharacterPortraitUrl({ url: VALID_PORTRAIT_URL }), VALID_PORTRAIT_URL);
  assert.equal(image.src, VALID_PORTRAIT_URL);
  assert.equal(image.alt, '林霜立绘');
});
