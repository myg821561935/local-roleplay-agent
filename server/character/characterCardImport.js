import { inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function importCharacterCardFromPayload(payload = {}) {
  const rawCard = readCardJson(payload);
  return normalizeImportedCard(rawCard);
}

function readCardJson(payload) {
  const data = String(payload.data || '');
  const bytes = decodePayloadBytes(payload);
  const isPng = String(payload.mimeType || '').includes('png') || PNG_SIGNATURE.equals(bytes.subarray(0, PNG_SIGNATURE.length));
  const text = isPng ? readPngCharacterText(bytes) : bytes.toString('utf8') || data;

  try {
    return JSON.parse(text);
  } catch {
    const decoded = Buffer.from(text.trim(), 'base64').toString('utf8');
    return JSON.parse(decoded);
  }
}

function decodePayloadBytes(payload) {
  const data = String(payload.data || '');
  if (data.startsWith('data:')) {
    const [, base64 = ''] = data.split(',', 2);
    return Buffer.from(base64, 'base64');
  }
  if (payload.encoding === 'base64' || looksLikeBase64(data)) {
    return Buffer.from(data, 'base64');
  }
  return Buffer.from(data, 'utf8');
}

function looksLikeBase64(value) {
  const text = String(value || '').trim();
  return text.length > 32 && /^[A-Za-z0-9+/=\r\n]+$/.test(text);
}

function readPngCharacterText(buffer) {
  if (!PNG_SIGNATURE.equals(buffer.subarray(0, PNG_SIGNATURE.length))) {
    throw new Error('INVALID_PNG');
  }

  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    const text = readPngTextChunk(type, data);
    if (text && text.keyword.toLowerCase() === 'chara') return text.value;
    offset += 12 + length;
  }

  throw new Error('MISSING_CHARA_METADATA');
}

function readPngTextChunk(type, data) {
  if (type === 'tEXt') {
    const separator = data.indexOf(0);
    if (separator < 0) return null;
    return {
      keyword: data.subarray(0, separator).toString('latin1'),
      value: data.subarray(separator + 1).toString('latin1')
    };
  }

  if (type === 'zTXt') {
    const separator = data.indexOf(0);
    if (separator < 0) return null;
    return {
      keyword: data.subarray(0, separator).toString('latin1'),
      value: inflateSync(data.subarray(separator + 2)).toString('latin1')
    };
  }

  if (type === 'iTXt') return readInternationalTextChunk(data);
  return null;
}

function readInternationalTextChunk(data) {
  const parts = [];
  let start = 0;
  for (let index = 0; index < data.length && parts.length < 5; index += 1) {
    if (data[index] === 0) {
      parts.push(data.subarray(start, index));
      start = index + 1;
    }
  }
  if (parts.length < 5) return null;

  const keyword = parts[0].toString('utf8');
  const compressionFlag = parts[1][0] || 0;
  const textBytes = data.subarray(start);
  return {
    keyword,
    value: compressionFlag ? inflateSync(textBytes).toString('utf8') : textBytes.toString('utf8')
  };
}

function normalizeImportedCard(rawCard) {
  const data = rawCard?.spec === 'chara_card_v2' ? rawCard.data || {} : rawCard || {};
  const characterCard = {
    name: stringValue(data.name),
    role: stringValue(data.role || data.creator),
    description: stringValue(data.description),
    personality: stringValue(data.personality),
    scenario: stringValue(data.scenario),
    firstMessage: stringValue(data.first_mes || data.firstMessage),
    exampleDialog: normalizeExampleDialog(data.mes_example || data.exampleDialog),
    creatorNotes: stringValue(data.creator_notes),
    systemPrompt: stringValue(data.system_prompt),
    postHistoryInstructions: stringValue(data.post_history_instructions),
    alternateGreetings: normalizeStringArray(data.alternate_greetings),
    tags: normalizeStringArray(data.tags),
    creator: stringValue(data.creator),
    characterVersion: stringValue(data.character_version),
    extensions: isPlainObject(data.extensions) ? data.extensions : {},
    sourceSpec: rawCard?.spec || 'tavern_card_v1',
    raw: rawCard,
    enabled: true
  };

  return {
    characterCard,
    worldBook: normalizeCharacterBook(data.character_book)
  };
}

function normalizeCharacterBook(book) {
  if (!book || !Array.isArray(book.entries)) return [];
  const depth = normalizePositiveNumber(book.scan_depth, 4);
  return book.entries
    .filter((entry) => entry && entry.enabled !== false && stringValue(entry.content))
    .map((entry, index) => ({
      id: `character-book-${entry.id ?? index}-${slugify(entry.name || entry.comment || entry.keys?.[0] || 'entry')}`,
      type: 'character-book',
      title: stringValue(entry.name || entry.comment || entry.keys?.[0] || `角色书条目 ${index + 1}`),
      keywords: normalizeStringArray(entry.keys),
      secondaryKeywords: normalizeStringArray(entry.secondary_keys),
      content: stringValue(entry.content),
      priority: normalizePositiveNumber(entry.priority, 80),
      depth,
      insertionOrder: normalizePositiveNumber(entry.insertion_order, index),
      logic: entry.selective ? 'selective' : 'any',
      constant: entry.constant === true,
      caseSensitive: entry.case_sensitive === true,
      position: stringValue(entry.position || 'after_character'),
      enabled: true,
      source: 'character-card-v2',
      extensions: isPlainObject(entry.extensions) ? entry.extensions : {},
      updatedAt: new Date().toISOString()
    }));
}

function normalizeExampleDialog(value) {
  if (Array.isArray(value)) return normalizeStringArray(value);
  const text = stringValue(value);
  return text ? [text] : [];
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => stringValue(item)).filter(Boolean);
}

function normalizePositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function stringValue(value) {
  return String(value ?? '').trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function slugify(value) {
  return String(value || 'entry')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/gi, '-')
    .replace(/^-+|-+$/g, '') || 'entry';
}
