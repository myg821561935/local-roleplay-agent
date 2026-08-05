export const RESOURCE_DIR = 'library/resources';
export const RESOURCE_REVISION_DIR = 'library/resource-revisions';
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

  async listResourceRevisions(resourceId) {
    return this.loadJsonDirectory(`${RESOURCE_REVISION_DIR}/${resourceId}`);
  }

  async getResourceRevision(resourceId, revisionId) {
    return this.store.read(`${RESOURCE_REVISION_DIR}/${resourceId}/${revisionId}.json`, null);
  }

  async writeResourceRevision(resourceId, revisionId, revision) {
    await this.store.write(`${RESOURCE_REVISION_DIR}/${resourceId}/${revisionId}.json`, revision);
    return revision;
  }

  async removeResourceRevisions(resourceId) {
    const files = await this.store.list(`${RESOURCE_REVISION_DIR}/${resourceId}`);
    let removed = 0;
    for (const file of files.filter((item) => item.endsWith('.json'))) {
      if (await this.store.remove(`${RESOURCE_REVISION_DIR}/${resourceId}/${file}`)) removed += 1;
    }
    return removed;
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
