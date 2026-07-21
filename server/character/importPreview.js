import { extractCharacterCardImage, importCharacterCardFromPayload } from './characterCardImport.js';
import { importWorldBookFromPayload } from './worldBookImport.js';
import { CONTENT_PACK_SPEC, isContentPackBundle } from '../content/contentPackManifest.js';
import { PLUGIN_SPEC } from '../plugins/pluginManifest.js';

export function previewImportPayload(payload = {}) {
  const structured = tryReadStructuredDocument(payload);
  if (isContentPackBundle(structured)) return buildContentPackPreview(structured);
  if (isPluginManifestDocument(structured)) return buildPluginManifestPreview(structured);

  const characterImport = tryImportCharacterCard(payload);
  if (characterImport && hasCharacterCardSignal(characterImport)) {
    return buildCharacterCardPreview(characterImport, payload);
  }

  const worldBook = importWorldBookFromPayload(payload);
  if (!worldBook.length) throw new Error('UNSUPPORTED_IMPORT_PAYLOAD');
  return buildWorldBookPreview(worldBook);
}

function buildContentPackPreview(bundle) {
  const manifest = bundle.manifest || {};
  const content = bundle.content || {};
  return {
    kind: 'content-pack',
    title: manifest.title || manifest.name || manifest.id || '未命名内容包',
    summary: {
      packId: manifest.id || '',
      version: manifest.version || '',
      engine: manifest.engine || '',
      worldBookCount: Array.isArray(content.worldBook) ? content.worldBook.length : 0,
      promptModuleCount: Array.isArray(content.promptModules) ? content.promptModules.length : 0,
      dependencyCount: Array.isArray(manifest.dependencies) ? manifest.dependencies.length : 0,
      characterName: content.characterCard?.name || '',
      willReplaceCharacterCard: false
    },
    importData: { contentPackBundle: structuredClone(bundle) }
  };
}

function buildPluginManifestPreview(document) {
  const manifest = document.manifest || document;
  return {
    kind: 'plugin-manifest',
    title: manifest.name || manifest.title || manifest.id || '未命名插件',
    summary: {
      pluginId: manifest.id || '',
      version: manifest.version || '',
      engine: manifest.engine || '',
      adapterCount: Array.isArray(manifest.adapters) ? manifest.adapters.length : 0,
      dependencyCount: Array.isArray(manifest.dependencies) ? manifest.dependencies.length : 0
    },
    importData: { pluginManifest: structuredClone(manifest) }
  };
}

function tryImportCharacterCard(payload) {
  try {
    return importCharacterCardFromPayload(payload);
  } catch {
    return null;
  }
}

function hasCharacterCardSignal(imported) {
  const card = imported?.characterCard || {};
  return Boolean(
    card.sourceSpec === 'chara_card_v2'
    || card.name
    || card.description
    || card.personality
    || card.scenario
    || card.firstMessage
    || card.systemPrompt
  );
}

function buildCharacterCardPreview(importData, payload) {
  const card = importData.characterCard || {};
  const worldBook = Array.isArray(importData.worldBook) ? importData.worldBook : [];
  const portrait = extractCharacterCardImage(payload);
  return {
    kind: 'character-card',
    summary: {
      characterName: card.name || '未命名角色',
      firstMessage: card.firstMessage || '',
      tags: Array.isArray(card.tags) ? card.tags : [],
      worldBookCount: worldBook.length,
      keywordSamples: collectKeywordSamples(worldBook),
      hasEmbeddedPortrait: Boolean(portrait),
      portraitWidth: portrait?.width || 0,
      portraitHeight: portrait?.height || 0,
      willReplaceCharacterCard: true,
      worldBookMode: 'append-dedupe'
    },
    importData
  };
}

function buildWorldBookPreview(worldBook) {
  return {
    kind: 'world-book',
    summary: {
      worldBookCount: worldBook.length,
      titles: worldBook.slice(0, 8).map((entry) => entry.title),
      keywordSamples: collectKeywordSamples(worldBook),
      worldBookMode: 'append-dedupe'
    },
    importData: {
      characterCard: null,
      worldBook
    }
  };
}

function collectKeywordSamples(worldBook) {
  const samples = [];
  for (const entry of worldBook) {
    for (const keyword of entry.keywords || []) {
      if (keyword && !samples.includes(keyword)) samples.push(keyword);
      if (samples.length >= 8) return samples;
    }
  }
  return samples;
}

function isPluginManifestDocument(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return String(value.spec || value.schema || value.manifest?.spec || '').trim() === PLUGIN_SPEC;
}

function tryReadStructuredDocument(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (String(payload.spec || payload.schema || payload.manifest?.spec || '').trim() === CONTENT_PACK_SPEC) return payload;
  if (String(payload.spec || payload.schema || payload.manifest?.spec || '').trim() === PLUGIN_SPEC) return payload;
  if (String(payload.mimeType || '').toLowerCase().includes('png')) return null;
  if (payload.data && typeof payload.data === 'object') return payload.data;
  const raw = String(payload.data || '').trim();
  if (!raw) return null;
  let text = raw;
  if (raw.startsWith('data:')) {
    const [, encoded = ''] = raw.split(',', 2);
    text = Buffer.from(encoded, 'base64').toString('utf8');
  } else if (payload.encoding === 'base64') {
    text = Buffer.from(raw, 'base64').toString('utf8');
  }
  try {
    return JSON.parse(text);
  } catch {
    try {
      return JSON.parse(Buffer.from(text, 'base64').toString('utf8'));
    } catch {
      return null;
    }
  }
}
