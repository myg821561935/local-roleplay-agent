import { rm } from 'node:fs/promises';
import { BUILTIN_PLUGIN_MANIFESTS } from '../plugins/builtins.js';
import { inspectPluginManifest } from '../plugins/pluginManifest.js';
import { listResourceAdapters } from '../resources/resourceAdapters.js';

const PLUGIN_DIR = 'plugins/manifests';

export class PluginRegistryService {
  constructor(store, { appVersion = '0.2.2', now = () => new Date() } = {}) {
    this.store = store;
    this.appVersion = appVersion;
    this.now = now;
  }

  async listPlugins() {
    const records = await this.loadRecords();
    const coreIds = records.filter((item) => item.origin === 'core').map((item) => item.manifest.id);
    return records.map((record) => {
      const otherPlugins = records.filter((item) => item.manifest.id !== record.manifest.id);
      const otherAdapters = listResourceAdapters(otherPlugins);
      const inspection = inspectPluginManifest(record.manifest, {
        appVersion: this.appVersion,
        installedPlugins: otherPlugins,
        installedAdapters: otherAdapters,
        corePluginIds: record.origin === 'core' ? [] : coreIds
      });
      return {
        manifest: inspection.manifest,
        id: inspection.manifest.id,
        name: inspection.manifest.name,
        version: inspection.manifest.version,
        origin: record.origin,
        enabled: record.enabled !== false,
        installedAt: record.installedAt || '',
        updatedAt: record.updatedAt || '',
        compatible: inspection.canInstall,
        status: inspection.verdict,
        statusLabel: inspection.verdictLabel,
        blockingIssues: inspection.blockingIssues,
        warnings: inspection.warnings,
        dependencies: inspection.dependencies,
        adapterCount: inspection.manifest.adapters.length
      };
    }).sort(comparePluginRecords);
  }

  async listAdapters() {
    const plugins = await this.listPlugins();
    return listResourceAdapters(plugins.filter((plugin) => plugin.enabled && plugin.compatible));
  }

  async inspectManifest(input = {}) {
    const plugins = await this.listPlugins();
    const coreIds = plugins.filter((item) => item.origin === 'core').map((item) => item.id);
    const candidateId = String(input?.manifest?.id || input?.id || '').trim().toLowerCase();
    const otherPlugins = plugins.filter((item) => item.id !== candidateId);
    const inspection = inspectPluginManifest(input, {
      appVersion: this.appVersion,
      installedPlugins: plugins,
      installedAdapters: listResourceAdapters(otherPlugins),
      corePluginIds: coreIds
    });
    return inspection;
  }

  async installManifest(input = {}) {
    const inspection = await this.inspectManifest(input);
    if (!inspection.canInstall) {
      const error = new Error('PLUGIN_MANIFEST_INVALID');
      error.inspection = inspection;
      throw error;
    }
    if (inspection.installAction === 'duplicate') {
      const plugin = (await this.listPlugins()).find((item) => item.id === inspection.manifest.id);
      return { plugin, installStatus: 'duplicate', inspection };
    }

    const timestamp = this.now().toISOString();
    const fileName = pluginFileName(inspection.manifest.id);
    const existing = await this.store.read(`${PLUGIN_DIR}/${fileName}`, null);
    const stored = {
      manifest: inspection.manifest,
      enabled: existing?.enabled !== false,
      installedAt: existing?.installedAt || timestamp,
      updatedAt: timestamp
    };
    await this.store.write(`${PLUGIN_DIR}/${fileName}`, stored);
    const plugin = (await this.listPlugins()).find((item) => item.id === inspection.manifest.id);
    return {
      plugin,
      installStatus: inspection.installAction === 'update' ? 'updated' : 'created',
      inspection
    };
  }

  async setEnabled(pluginId, enabled) {
    const id = normalizePluginId(pluginId);
    if (!id) return null;
    if (BUILTIN_PLUGIN_MANIFESTS.some((manifest) => manifest.id === id)) {
      throw new Error('CORE_PLUGIN_IMMUTABLE');
    }
    const fileName = pluginFileName(id);
    const stored = await this.store.read(`${PLUGIN_DIR}/${fileName}`, null);
    if (!stored) return null;
    stored.enabled = enabled === true;
    stored.updatedAt = this.now().toISOString();
    await this.store.write(`${PLUGIN_DIR}/${fileName}`, stored);
    return (await this.listPlugins()).find((item) => item.id === id) || null;
  }

  async removePlugin(pluginId) {
    const id = normalizePluginId(pluginId);
    if (!id || BUILTIN_PLUGIN_MANIFESTS.some((manifest) => manifest.id === id)) return false;
    try {
      await rm(this.store.resolve(`${PLUGIN_DIR}/${pluginFileName(id)}`));
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }

  async loadRecords() {
    const core = BUILTIN_PLUGIN_MANIFESTS.map((manifest) => ({
      manifest: structuredClone(manifest),
      origin: 'core',
      enabled: true
    }));
    const files = await this.store.list(PLUGIN_DIR);
    const local = await Promise.all(files
      .filter((file) => file.endsWith('.json'))
      .map(async (file) => {
        try {
          const stored = await this.store.read(`${PLUGIN_DIR}/${file}`, null);
          if (!stored?.manifest) return null;
          return {
            ...stored,
            origin: 'local'
          };
        } catch {
          return null;
        }
      }));
    const coreIds = new Set(core.map((item) => item.manifest.id));
    return [...core, ...local.filter((item) => item && !coreIds.has(item.manifest.id))];
  }
}

function pluginFileName(pluginId) {
  return `${normalizePluginId(pluginId)}.json`;
}

function normalizePluginId(value) {
  const id = String(value || '').trim().toLowerCase();
  return /^[a-z][a-z0-9.-]{2,79}$/.test(id) ? id : '';
}

function comparePluginRecords(left, right) {
  if (left.origin !== right.origin) return left.origin === 'core' ? -1 : 1;
  return String(left.name || left.id).localeCompare(String(right.name || right.id), 'zh-CN');
}
