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
        return [item.title, item.summary, ...(item.tags || []), ...(item.collections || []), item.source?.site, item.source?.author]
          .some((value) => String(value || '').toLowerCase().includes(needle));
      })
      .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
  }

  async getResource(resourceId) {
    const id = normalizeId(resourceId);
    if (!id) return null;
    return this.store.read(`${RESOURCE_DIR}/${id}.json`, null);
  }

  async updateResourceMetadata(resourceId, input = {}) {
    const id = normalizeId(resourceId);
    if (!id) return null;
    const current = await this.getResource(id);
    if (!current) return null;
    const timestamp = this.now().toISOString();
    const next = {
      ...current,
      title: normalizeLibraryText(input.title, current.title, 120),
      summary: normalizeLibraryText(input.summary, current.summary, 800, { allowEmpty: true }),
      tags: input.tags === undefined ? uniqueStrings(current.tags) : uniqueStrings(input.tags).slice(0, 40),
      collections: input.collections === undefined
        ? uniqueStrings(current.collections)
        : uniqueStrings(input.collections).slice(0, 20),
      favorite: input.favorite === undefined ? current.favorite === true : input.favorite === true,
      updatedAt: timestamp
    };
    await this.store.write(`${RESOURCE_DIR}/${id}.json`, next);
    return structuredClone(next);
  }

  async updateResourcesMetadata(resourceIds = [], input = {}) {
    const ids = uniqueStrings(resourceIds).map(normalizeId).filter(Boolean).slice(0, 500);
    const mode = input.mode === 'replace' ? 'replace' : 'merge';
    const incomingTags = input.tags === undefined ? null : uniqueStrings(input.tags);
    const incomingCollections = input.collections === undefined ? null : uniqueStrings(input.collections);
    const updated = [];
    const missing = [];
    for (const id of ids) {
      const current = await this.getResource(id);
      if (!current) {
        missing.push(id);
        continue;
      }
      const tags = incomingTags === null
        ? current.tags
        : mode === 'replace'
          ? incomingTags
          : uniqueStrings([...(current.tags || []), ...incomingTags]);
      const collections = incomingCollections === null
        ? current.collections
        : mode === 'replace'
          ? incomingCollections
          : uniqueStrings([...(current.collections || []), ...incomingCollections]);
      updated.push(await this.updateResourceMetadata(id, {
        tags,
        collections,
        favorite: input.favorite
      }));
    }
    return { updated, missing };
  }

  async exportResourceBundle(resourceIds = []) {
    const ids = uniqueStrings(resourceIds).map(normalizeId).filter(Boolean).slice(0, 500);
    const resources = [];
    const missing = [];
    for (const id of ids) {
      const resource = await this.getResource(id);
      if (resource) resources.push(resource);
      else missing.push(id);
    }
    return {
      schema: 'local-roleplay-agent.asset-bundle/v1',
      version: '1.0.0',
      appVersion: this.appVersion,
      exportedAt: this.now().toISOString(),
      resources: structuredClone(resources),
      missing
    };
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
          type: resolveResourceConflictType({ candidate, existing: item, fingerprint }),
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
    const importBatchId = String(source.importBatchId || crypto.randomUUID());
    const batchSource = { ...source, importBatchId };
    const resources = [];

    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const inspected = inspection.resources[index];
      const duplicate = existing.find((item) => item.kind === candidate.kind && item.fingerprint === inspected.fingerprint);
      if (duplicate) {
        const portraitChanged = candidate.kind === 'character'
          && candidate.payload?.portrait?.url
          && candidate.payload.portrait.url !== duplicate.payload?.portrait?.url;
        if (portraitChanged) {
          const updated = {
            ...duplicate,
            payload: structuredClone(candidate.payload),
            updatedAt: importedAt
          };
          await this.store.write(`${RESOURCE_DIR}/${duplicate.id}.json`, updated);
          resources.push({ ...updated, importStatus: 'updated' });
          continue;
        }
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
        collections: [],
        favorite: false,
        format: inspection.adapter.id,
        fingerprint: inspected.fingerprint,
        source: normalizeSource(batchSource, candidate, importedAt),
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

  async removeResources(resourceIds = []) {
    const ids = uniqueStrings(resourceIds).map(normalizeId).filter(Boolean).slice(0, 500);
    const removed = [];
    const missing = [];
    for (const id of ids) {
      if (await this.removeResource(id)) removed.push(id);
      else missing.push(id);
    }
    return { removed, missing };
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
    const { character, worldBooks, prompts } = await this.resolvePackResources(input);
    const includeBaseContent = input.includeBaseContent !== false;
    const id = `custom-${crypto.randomUUID()}`;
    const timestamp = this.now().toISOString();
    const base = basePack
      ? structuredClone(basePack)
      : createCustomBaselineSeed(id, input.customBaseline, this.now);
    const worldBookMergeMode = includeBaseContent
      ? normalizeWorldBookMergeMode(input.worldBookMergeMode)
      : 'resources-only';
    const composition = composeWorldBookEntries({
      baseEntries: base.worldBook || [],
      resourceGroups: worldBooks.map((item) => ({
        resourceId: item.id,
        title: item.title,
        entries: item.payload?.entries || []
      })),
      mode: worldBookMergeMode
    });
    const promptModules = dedupeByFingerprint([
      ...(includeBaseContent ? base.promptModules || [] : []),
      ...prompts.map((item) => item.payload)
    ]);
    const characterCard = character?.payload || base.characterCard;
    const stageBackground = input.useCharacterPortraitAsBackground === true
      ? createCharacterStageBackground(characterCard, character?.title)
      : null;

    const pack = {
      ...base,
      id,
      title: String(input.title || '自定义剧本').trim().slice(0, 80),
      description: String(input.description || '由本地素材库组合生成。').trim().slice(0, 300),
      sessionTitle: String(input.sessionTitle || input.title || '新的故事').trim().slice(0, 80),
      characterCard: normalizeCharacterCard(characterCard || {}),
      stageBackground,
      worldBook: composition.entries.map(normalizeWorldBookEntry),
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
        worldBookMergeMode,
        characterResourceId: character?.id || '',
        worldBookResourceIds: worldBooks.map((item) => item.id),
        promptResourceIds: prompts.map((item) => item.id),
        composition: structuredClone(composition.report.summary)
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

  async inspectPackComposition(input = {}, { basePack = null } = {}) {
    const { character, worldBooks, prompts } = await this.resolvePackResources(input);
    const includeBaseContent = input.includeBaseContent !== false;
    const base = basePack
      ? structuredClone(basePack)
      : createCustomBaselineSeed('custom-preview', input.customBaseline, this.now);
    const mode = includeBaseContent
      ? normalizeWorldBookMergeMode(input.worldBookMergeMode)
      : 'resources-only';
    const composition = composeWorldBookEntries({
      baseEntries: base.worldBook || [],
      resourceGroups: worldBooks.map((item) => ({
        resourceId: item.id,
        title: item.title,
        entries: item.payload?.entries || []
      })),
      mode
    });
    return {
      ...composition.report,
      selected: {
        characterResourceId: character?.id || '',
        worldBookResourceIds: worldBooks.map((item) => item.id),
        promptResourceIds: prompts.map((item) => item.id)
      },
      promptModules: {
        base: includeBaseContent ? Number(base.promptModules?.length || 0) : 0,
        selected: prompts.length
      }
    };
  }

  async resolvePackResources(input = {}) {
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
    return { character, worldBooks, prompts };
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

function resolveResourceConflictType({ candidate, existing, fingerprint }) {
  if (existing.fingerprint !== fingerprint) return 'same-title';
  const portraitUrl = candidate.kind === 'character' ? candidate.payload?.portrait?.url : '';
  if (
    candidate.kind === 'character'
    && (
      (portraitUrl && portraitUrl !== existing.payload?.portrait?.url)
      || (!portraitUrl && candidate.hasEmbeddedPortrait === true)
    )
  ) return 'portrait-update';
  return 'exact-duplicate';
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
      hasEmbeddedPortrait: preview.summary?.hasEmbeddedPortrait === true,
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
    importBatchId: String(source.importBatchId || '').trim(),
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
    characterPortrait: structuredClone(pack.characterCard?.portrait || null),
    stageBackground: structuredClone(pack.stageBackground || null),
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

function createCharacterStageBackground(characterCard, resourceTitle = '') {
  const portrait = characterCard?.portrait;
  const url = String(portrait?.url || '').trim();
  const assetId = String(portrait?.assetId || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(assetId) || url !== `/api/character-images/${assetId}.png`) return null;
  const characterName = String(characterCard?.name || resourceTitle || '角色').trim().slice(0, 60);
  return {
    url,
    assetId,
    source: 'character-portrait',
    fit: 'portrait',
    label: `${characterName}立绘`
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

function createCustomBaselineSeed(id, input = {}, now = () => new Date()) {
  const baseline = normalizeCustomBaseline(input);
  const seed = createEmptyPackSeed(id);
  const timestamp = now().toISOString();
  const worldBook = [];
  if (baseline.premise) {
    worldBook.push({
      id: `${id}-world-premise`,
      type: 'rule',
      title: `${baseline.worldName || '原创世界'} · 世界总纲`,
      content: [baseline.genre ? `类型与时代：${baseline.genre}` : '', baseline.premise].filter(Boolean).join('\n\n'),
      keywords: [],
      constant: true,
      priority: 95,
      depth: 1,
      enabled: true,
      source: 'custom-baseline',
      updatedAt: timestamp
    });
  }
  if (baseline.hardRules) {
    worldBook.push({
      id: `${id}-hard-rules`,
      type: 'rule',
      title: `${baseline.worldName || '原创世界'} · 不可违背规则`,
      content: baseline.hardRules,
      keywords: [],
      constant: true,
      priority: 100,
      depth: 0,
      enabled: true,
      source: 'custom-baseline',
      updatedAt: timestamp
    });
  }
  const promptContent = [
    baseline.genre ? `题材边界：${baseline.genre}` : '',
    baseline.proseStyle ? `叙事风格：${baseline.proseStyle}` : '',
    baseline.hardRules ? `硬性规则：${baseline.hardRules}` : ''
  ].filter(Boolean).join('\n\n');
  return {
    ...seed,
    title: baseline.worldName || '原创世界',
    visualPackId: baseline.visualPackId,
    worldBook,
    promptModules: promptContent ? [{
      id: `${id}-narrative-baseline`,
      title: '原创世界叙事基线',
      enabled: true,
      content: promptContent
    }] : [],
    memory: {
      ...seed.memory,
      worldState: {
        ...seed.memory.worldState,
        worldName: baseline.worldName,
        genre: baseline.genre,
        flags: {
          ...(seed.memory.worldState?.flags || {}),
          genre: baseline.genre || 'custom'
        }
      }
    },
    ruleSystem: {
      ...seed.ruleSystem,
      title: `${baseline.worldName || '原创世界'}规则`,
      boundary: baseline.hardRules || baseline.premise || seed.ruleSystem.boundary,
      panels: [
        ...(baseline.premise ? [{ id: 'world-premise', title: '世界总纲', content: baseline.premise }] : []),
        ...(baseline.hardRules ? [{ id: 'hard-rules', title: '硬性规则', content: baseline.hardRules }] : [])
      ]
    }
  };
}

function normalizeCustomBaseline(input = {}) {
  return {
    worldName: String(input?.worldName || '').trim().slice(0, 80),
    genre: String(input?.genre || '').trim().slice(0, 100),
    premise: String(input?.premise || '').trim().slice(0, 5000),
    proseStyle: String(input?.proseStyle || '').trim().slice(0, 2500),
    hardRules: String(input?.hardRules || '').trim().slice(0, 2500),
    visualPackId: String(input?.visualPackId || 'xuanhuan').trim() || 'xuanhuan'
  };
}

function normalizeWorldBookMergeMode(value) {
  return ['smart', 'base-first', 'resources-only'].includes(String(value || ''))
    ? String(value)
    : 'smart';
}

function composeWorldBookEntries({ baseEntries = [], resourceGroups = [], mode = 'smart' } = {}) {
  const mergeMode = normalizeWorldBookMergeMode(mode);
  const candidates = [];
  if (mergeMode !== 'resources-only') {
    (baseEntries || []).forEach((entry) => candidates.push({
      entry: normalizeWorldBookEntry(entry),
      origin: 'base',
      resourceId: '',
      resourceTitle: '题材基线'
    }));
  }
  (resourceGroups || []).forEach((group) => {
    (group.entries || []).forEach((entry) => candidates.push({
      entry: normalizeWorldBookEntry(entry),
      origin: 'resource',
      resourceId: group.resourceId || '',
      resourceTitle: group.title || '补充世界书'
    }));
  });

  const accepted = [];
  const conflicts = [];
  let exactDuplicates = 0;
  let sameTitleConflicts = 0;
  let constantConflicts = 0;
  let triggerOverlaps = 0;
  let replacedBaseEntries = 0;
  let skippedSelectedEntries = 0;

  candidates.forEach((candidate) => {
    const fingerprint = createFingerprint(candidate.entry);
    const exact = accepted.find((item) => item.fingerprint === fingerprint);
    if (exact) {
      exactDuplicates += 1;
      return;
    }

    const titleKey = normalizeTitle(candidate.entry.title);
    const sameTitleIndex = titleKey
      ? accepted.findIndex((item) => normalizeTitle(item.entry.title) === titleKey)
      : -1;
    if (sameTitleIndex >= 0) {
      const previous = accepted[sameTitleIndex];
      const constant = previous.entry.constant === true || candidate.entry.constant === true;
      if (constant) constantConflicts += 1;
      else sameTitleConflicts += 1;
      conflicts.push({
        type: constant ? 'constant-conflict' : 'same-title-conflict',
        title: candidate.entry.title,
        message: `${candidate.entry.title}：${previous.resourceTitle}与${candidate.resourceTitle}内容不同`,
        baseOrigin: previous.origin,
        resourceId: candidate.resourceId
      });
      const selectedCanReplace = mergeMode === 'smart' && candidate.origin === 'resource';
      if (selectedCanReplace) {
        if (previous.origin === 'base') replacedBaseEntries += 1;
        accepted[sameTitleIndex] = { ...candidate, fingerprint };
      } else {
        skippedSelectedEntries += candidate.origin === 'resource' ? 1 : 0;
      }
      return;
    }

    const candidateTriggers = getWorldBookTriggers(candidate.entry);
    if (candidateTriggers.size && candidate.origin === 'resource') {
      const overlap = accepted.find((item) => item.origin !== candidate.origin
        && setsIntersect(candidateTriggers, getWorldBookTriggers(item.entry)));
      if (overlap) {
        triggerOverlaps += 1;
        conflicts.push({
          type: 'trigger-overlap',
          title: candidate.entry.title,
          message: `${candidate.entry.title}与${overlap.entry.title}共享触发词，可能同时注入`,
          resourceId: candidate.resourceId
        });
      }
    }
    accepted.push({ ...candidate, fingerprint });
  });

  return {
    entries: accepted.map((item) => item.entry),
    report: {
      mode: mergeMode,
      summary: {
        baseEntries: mergeMode === 'resources-only' ? 0 : Number(baseEntries?.length || 0),
        selectedEntries: (resourceGroups || []).reduce((sum, group) => sum + Number(group.entries?.length || 0), 0),
        finalEntries: accepted.length,
        exactDuplicates,
        sameTitleConflicts,
        constantConflicts,
        triggerOverlaps,
        replacedBaseEntries,
        skippedSelectedEntries
      },
      conflicts
    }
  };
}

function getWorldBookTriggers(entry) {
  return new Set([
    ...(entry.keywords || []),
    ...(entry.secondaryKeywords || []),
    ...(entry.regex || [])
  ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean));
}

function setsIntersect(left, right) {
  for (const value of left) {
    if (right.has(value)) return true;
  }
  return false;
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
    .filter(([key]) => !['id', 'assetId', 'portrait', 'updatedAt', 'createdAt', 'importedAt', 'raw'].includes(key))
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

function normalizeLibraryText(value, fallback, maxLength, { allowEmpty = false } = {}) {
  if (value === undefined) return String(fallback || '');
  const normalized = String(value || '').trim().slice(0, maxLength);
  if (normalized || allowEmpty) return normalized;
  return String(fallback || '');
}

function uniqueStrings(values) {
  const list = Array.isArray(values) ? values : values === undefined || values === null ? [] : [values];
  return [...new Set(list.map((value) => String(value || '').trim()).filter(Boolean))];
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
