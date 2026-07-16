import crypto from 'node:crypto';
import { rm } from 'node:fs/promises';
import {
  normalizeCharacterCard,
  normalizePromptModule,
  normalizeWorldBookEntry
} from '../config/configService.js';
import { resolveResourceAdapter } from '../resources/resourceAdapters.js';
import { PluginRegistryService } from './pluginRegistryService.js';
import { compareSemver } from '../lib/semver.js';
import {
  contentPackFromBundle,
  createContentPackBundle,
  createContentPackManifest,
  inspectContentPackBundle,
  summarizeContentPackManifest
} from '../content/contentPackManifest.js';
import {
  aggregateResourceEvaluations,
  detectExecutionRisks,
  evaluateResourceCandidate,
  estimateResourceTokens
} from '../resources/resourceEvaluator.js';
import { APP_VERSION } from '../releaseInfo.js';

const RESOURCE_DIR = 'library/resources';
const PACK_DIR = 'library/packs';
const RESOURCE_KINDS = new Set(['character', 'worldbook', 'prompt']);

export class ResourceLibraryService {
  constructor(store, {
    now = () => new Date(),
    appVersion = APP_VERSION,
    pluginRegistry = null,
    resolveBuiltInPack = () => null,
    listBuiltInPacks = () => []
  } = {}) {
    this.store = store;
    this.now = now;
    this.appVersion = appVersion;
    this.pluginRegistry = pluginRegistry || new PluginRegistryService(store, { appVersion, now });
    this.resolveBuiltInPack = resolveBuiltInPack;
    this.listBuiltInPacks = listBuiltInPacks;
  }

  async listAdapters() {
    return this.pluginRegistry.listAdapters();
  }

  async listPlugins() {
    return this.pluginRegistry.listPlugins();
  }

  async listResources({ kind = '', query = '' } = {}) {
    const files = await this.store.list(RESOURCE_DIR);
    const items = await loadJsonFiles(this.store, RESOURCE_DIR, files);
    const normalizedKind = String(kind || '').trim().toLowerCase();
    const needle = String(query || '').trim().toLowerCase();
    return items
      .filter((item) => !normalizedKind || item.kind === normalizedKind)
      .filter((item) => {
        if (!needle) return true;
        return [item.title, item.summary, ...(item.tags || []), item.source?.site, item.source?.author]
          .some((value) => String(value || '').toLowerCase().includes(needle));
      })
      .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
  }

  async getResource(resourceId) {
    const id = normalizeId(resourceId);
    if (!id) return null;
    return this.store.read(`${RESOURCE_DIR}/${id}.json`, null);
  }

  async inspectPreview(preview, source = {}) {
    const adapters = await this.listAdapters();
    const adapter = resolveResourceAdapter({ preview, source, adapters });
    if (preview?.kind === 'plugin-manifest') {
      const inspection = await this.pluginRegistry.inspectManifest(preview.importData?.pluginManifest || {});
      return packageInspection(adapter, inspection, {
        kind: 'plugin',
        title: inspection.manifest.name,
        payload: inspection.manifest
      });
    }
    if (preview?.kind === 'content-pack') {
      const inspection = await this.inspectContentPackBundle(preview.importData?.contentPackBundle || {});
      return packageInspection(adapter, inspection, {
        kind: 'content-pack',
        title: inspection.manifest.title,
        payload: preview.importData?.contentPackBundle || {}
      });
    }
    const candidates = buildPreviewCandidates(preview, source);
    const existing = await this.listResources();
    const resources = candidates.map((candidate) => {
      const fingerprint = createFingerprint(candidate.payload);
      const conflicts = existing
        .filter((item) => item.kind === candidate.kind)
        .filter((item) => item.fingerprint === fingerprint || normalizeTitle(item.title) === normalizeTitle(candidate.title))
        .map((item) => ({
          type: item.fingerprint === fingerprint ? 'exact-duplicate' : 'same-title',
          resourceId: item.id,
          title: item.title
        }));
      return {
        kind: candidate.kind,
        title: candidate.title,
        fingerprint,
        diagnostics: evaluateResourceCandidate(candidate, {
          conflicts,
          source,
          adapter
        })
      };
    });
    const evaluation = aggregateResourceEvaluations(resources.map((item) => item.diagnostics));
    return {
      adapter,
      ...evaluation,
      resources,
    };
  }

  async savePreview(preview, source = {}, { inspection: suppliedInspection = null } = {}) {
    if (preview?.kind === 'plugin-manifest' || preview?.kind === 'content-pack') {
      throw new Error('PACKAGE_PREVIEW_REQUIRES_INSTALL');
    }
    const inspection = suppliedInspection || await this.inspectPreview(preview, source);
    const candidates = buildPreviewCandidates(preview, source);
    const existing = await this.listResources();
    const importedAt = this.now().toISOString();
    const resources = [];

    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const inspected = inspection.resources[index];
      const duplicate = existing.find((item) => item.kind === candidate.kind && item.fingerprint === inspected.fingerprint);
      if (duplicate) {
        resources.push({ ...duplicate, importStatus: 'duplicate' });
        continue;
      }

      const id = crypto.randomUUID();
      const resource = {
        id,
        kind: candidate.kind,
        title: candidate.title,
        summary: candidate.summary,
        tags: uniqueStrings(candidate.tags),
        format: inspection.adapter.id,
        fingerprint: inspected.fingerprint,
        source: normalizeSource(source, candidate, importedAt),
        diagnostics: inspected.diagnostics,
        payload: structuredClone(candidate.payload),
        createdAt: importedAt,
        updatedAt: importedAt
      };
      await this.store.write(`${RESOURCE_DIR}/${id}.json`, resource);
      resources.push({ ...resource, importStatus: 'created' });
    }

    return { inspection, resources };
  }

  async savePromptResource(input = {}) {
    const prompt = normalizePromptModule({
      ...input,
      id: input.payload?.id || input.id,
      title: input.payload?.title || input.title,
      content: input.payload?.content || input.content,
      enabled: input.payload?.enabled ?? input.enabled ?? true
    });
    const preview = {
      kind: 'prompt-module',
      importData: { promptModule: prompt }
    };
    return this.savePreview(preview, input.source || {});
  }

  async removeResource(resourceId) {
    const id = normalizeId(resourceId);
    if (!id) return false;
    try {
      await rm(this.store.resolve(`${RESOURCE_DIR}/${id}.json`));
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }

  async listPacks() {
    const packs = await this.loadStoredPacks();
    const plugins = await this.listPlugins();
    const knownPacks = [...this.listBuiltInPacks(), ...packs.map((pack) => ({
      id: pack.id,
      manifest: createContentPackManifest(pack)
    }))];
    return packs
      .map((pack) => {
        const compatibility = inspectContentPackBundle(createContentPackBundle(pack), {
          appVersion: this.appVersion,
          installedPlugins: plugins,
          contentPacks: knownPacks
        });
        return summarizeCustomPack(pack, compatibility);
      })
      .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
  }

  async getPack(packId) {
    const id = normalizeId(packId);
    if (!id) return null;
    const pack = await this.store.read(`${PACK_DIR}/${id}.json`, null);
    if (!pack) return null;
    return {
      ...pack,
      manifest: createContentPackManifest(pack)
    };
  }

  async createPack(input = {}, { basePack = null } = {}) {
    const selectedIds = uniqueStrings([
      input.characterResourceId,
      ...(Array.isArray(input.worldBookResourceIds) ? input.worldBookResourceIds : []),
      ...(Array.isArray(input.promptResourceIds) ? input.promptResourceIds : [])
    ]);
    const selected = [];
    for (const resourceId of selectedIds) {
      const resource = await this.getResource(resourceId);
      if (!resource) throw new Error(`RESOURCE_NOT_FOUND:${resourceId}`);
      selected.push(resource);
    }

    const character = selected.find((item) => item.id === input.characterResourceId && item.kind === 'character');
    const worldBooks = selected.filter((item) => item.kind === 'worldbook');
    const prompts = selected.filter((item) => item.kind === 'prompt');
    const includeBaseContent = input.includeBaseContent !== false;
    const id = `custom-${crypto.randomUUID()}`;
    const timestamp = this.now().toISOString();
    const base = basePack ? structuredClone(basePack) : createEmptyPackSeed(id);
    const worldBook = dedupeByFingerprint([
      ...(includeBaseContent ? base.worldBook || [] : []),
      ...worldBooks.flatMap((item) => item.payload?.entries || [])
    ]);
    const promptModules = dedupeByFingerprint([
      ...(includeBaseContent ? base.promptModules || [] : []),
      ...prompts.map((item) => item.payload)
    ]);
    const characterCard = character?.payload || base.characterCard;

    const pack = {
      ...base,
      id,
      title: String(input.title || '自定义剧本').trim().slice(0, 80),
      description: String(input.description || '由本地素材库组合生成。').trim().slice(0, 300),
      sessionTitle: String(input.sessionTitle || input.title || '新的故事').trim().slice(0, 80),
      characterCard: normalizeCharacterCard(characterCard || {}),
      worldBook: worldBook.map(normalizeWorldBookEntry),
      promptModules: promptModules.map(normalizePromptModule),
      memory: {
        ...structuredClone(base.memory || {}),
        resourcePackId: id
      },
      ruleSystem: {
        ...structuredClone(base.ruleSystem || createEmptyPackSeed(id).ruleSystem),
        contentPackId: id,
        sourceContentPackId: basePack?.id || ''
      },
      visualPackId: String(input.visualPackId || base.visualPackId || base.id || 'xuanhuan'),
      custom: true,
      resourceManifest: {
        basePackId: basePack?.id || '',
        includeBaseContent,
        characterResourceId: character?.id || '',
        worldBookResourceIds: worldBooks.map((item) => item.id),
        promptResourceIds: prompts.map((item) => item.id)
      },
      createdAt: timestamp,
      updatedAt: timestamp
    };
    pack.manifest = createContentPackManifest(pack, {
      version: input.version || '1.0.0',
      engine: input.engine || '>=0.2.2 <1.0.0',
      manifestId: id,
      dependencies: [
        ...(basePack?.id ? [{ kind: 'content-pack', id: basePack.id, range: '^1.0.0', optional: false, scope: 'build' }] : []),
        ...(Array.isArray(input.pluginDependencies) ? input.pluginDependencies : [])
      ]
    });
    await this.store.write(`${PACK_DIR}/${id}.json`, pack);
    return structuredClone(pack);
  }

  async inspectContentPackBundle(bundle, { checkInstallConflicts = true } = {}) {
    const plugins = await this.listPlugins();
    const storedPacks = await this.loadStoredPacks();
    const builtInPacks = this.listBuiltInPacks();
    const knownPacks = [
      ...builtInPacks,
      ...storedPacks.map((pack) => ({ id: pack.id, manifest: createContentPackManifest(pack) }))
    ];
    const inspection = inspectContentPackBundle(bundle, {
      appVersion: this.appVersion,
      installedPlugins: plugins,
      contentPacks: knownPacks
    });
    const builtInConflict = checkInstallConflicts
      ? builtInPacks.find((pack) => String(pack.manifest?.id || pack.id) === inspection.manifest.id)
      : null;
    if (builtInConflict) {
      inspection.blockingIssues.push({
        code: 'content-pack-core-conflict',
        message: `内容包 ID ${inspection.manifest.id} 与内置剧本冲突。`,
        path: 'manifest.id'
      });
    }
    const existing = checkInstallConflicts
      ? storedPacks.find((pack) => createContentPackManifest(pack).id === inspection.manifest.id)
      : null;
    inspection.installAction = 'create';
    if (existing) {
      const existingManifest = createContentPackManifest(existing);
      const comparison = compareSemver(inspection.manifest.version, existingManifest.version);
      if (comparison === 0) {
        inspection.installAction = 'duplicate';
        inspection.warnings.push({
          code: 'content-pack-version-installed',
          message: `版本 ${inspection.manifest.version} 已安装。`,
          path: 'manifest.version'
        });
      } else if (comparison < 0) {
        inspection.installAction = 'downgrade';
        inspection.blockingIssues.push({
          code: 'content-pack-downgrade-blocked',
          message: `已安装 ${existingManifest.version}，默认禁止降级到 ${inspection.manifest.version}。`,
          path: 'manifest.version'
        });
      } else {
        inspection.installAction = 'update';
      }
      inspection.existingPackId = existing.id;
      inspection.existingVersion = existingManifest.version;
    }
    refreshPackageVerdict(inspection, '内容包');
    return inspection;
  }

  async inspectPackCompatibility(pack) {
    const bundle = createContentPackBundle(pack);
    return this.inspectContentPackBundle(bundle, { checkInstallConflicts: false });
  }

  async installContentPackBundle(bundle, source = {}, { inspection: suppliedInspection = null } = {}) {
    const inspection = suppliedInspection || await this.inspectContentPackBundle(bundle);
    if (!inspection.canInstall) {
      const error = new Error('CONTENT_PACK_INCOMPATIBLE');
      error.inspection = inspection;
      throw error;
    }
    if (inspection.installAction === 'duplicate' && inspection.existingPackId) {
      return {
        pack: await this.getPack(inspection.existingPackId),
        installStatus: 'duplicate',
        inspection
      };
    }

    const internalId = inspection.existingPackId || createImportedPackId(inspection.manifest.id);
    const timestamp = this.now().toISOString();
    const existing = inspection.existingPackId ? await this.getPack(inspection.existingPackId) : null;
    const pack = contentPackFromBundle(bundle, internalId, { importedAt: timestamp, source });
    if (existing?.createdAt) pack.createdAt = existing.createdAt;
    await this.store.write(`${PACK_DIR}/${internalId}.json`, pack);
    return {
      pack: structuredClone(pack),
      installStatus: inspection.installAction === 'update' ? 'updated' : 'created',
      inspection
    };
  }

  async installPluginManifest(manifest) {
    return this.pluginRegistry.installManifest(manifest);
  }

  async setPluginEnabled(pluginId, enabled) {
    return this.pluginRegistry.setEnabled(pluginId, enabled);
  }

  async removePlugin(pluginId) {
    return this.pluginRegistry.removePlugin(pluginId);
  }

  async exportPackBundle(packId) {
    const pack = this.resolveBuiltInPack(packId) || await this.getPack(packId);
    return pack ? createContentPackBundle(pack) : null;
  }

  async removePack(packId) {
    const id = normalizeId(packId);
    if (!id || !id.startsWith('custom-')) return false;
    try {
      await rm(this.store.resolve(`${PACK_DIR}/${id}.json`));
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }

  async loadStoredPacks() {
    const files = await this.store.list(PACK_DIR);
    return loadJsonFiles(this.store, PACK_DIR, files);
  }
}

function buildPreviewCandidates(preview, source) {
  if (preview?.kind === 'character-card') {
    const card = normalizeCharacterCard(preview.importData?.characterCard || {});
    const candidates = [{
      kind: 'character',
      title: card.name || '未命名角色',
      summary: summarizeText(card.description || card.personality || card.scenario),
      tags: card.tags || [],
      payload: card,
      version: card.characterVersion
    }];
    const entries = Array.isArray(preview.importData?.worldBook) ? preview.importData.worldBook : [];
    if (entries.length) candidates.push(buildWorldBookCandidate(entries, source.title || `${card.name}的设定集`));
    return candidates;
  }

  if (preview?.kind === 'world-book') {
    return [buildWorldBookCandidate(preview.importData?.worldBook || [], source.title || preview.title || '导入的世界书')];
  }

  if (preview?.kind === 'prompt-module') {
    const prompt = normalizePromptModule(preview.importData?.promptModule || {});
    return [{
      kind: 'prompt',
      title: prompt.title,
      summary: summarizeText(prompt.content),
      tags: [],
      payload: prompt,
      version: source.version
    }];
  }

  throw new Error('UNSUPPORTED_RESOURCE_PREVIEW');
}

function buildWorldBookCandidate(entries, title) {
  const normalized = (Array.isArray(entries) ? entries : []).map(normalizeWorldBookEntry);
  return {
    kind: 'worldbook',
    title: String(title || '导入的世界书').trim(),
    summary: `${normalized.length} 条设定 · ${uniqueStrings(normalized.flatMap((entry) => entry.keywords || [])).slice(0, 4).join('、') || '常驻规则'}`,
    tags: uniqueStrings(normalized.flatMap((entry) => entry.keywords || [])).slice(0, 12),
    payload: { entries: normalized },
    version: ''
  };
}

function diagnoseCandidate(candidate, conflicts, options = {}) {
  return evaluateResourceCandidate(candidate, { conflicts, ...options });
}

function normalizeSource(source, candidate, importedAt) {
  return {
    adapterId: String(source.adapterId || '').trim(),
    community: String(source.community || '').trim(),
    site: String(source.site || source.sourceId || 'local-file').trim(),
    url: String(source.url || '').trim(),
    author: String(source.author || '').trim(),
    license: String(source.license || '未声明').trim(),
    version: String(source.version || candidate.version || '').trim(),
    fileName: String(source.fileName || '').trim(),
    importedAt,
    originalHash: String(source.originalHash || '').trim()
  };
}

function summarizeCustomPack(pack, compatibility = null) {
  const manifest = summarizeContentPackManifest(pack);
  return {
    id: pack.id,
    title: pack.title,
    description: pack.description,
    sessionTitle: pack.sessionTitle,
    characterName: pack.characterCard?.name || '',
    custom: true,
    visualPackId: pack.visualPackId || pack.resourceManifest?.basePackId || '',
    basePackId: pack.resourceManifest?.basePackId || '',
    updatedAt: pack.updatedAt,
    manifest,
    version: manifest.version,
    compatibility: compatibility ? {
      compatible: compatibility.compatible,
      verdict: compatibility.verdict,
      verdictLabel: compatibility.verdictLabel,
      blockingCount: compatibility.blockingIssues.length,
      warningCount: compatibility.warnings.length
    } : null,
    counts: {
      promptModules: pack.promptModules?.length || 0,
      worldBook: pack.worldBook?.length || 0,
      memoryCards: pack.memory?.memoryCards?.length || 0,
      characterPresets: 1
    },
    resourceManifest: structuredClone(pack.resourceManifest || {})
  };
}

function packageInspection(adapter, inspection, candidate) {
  const fingerprint = createFingerprint(candidate.payload);
  return {
    adapter,
    ...inspection,
    resources: [{
      kind: candidate.kind,
      title: candidate.title,
      fingerprint,
      diagnostics: {
        score: inspection.score,
        verdict: inspection.verdict,
        summary: inspection.summary,
        blockingIssues: inspection.blockingIssues,
        warnings: inspection.warnings,
        riskFlags: inspection.riskFlags || []
      }
    }]
  };
}

function refreshPackageVerdict(inspection, label) {
  inspection.canInstall = inspection.blockingIssues.length === 0;
  inspection.canImport = inspection.canInstall;
  inspection.compatible = inspection.canInstall;
  inspection.verdict = inspection.blockingIssues.length ? 'blocked' : inspection.warnings.length ? 'review' : 'recommended';
  inspection.verdictLabel = inspection.verdict === 'recommended' ? '兼容可用' : inspection.verdict === 'review' ? '建议审阅' : '不兼容';
  inspection.score = Math.max(0, 100 - (inspection.blockingIssues.length * 25) - (inspection.warnings.length * 5));
  inspection.summary = inspection.blockingIssues.length
    ? `${label}存在 ${inspection.blockingIssues.length} 项阻断问题。`
    : `${label} ${inspection.installAction === 'update' ? '可更新' : inspection.installAction === 'duplicate' ? '已安装' : '可安装'}。`;
}

function createImportedPackId(manifestId) {
  const slug = String(manifestId || 'pack').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return `custom-imported-${slug || crypto.randomUUID()}`;
}

function createEmptyPackSeed(id) {
  return {
    id,
    promptModules: [],
    worldBook: [],
    characterCard: {},
    memory: {
      rollingSummary: '',
      unsummarizedTurnCount: 0,
      worldState: { flags: { genre: 'custom' } },
      memoryCards: [],
      archivedSummaries: []
    },
    ruleSystem: {
      id: `${id}-rules`,
      title: '自定义剧本规则',
      boundary: '以所选角色卡、世界书和 Prompt 为边界推进。',
      panels: []
    }
  };
}

async function loadJsonFiles(store, directory, files) {
  const items = await Promise.all((files || [])
    .filter((file) => file.endsWith('.json'))
    .map(async (file) => {
      try {
        return await store.read(`${directory}/${file}`, null);
      } catch {
        return null;
      }
    }));
  return items.filter(Boolean);
}

function createFingerprint(value) {
  const semanticValue = stripVolatileFields(value);
  return crypto.createHash('sha256').update(stableStringify(semanticValue)).digest('hex');
}

function stripVolatileFields(value) {
  if (Array.isArray(value)) return value.map(stripVolatileFields);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['id', 'assetId', 'updatedAt', 'createdAt', 'importedAt', 'raw'].includes(key))
    .map(([key, item]) => [key, stripVolatileFields(item)]));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function dedupeByFingerprint(items) {
  const seen = new Set();
  return (items || []).filter((item) => {
    const fingerprint = createFingerprint(item);
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  });
}

function uniqueStrings(values) {
  return [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function normalizeTitle(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeId(value) {
  const id = String(value || '').trim();
  return /^[a-zA-Z0-9_-]+$/.test(id) ? id : '';
}

function summarizeText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
}

export const resourceLibraryInternals = {
  createFingerprint,
  detectExecutionRisks,
  diagnoseCandidate,
  estimateResourceTokens
};
