import { previewImportPayload } from '../character/importPreview.js';

const DEFAULT_LIMIT = 20;
const MAX_DOWNLOAD_BYTES = 12 * 1024 * 1024;
const SEARCH_TIMEOUT_MS = 12_000;
const DOWNLOAD_TIMEOUT_MS = 25_000;

const SOURCES = [
  {
    id: 'chub',
    name: 'Chub / CharacterHub',
    supports: ['characters', 'lorebooks'],
    searchable: true,
    downloadable: true,
    aliases: ['characterhub', 'charhub'],
    allowedHosts: ['gateway.chub.ai', 'chub.ai', 'www.chub.ai', 'avatars.charhub.io', 'api.chub.ai'],
    search: searchChub
  },
  {
    id: 'aicharactercards',
    name: 'AICharacterCards',
    supports: ['characters'],
    searchable: true,
    downloadable: true,
    aliases: ['aicc', 'ai-character-cards'],
    allowedHosts: ['api.aicharactercards.com', 'aicharactercards.com', 'www.aicharactercards.com'],
    search: searchAiCharacterCards,
    resolveDownloadUrl: resolveAiCharacterCardsDownloadUrl
  },
  {
    id: 'risurealm',
    name: 'RisuRealm',
    supports: ['characters', 'presets', 'lorebooks'],
    searchable: true,
    downloadable: true,
    aliases: ['risu', 'risuai'],
    allowedHosts: ['realm.risuai.net'],
    search: searchRisuRealm,
    resolveDownloadUrl: resolveRisuRealmDownloadUrl
  },
  {
    id: 'charavault',
    name: 'CharaVault',
    supports: ['characters', 'lorebooks'],
    searchable: false,
    downloadable: false,
    aliases: ['character-archive'],
    allowedHosts: ['charavault.net', 'www.charavault.net'],
    warning: 'CharaVault 当前按手动下载接入：下载 Character Card V2 PNG 后用本地导入。'
  }
];

export class ImportSourceError extends Error {
  constructor(code, statusCode = 400, message = code) {
    super(message);
    this.name = 'ImportSourceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function listImportSources() {
  return SOURCES.map(toPublicSource);
}

export class ImportSourceService {
  constructor({ fetchImpl = globalThis.fetch } = {}) {
    this.fetchImpl = fetchImpl;
  }

  listSources() {
    return listImportSources();
  }

  async search({ source, query = '', kind = 'characters', limit = DEFAULT_LIMIT } = {}) {
    const definition = getSourceDefinition(source);
    if (!definition.searchable || !definition.search) {
      return {
        source: toPublicSource(definition),
        items: [],
        warning: definition.warning || '此来源需要手动下载后导入。'
      };
    }

    const result = await definition.search({
      fetchImpl: this.fetchImpl,
      query: String(query || '').trim(),
      kind: normalizeKind(kind),
      limit: normalizeLimit(limit)
    });

    return {
      source: toPublicSource(definition),
      items: Array.isArray(result.items) ? result.items : [],
      warning: result.warning || ''
    };
  }

  async download({ source, id = '', downloadUrl = '', fileName = '' } = {}) {
    const definition = getSourceDefinition(source);
    const resolvedUrl = await resolveDownloadUrl(definition, {
      fetchImpl: this.fetchImpl,
      id: String(id || '').trim(),
      downloadUrl: String(downloadUrl || '').trim()
    });
    assertAllowedUrl(definition, resolvedUrl);

    const response = await fetchWithTimeout(this.fetchImpl, resolvedUrl, DOWNLOAD_TIMEOUT_MS);
    if (!response?.ok) {
      throw new ImportSourceError('IMPORT_SOURCE_DOWNLOAD_FAILED', 502);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_DOWNLOAD_BYTES) {
      throw new ImportSourceError('IMPORT_SOURCE_FILE_TOO_LARGE', 413);
    }

    const mimeType = inferMimeTypeFromResponse(response, resolvedUrl, fileName);
    const payload = {
      fileName: fileName || inferFileName(resolvedUrl, mimeType),
      mimeType,
      encoding: 'base64',
      data: bytes.toString('base64')
    };

    try {
      const preview = previewImportPayload(payload);
      return {
        source: toPublicSource(definition),
        payload,
        preview,
        downloadUrl: resolvedUrl
      };
    } catch {
      throw new ImportSourceError('IMPORT_SOURCE_PREVIEW_FAILED', 400);
    }
  }
}

async function searchChub({ fetchImpl, query, kind, limit }) {
  const namespace = kind === 'lorebooks' ? 'lorebooks' : 'characters';
  const url = new URL('https://gateway.chub.ai/search');
  url.searchParams.set('namespace', namespace);
  url.searchParams.set('search', query);
  url.searchParams.set('first', String(limit));
  url.searchParams.set('page', '1');
  url.searchParams.set('sort', 'n_favorites');
  url.searchParams.set('nsfw', 'true');
  url.searchParams.set('nsfl', 'true');

  const payload = await fetchJson(fetchImpl, url);
  const items = extractArray(payload, ['results', 'data', 'items', 'cards']).map((item) => mapChubItem(item, namespace));
  return { items: items.filter(Boolean) };
}

function mapChubItem(item = {}, namespace) {
  const fullPath = stringValue(item.fullPath || item.full_path || item.path || item.id || item.name);
  const title = stringValue(item.name || item.title || fullPath);
  if (!fullPath && !title) return null;
  const downloadUrl = absoluteUrl(
    item.max_res_url || item.maxResUrl || item.download_url || item.downloadUrl || item.png_url,
    'https://chub.ai'
  );
  const isLorebook = namespace === 'lorebooks';

  return {
    sourceId: 'chub',
    id: fullPath || title,
    type: isLorebook ? 'lorebook' : 'character-card',
    title,
    description: stringValue(item.tagline || item.description || item.summary),
    tokenCount: normalizeNumber(item.nTokens ?? item.n_tokens ?? item.tokenCount),
    tags: normalizeTags(item.topics || item.tags),
    sourceUrl: isLorebook ? `https://chub.ai/lorebooks/${fullPath}` : `https://chub.ai/characters/${fullPath}`,
    downloadUrl: isLorebook ? '' : downloadUrl,
    downloadable: Boolean(!isLorebook && downloadUrl),
    meta: {
      favorites: normalizeNumber(item.n_favorites ?? item.favorites),
      rating: normalizeNumber(item.rating)
    }
  };
}

async function searchAiCharacterCards({ fetchImpl, query, limit }) {
  const url = new URL('https://api.aicharactercards.com/api/cards');
  url.searchParams.set('limit', String(limit));
  if (query) url.searchParams.set('search', query);

  const payload = await fetchJson(fetchImpl, url);
  const rawItems = extractArray(payload, ['cards', 'data.cards', 'data', 'items', 'results']);
  return {
    items: rawItems.map(mapAiCharacterCardsItem).filter(Boolean)
  };
}

function mapAiCharacterCardsItem(item = {}) {
  const id = stringValue(item.id || item.cardId || item.slug);
  const title = stringValue(item.name || item.title);
  if (!id && !title) return null;
  const downloadUrl = absoluteUrl(item.fileUrl || item.downloadUrl || item.pngUrl, 'https://api.aicharactercards.com');

  return {
    sourceId: 'aicharactercards',
    id: id || title,
    type: 'character-card',
    title: title || id,
    description: stringValue(item.description || item.summary),
    tokenCount: normalizeNumber(item.tokenCount ?? item.tokens),
    tags: normalizeTags(item.tags),
    sourceUrl: `https://aicharactercards.com/cards/${id || title}`,
    downloadUrl,
    downloadable: true,
    meta: {
      downloads: normalizeNumber(item.downloadCount ?? item.downloads),
      aiScore: normalizeNumber(item.aiScore)
    }
  };
}

async function resolveAiCharacterCardsDownloadUrl({ fetchImpl, id, downloadUrl }) {
  if (downloadUrl) return absoluteUrl(downloadUrl, 'https://api.aicharactercards.com');
  if (!id) throw new ImportSourceError('IMPORT_SOURCE_DOWNLOAD_UNAVAILABLE', 400);

  const detail = await fetchJson(fetchImpl, `https://api.aicharactercards.com/api/cards/${encodeURIComponent(id)}`);
  const fileUrl = findFirstString([
    detail?.fileUrl,
    detail?.downloadUrl,
    detail?.pngUrl,
    detail?.card?.fileUrl,
    detail?.card?.downloadUrl,
    ...(Array.isArray(detail?.versions) ? detail.versions.map((version) => version.fileUrl || version.downloadUrl || version.pngUrl) : []),
    ...(Array.isArray(detail?.card?.versions) ? detail.card.versions.map((version) => version.fileUrl || version.downloadUrl || version.pngUrl) : [])
  ]);

  if (!fileUrl) throw new ImportSourceError('IMPORT_SOURCE_DOWNLOAD_UNAVAILABLE', 400);
  return absoluteUrl(fileUrl, 'https://api.aicharactercards.com');
}

async function searchRisuRealm({ fetchImpl, query, kind, limit }) {
  const directId = extractRisuId(query);
  if (directId) {
    return {
      items: [buildRisuItem({ id: directId, name: directId, kind })]
    };
  }

  if (!query) {
    return {
      items: [],
      warning: 'RisuRealm 可输入角色 URL 或下载 ID 直接预览。'
    };
  }

  const url = new URL('https://realm.risuai.net/');
  url.searchParams.set('q', query);
  url.searchParams.set('mode', kind === 'lorebooks' ? 'lorebook' : 'character');
  const response = await fetchWithTimeout(fetchImpl, url, SEARCH_TIMEOUT_MS);
  if (!response?.ok) throw new ImportSourceError('IMPORT_SOURCE_SEARCH_FAILED', 502);
  const html = await response.text();
  const items = parseRisuCardsFromHtml(html, kind).slice(0, limit);
  return {
    items,
    warning: items.length ? '' : 'RisuRealm 页面未暴露可解析结果，可粘贴角色 URL 或 ID。'
  };
}

function parseRisuCardsFromHtml(html, kind) {
  const cards = [];
  const pattern = /\{[^{}]{0,900}name:"([^"]+)"[^{}]{0,900}id:"([^"]+)"[^{}]{0,900}\}/g;
  let match;
  while ((match = pattern.exec(String(html || ''))) !== null) {
    cards.push(buildRisuItem({ name: match[1], id: match[2], kind }));
  }
  return dedupeItems(cards);
}

function buildRisuItem({ name, id, kind }) {
  return {
    sourceId: 'risurealm',
    id,
    type: kind === 'lorebooks' ? 'lorebook' : 'character-card',
    title: name || id,
    description: '',
    tokenCount: 0,
    tags: [],
    sourceUrl: `https://realm.risuai.net/character/${encodeURIComponent(id)}`,
    downloadUrl: `https://realm.risuai.net/api/v1/download/png-v3/${encodeURIComponent(id)}`,
    downloadable: true,
    meta: {}
  };
}

async function resolveRisuRealmDownloadUrl({ id, downloadUrl }) {
  if (downloadUrl) return absoluteUrl(downloadUrl, 'https://realm.risuai.net');
  const risuId = extractRisuId(id);
  if (!risuId) throw new ImportSourceError('IMPORT_SOURCE_DOWNLOAD_UNAVAILABLE', 400);
  return `https://realm.risuai.net/api/v1/download/png-v3/${encodeURIComponent(risuId)}`;
}

async function resolveDownloadUrl(definition, context) {
  if (definition.resolveDownloadUrl) return definition.resolveDownloadUrl(context);
  if (context.downloadUrl) return absoluteUrl(context.downloadUrl, `https://${definition.allowedHosts[0]}`);
  throw new ImportSourceError('IMPORT_SOURCE_DOWNLOAD_UNAVAILABLE', 400);
}

function getSourceDefinition(sourceId) {
  const normalized = stringValue(sourceId).toLowerCase();
  const definition = SOURCES.find((source) => (
    source.id === normalized || (source.aliases || []).includes(normalized)
  ));
  if (!definition) throw new ImportSourceError('IMPORT_SOURCE_NOT_FOUND', 404);
  return definition;
}

function toPublicSource(source) {
  return {
    id: source.id,
    name: source.name,
    supports: [...source.supports],
    searchable: Boolean(source.searchable),
    downloadable: Boolean(source.downloadable),
    warning: source.warning || ''
  };
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchWithTimeout(fetchImpl, url, SEARCH_TIMEOUT_MS);
  if (!response?.ok) throw new ImportSourceError('IMPORT_SOURCE_SEARCH_FAILED', 502);
  try {
    if (typeof response.json === 'function') return await response.json();
    return JSON.parse(await response.text());
  } catch {
    throw new ImportSourceError('IMPORT_SOURCE_SEARCH_FAILED', 502);
  }
}

async function fetchWithTimeout(fetchImpl, url, timeoutMs) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    return await fetchImpl(url, controller ? { signal: controller.signal } : undefined);
  } catch (error) {
    if (error instanceof ImportSourceError) throw error;
    if (error?.name === 'AbortError') throw new ImportSourceError('IMPORT_SOURCE_TIMEOUT', 504);
    throw new ImportSourceError('IMPORT_SOURCE_NETWORK_FAILED', 502);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function assertAllowedUrl(definition, value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ImportSourceError('IMPORT_SOURCE_URL_NOT_ALLOWED', 400);
  }
  if (url.protocol !== 'https:') throw new ImportSourceError('IMPORT_SOURCE_URL_NOT_ALLOWED', 400);
  if (!definition.allowedHosts.includes(url.hostname)) throw new ImportSourceError('IMPORT_SOURCE_URL_NOT_ALLOWED', 400);
}

function absoluteUrl(value, baseUrl) {
  const text = stringValue(value);
  if (!text) return '';
  try {
    return new URL(text, baseUrl).toString();
  } catch {
    return '';
  }
}

function inferMimeTypeFromResponse(response, url, fileName) {
  const contentType = stringValue(response.headers?.get?.('content-type')).split(';', 1)[0].trim().toLowerCase();
  if (contentType) return contentType;
  const name = `${fileName || ''} ${url}`.toLowerCase();
  if (name.includes('.png')) return 'image/png';
  if (name.includes('.json')) return 'application/json';
  if (name.includes('.yaml') || name.includes('.yml')) return 'text/yaml';
  return 'application/octet-stream';
}

function inferFileName(url, mimeType) {
  const pathname = new URL(url).pathname;
  const baseName = pathname.split('/').filter(Boolean).at(-1);
  if (baseName && baseName.includes('.')) return baseName;
  if (mimeType === 'image/png') return 'character-card.png';
  if (mimeType === 'text/yaml') return 'world-book.yaml';
  if (mimeType === 'application/json') return 'asset.json';
  return 'asset.bin';
}

function extractArray(payload, paths) {
  if (Array.isArray(payload)) return payload;
  for (const path of paths) {
    const value = getPath(payload, path);
    if (Array.isArray(value)) return value;
  }
  return [];
}

function getPath(object, path) {
  return String(path || '').split('.').reduce((value, key) => value?.[key], object);
}

function normalizeKind(kind) {
  const value = stringValue(kind).toLowerCase();
  if (['lorebooks', 'lorebook', 'worldbook', 'world-books'].includes(value)) return 'lorebooks';
  if (['presets', 'preset'].includes(value)) return 'presets';
  return 'characters';
}

function normalizeLimit(limit) {
  const number = Number(limit);
  if (!Number.isFinite(number) || number <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(number), 50);
}

function normalizeTags(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stringValue(item?.name || item?.label || item)).filter(Boolean).slice(0, 10);
  }
  return [];
}

function normalizeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function stringValue(value) {
  return String(value ?? '').trim();
}

function findFirstString(values) {
  return values.map(stringValue).find(Boolean) || '';
}

function extractRisuId(value) {
  const text = stringValue(value);
  if (!text) return '';
  try {
    const url = new URL(text);
    const downloadMatch = url.pathname.match(/\/download\/png-v3\/([^/]+)/);
    if (downloadMatch) return decodeURIComponent(downloadMatch[1]);
    const characterMatch = url.pathname.match(/\/character\/([^/]+)/);
    if (characterMatch) return decodeURIComponent(characterMatch[1]);
    const id = url.searchParams.get('id');
    if (id) return id;
  } catch {
    // Not a URL; fall through to ID validation.
  }
  return /^[A-Za-z0-9_-]{6,}$/.test(text) ? text : '';
}

function dedupeItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.sourceId}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
