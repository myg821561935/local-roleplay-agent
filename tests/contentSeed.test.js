import test from 'node:test';
import assert from 'node:assert/strict';
import { getContentPack } from '../server/config/contentPacks.js';

test('local Shenhuang content pack includes expanded lore and initial facts', async () => {
  const pack = getContentPack('xuanhuan');
  const promptModules = pack.promptModules;
  const worldBook = pack.worldBook;
  const characterCard = pack.characterCard;
  const memory = pack.memory;

  assert.ok(promptModules.find((module) => module.id === 'relationship-arc-engine'));
  assert.ok(promptModules.find((module) => module.id === 'fact-extraction-standards'));
  assert.ok(worldBook.length >= 28);
  assert.ok(worldBook.find((entry) => entry.id === 'location-luoyan-nightmarket'));
  assert.ok(worldBook.find((entry) => entry.id === 'adult-consent-customs'));
  assert.match(characterCard.creatorNotes, /自定义主角/);
  assert.equal(memory.worldState.protagonist.name, '叶沉舟');
  assert.ok(memory.memoryCards.find((fact) => fact.id === 'fact-yechenzhou-current-status'));
  assert.ok(memory.memoryCards.find((fact) => fact.id === 'fact-adult-creative-baseline'));
});
