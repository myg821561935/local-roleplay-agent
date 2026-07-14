import crypto from 'node:crypto';
import { normalizeCharacterCard, normalizeWorldBookEntry, normalizePromptModule } from '../config/configService.js';

export class AssetService {
  constructor(store) {
    this.store = store;
  }

  async listAssets() {
    const [characterFiles, worldBookFiles, promptModuleFiles] = await Promise.all([
      this.store.list('assets/characters').catch(() => []),
      this.store.list('assets/world-books').catch(() => []),
      this.store.list('assets/prompt-modules').catch(() => [])
    ]);

    const loadValidJsons = async (files, dir) => {
      const items = await Promise.all(
        files
          .filter(f => f.endsWith('.json'))
          .map(async f => {
            try {
              const data = await this.store.read(`${dir}/${f}`, null);
              return { id: f.replace(/\.json$/, ''), ...data };
            } catch {
              return null;
            }
          })
      );
      return items.filter(Boolean);
    };

    const characters = await loadValidJsons(characterFiles, 'assets/characters');
    const worldBooks = await loadValidJsons(worldBookFiles, 'assets/world-books');
    const promptModules = await loadValidJsons(promptModuleFiles, 'assets/prompt-modules');

    return { characters, worldBooks, promptModules };
  }

  async saveCharacter(character) {
    const normalized = normalizeCharacterCard(character);
    const id = normalized.extensions?.assetId || crypto.randomUUID();
    normalized.extensions = { ...normalized.extensions, assetId: id };

    await this.store.write(`assets/characters/${id}.json`, normalized);
    return normalized;
  }

  async saveWorldBook(id, title, entries) {
    const assetId = id || crypto.randomUUID();
    const normalizedEntries = entries.map(normalizeWorldBookEntry);

    const payload = {
      assetId,
      title: String(title || '未命名世界书'),
      entries: normalizedEntries
    };

    await this.store.write(`assets/world-books/${assetId}.json`, payload);
    return payload;
  }
}
