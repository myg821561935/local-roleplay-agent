import crypto from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeCharacterCard, normalizeWorldBookEntry, normalizePromptModule } from '../config/configService.js';
import { extractCharacterCardImage } from '../character/characterCardImport.js';

const CHARACTER_IMAGE_DIR = 'assets/character-images';
const MAX_CHARACTER_IMAGE_BYTES = 12 * 1024 * 1024;

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

  async saveCharacterPortrait(payload = {}) {
    const image = extractCharacterCardImage(payload);
    if (!image) return null;
    if (image.bytes.length > MAX_CHARACTER_IMAGE_BYTES) {
      const error = new Error('CHARACTER_IMAGE_TOO_LARGE');
      error.code = 'CHARACTER_IMAGE_TOO_LARGE';
      throw error;
    }

    const assetId = crypto.createHash('sha256').update(image.bytes).digest('hex');
    const relativePath = `${CHARACTER_IMAGE_DIR}/${assetId}.png`;
    const filePath = this.store.resolve(relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, image.bytes);
    return {
      assetId,
      url: `/api/character-images/${assetId}.png`,
      mimeType: image.mimeType,
      width: image.width,
      height: image.height,
      source: 'embedded-character-card'
    };
  }

  async readCharacterPortrait(assetId) {
    const id = String(assetId || '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(id)) return null;
    try {
      return await readFile(this.store.resolve(`${CHARACTER_IMAGE_DIR}/${id}.png`));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
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
