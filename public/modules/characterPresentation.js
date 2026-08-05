const CHARACTER_PORTRAIT_URL_PATTERN = /^\/api\/character-images\/[a-f0-9]{64}\.png$/;

export function getCharacterPortraitUrl(characterOrPortrait) {
  const portrait = characterOrPortrait?.portrait
    || characterOrPortrait?.characterPortrait
    || characterOrPortrait;
  const url = String(portrait?.url || '').trim();
  return CHARACTER_PORTRAIT_URL_PATTERN.test(url) ? url : '';
}

export function createCharacterPortraitImage(
  characterOrPortrait,
  className,
  fallbackName = '',
  { documentObject = globalThis.document } = {}
) {
  const url = getCharacterPortraitUrl(characterOrPortrait);
  if (!url || typeof documentObject?.createElement !== 'function') return null;

  const image = documentObject.createElement('img');
  image.className = className;
  image.src = url;
  image.alt = `${fallbackName || characterOrPortrait?.name || '角色'}立绘`;
  image.loading = 'lazy';
  image.decoding = 'async';
  return image;
}

export function createCharacterPresentation({ documentObject = globalThis.document } = {}) {
  return {
    getCharacterPortraitUrl,
    createCharacterPortraitImage: (characterOrPortrait, className, fallbackName = '') => (
      createCharacterPortraitImage(
        characterOrPortrait,
        className,
        fallbackName,
        { documentObject }
      )
    )
  };
}
