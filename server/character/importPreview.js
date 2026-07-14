import { importCharacterCardFromPayload } from './characterCardImport.js';
import { importWorldBookFromPayload } from './worldBookImport.js';

export function previewImportPayload(payload = {}) {
  const characterImport = tryImportCharacterCard(payload);
  if (characterImport && hasCharacterCardSignal(characterImport)) {
    return buildCharacterCardPreview(characterImport);
  }

  const worldBook = importWorldBookFromPayload(payload);
  if (!worldBook.length) throw new Error('UNSUPPORTED_IMPORT_PAYLOAD');
  return buildWorldBookPreview(worldBook);
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

function buildCharacterCardPreview(importData) {
  const card = importData.characterCard || {};
  const worldBook = Array.isArray(importData.worldBook) ? importData.worldBook : [];
  return {
    kind: 'character-card',
    summary: {
      characterName: card.name || '未命名角色',
      firstMessage: card.firstMessage || '',
      tags: Array.isArray(card.tags) ? card.tags : [],
      worldBookCount: worldBook.length,
      keywordSamples: collectKeywordSamples(worldBook),
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
