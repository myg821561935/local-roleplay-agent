export const RESOURCE_DIR = 'library/resources';
export const PACK_DIR = 'library/packs';

export class ResourceRepository {
  constructor(store) {
    this.store = store;
  }

  async listResources() {
    return this.loadJsonDirectory(RESOURCE_DIR);
  }

  async getResource(resourceId) {
    return this.store.read(`${RESOURCE_DIR}/${resourceId}.json`, null);
  }

  async writeResource(resourceId, resource) {
    await this.store.write(`${RESOURCE_DIR}/${resourceId}.json`, resource);
    return resource;
  }

  async removeResource(resourceId) {
    return this.store.remove(`${RESOURCE_DIR}/${resourceId}.json`);
  }

  async listPacks() {
    return this.loadJsonDirectory(PACK_DIR);
  }

  async getPack(packId) {
    return this.store.read(`${PACK_DIR}/${packId}.json`, null);
  }

  async writePack(packId, pack) {
    await this.store.write(`${PACK_DIR}/${packId}.json`, pack);
    return pack;
  }

  async removePack(packId) {
    return this.store.remove(`${PACK_DIR}/${packId}.json`);
  }

  async loadJsonDirectory(directory) {
    const files = await this.store.list(directory);
    const items = await Promise.all((files || [])
      .filter((file) => file.endsWith('.json'))
      .map(async (file) => {
        try {
          return await this.store.read(`${directory}/${file}`, null);
        } catch {
          return null;
        }
      }));
    return items.filter(Boolean);
  }
}
