import crypto from 'node:crypto';
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
import {
  aggregateCommunityCompatibility,
  scanCommunityDependencies
} from '../resources/communityDependencyScanner.js';
import {
  extractLightFrontendRuntime,
  mergeLightFrontendRuntimes
} from '../compat/lightFrontendRuntime.js';
import { enrichCharacterCard } from '../character/characterEnrichment.js';
import { APP_VERSION } from '../releaseInfo.js';
import { ResourceRepository } from './resourceLibrary/resourceRepository.js';
import {
  ResourceConflictService,
  createFingerprint
} from './resourceLibrary/resourceConflictService.js';
import { ResourceEvaluationService } from './resourceLibrary/resourceEvaluationService.js';
import { ResourceImportService } from './resourceLibrary/resourceImportService.js';
import { StoryCompositionService } from './resourceLibrary/storyCompositionService.js';

const RESOURCE_KINDS = new Set(['character', 'worldbook', 'prompt']);

export class ResourceLibraryService {
  constructor(store, {
    now = () => new Date(),
    appVersion = APP_VERSION,
    pluginRegistry = null,
    resolveBuiltInPack = () => null,
    listBuiltInPacks = () => [],
    repository = null,
    conflictService = null,
    evaluationService = null,
    importService = null,
    storyCompositionService = null
  } = {}) {
    this.store = store;
    this.now = now;
    this.appVersion = appVersion;
    this.pluginRegistry = pluginRegistry || new PluginRegistryService(store, { appVersion, now });
    this.resolveBuiltInPack = resolveBuiltInPack;
    this.listBuiltInPacks = listBuiltInPacks;
    this.repository = repository || new ResourceRepository(store);
    this.conflictService = conflictService || new ResourceConflictService();
    this.evaluationService = evaluationService || new ResourceEvaluationService();
    this.importService = importService || new ResourceImportService({
      conflictService: this.conflictService,
      evaluationService: this.evaluationService,
      now
    });
    this.storyComposition = storyCompositionService || new StoryCompositionService({
      createEmptyPackSeed
    });
  }

  async listAdapters() {
    return this.pluginRegistry.listAdapters();
  }

  async listPlugins() {
    return this.pluginRegistry.listPlugins();
  }

  async listResources({ kind = '', query = '' } = {}) {
    const items = await this.repository.listResources();
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
    return this.repository.getResource(id);
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
    await this.repository.writeResource(id, next);
    return structuredClone(next);
  }

  async updateResourcePayload(resourceId, input = {}) {
    const id = normalizeId(resourceId);
    if (!id) return null;
    const current = await this.getResource(id);
    if (!current) return null;
    if (!['worldbook', 'prompt'].includes(current.kind)) {
      throw new Error('RESOURCE_CONTENT_KIND_UNSUPPORTED');
    }

    const sourcePayload = input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
      ? input.payload
      : {};
    let payload;
    if (current.kind === 'worldbook') {
      const entries = Array.isArray(sourcePayload.entries) ? sourcePayload.entries : null;
      if (!entries) throw new Error('RESOURCE_WORLD_BOOK_ENTRIES_INVALID');
      if (entries.length > 2000) throw new Error('RESOURCE_WORLD_BOOK_TOO_LARGE');
      payload = {
        ...(current.payload || {}),
        entries: entries.map((entry) => normalizeWorldBookEntry(entry || {}))
      };
    } else {
      payload = normalizePromptModule({
        ...(current.payload || {}),
        ...sourcePayload,
        id: sourcePayload.id || current.payload?.id
      });
    }

    const timestamp = this.now().toISOString();
    const next = {
      ...current,
      title: normalizeLibraryText(input.title, current.title, 120),
      payload,
      updatedAt: timestamp
    };
    await this.repository.writeResource(id, next);
    const reevaluated = await this.reevaluateResource(id);
    return reevaluated?.resource || structuredClone(next);
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

  async reevaluateResource(resourceId) {
    const id = normalizeId(resourceId);
    if (!id) return null;
    const current = await this.getResource(id);
    if (!current) return null;

    const existing = await this.listResources();
    const importBatchId = String(current.source?.importBatchId || '');
    const companionWorldBooks = current.kind === 'character' && importBatchId
      ? existing
        .filter((item) => item.kind === 'worldbook' && item.source?.importBatchId === importBatchId)
        .flatMap((item) => item.payload?.entries || [])
      : [];
    const enrichment = current.kind === 'character'
      ? enrichCharacterCard(normalizeCharacterCard(current.payload || {}), {
        worldBookEntries: companionWorldBooks
      })
      : { card: structuredClone(current.payload || {}), report: null };
    const payload = enrichment.card;
    const candidate = {
      kind: current.kind,
      title: current.title,
      summary: current.summary,
      tags: current.tags,
      payload,
      version: current.source?.version || ''
    };
    const { fingerprint, conflicts } = this.conflictService.findConflicts(candidate, existing, {
      excludeId: id
    });
    const adapters = await this.listAdapters();
    const adapter = adapters.find((item) => item.id === current.format) || {
      id: current.format || current.source?.adapterId || 'resource-library'
    };
    const diagnostics = this.evaluationService.evaluate(candidate, {
      conflicts,
      source: current.source || {},
      adapter
    });
    const timestamp = this.now().toISOString();
    const next = {
      ...current,
      fingerprint,
      diagnostics,
      payload,
      updatedAt: timestamp
    };
    await this.repository.writeResource(id, next);
    return {
      resource: structuredClone(next),
      enrichment: enrichment.report
    };
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
      return {
        ...packageInspection(adapter, inspection, {
          kind: 'content-pack',
          title: inspection.manifest.title,
          payload: preview.importData?.contentPackBundle || {}
        }),
        communityCompatibility: scanCommunityDependencies(preview.importData?.contentPackBundle?.content || {})
      };
    }
    const candidates = buildPreviewCandidates(preview, source);
    const existing = await this.listResources();
    const evaluation = this.importService.inspectCandidates(candidates, existing, {
      source,
      adapter
    });
    return {
      adapter,
      ...evaluation,
    };
  }

  async savePreview(preview, source = {}, { inspection: suppliedInspection = null } = {}) {
    if (preview?.kind === 'plugin-manifest' || preview?.kind === 'content-pack') {
      throw new Error('PACKAGE_PREVIEW_REQUIRES_INSTALL');
    }
    const inspection = suppliedInspection || await this.inspectPreview(preview, source);
    const candidates = buildPreviewCandidates(preview, source);
    const existing = await this.listResources();
    const { importedAt, source: batchSource } = this.importService.createImportContext(source);
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
          await this.repository.writeResource(duplicate.id, updated);
          resources.push({ ...updated, importStatus: 'updated' });
          continue;
        }
        resources.push({ ...duplicate, importStatus: 'duplicate' });
        continue;
      }

      const resource = this.importService.createResourceRecord(
        candidate,
        inspected,
        inspection.adapter,
        batchSource,
        importedAt
      );
      await this.repository.writeResource(resource.id, resource);
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
    return this.repository.removeResource(id);
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
    const pack = await this.repository.getPack(id);
    if (!pack) return null;
    const openingTemplate = createCustomOpeningTemplate(pack);
    return {
      ...pack,
      openingTemplate,
      manifest: createContentPackManifest(pack)
    };
  }

  async updatePackMetadata(packId, input = {}) {
    const id = normalizeId(packId);
    if (!id) return null;
    const current = await this.getPack(id);
    if (!current) return null;
    const title = normalizeLibraryText(input.title, current.title, 80);
    const description = normalizeLibraryText(input.description, current.description, 300, { allowEmpty: true });
    const sessionTitle = normalizeLibraryText(input.sessionTitle, current.sessionTitle || title, 80);
    const next = {
      ...current,
      title,
      description,
      sessionTitle,
      manifest: {
        ...current.manifest,
        title,
        description
      },
      updatedAt: this.now().toISOString()
    };
    next.openingTemplate = createCustomOpeningTemplate(next);
    await this.repository.writePack(id, next);
    return structuredClone(next);
  }

  async createPack(input = {}, { basePack = null } = {}) {
    const { character, worldBooks, prompts, selected } = await this.resolvePackResources(input);
    const includeBaseContent = input.includeBaseContent !== false;
    const baseInheritanceMode = basePack
      ? this.storyComposition.normalizeBaseInheritanceMode(input.baseInheritanceMode, includeBaseContent)
      : includeBaseContent ? 'full' : 'none';
    const id = `custom-${crypto.randomUUID()}`;
    const timestamp = this.now().toISOString();
    const base = basePack
      ? structuredClone(basePack)
      : createCustomBaselineSeed(id, input.customBaseline, this.now);
    const inheritedWorldBook = this.storyComposition.selectInheritedWorldBook(base.worldBook, baseInheritanceMode);
    const inheritedPromptModules = this.storyComposition.selectInheritedPromptModules(base.promptModules, baseInheritanceMode);
    const worldBookMergeMode = baseInheritanceMode !== 'none'
      ? this.storyComposition.normalizeWorldBookMergeMode(input.worldBookMergeMode)
      : 'resources-only';
    const composition = this.storyComposition.composeWorldBookEntries({
      baseEntries: inheritedWorldBook,
      resourceGroups: worldBooks.map((item) => ({
        resourceId: item.id,
        title: item.title,
        entries: item.payload?.entries || []
      })),
      mode: worldBookMergeMode
    });
    const promptComposition = this.storyComposition.composePromptModules({
      baseModules: inheritedPromptModules,
      resources: prompts
    });
    const promptModules = promptComposition.modules;
    const communityCompatibility = aggregateCommunityCompatibility(
      selected.map((item) => item.diagnostics?.communityCompatibility)
    );
    const characterCard = character?.payload
      || (baseInheritanceMode === 'none' ? {} : base.characterCard);
    const lightFrontend = mergeLightFrontendRuntimes([
      baseInheritanceMode === 'full' ? base.lightFrontend || {} : {},
      ...selected.map((item) => extractLightFrontendRuntime(item.payload || {}))
    ]);
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
      lightFrontend,
      memory: this.storyComposition.createComposedMemory(base, id, baseInheritanceMode),
      ruleSystem: this.storyComposition.createComposedRuleSystem(base, id, baseInheritanceMode, basePack?.id || ''),
      visualPackId: String(input.visualPackId || base.visualPackId || base.id || 'xuanhuan'),
      custom: true,
      resourceManifest: {
        creationMode: input.creationMode === 'independent-copy' ? 'independent-copy' : 'composed',
        basePackId: baseInheritanceMode === 'none' ? '' : basePack?.id || '',
        includeBaseContent: baseInheritanceMode !== 'none',
        baseInheritanceMode,
        worldBookMergeMode,
        characterResourceId: character?.id || '',
        worldBookResourceIds: worldBooks.map((item) => item.id),
        promptResourceIds: prompts.map((item) => item.id),
        sourceResources: selected.map(summarizePackSourceResource),
        composition: {
          ...structuredClone(composition.report.summary),
          promptModules: structuredClone(promptComposition.report.summary),
          communityCompatibility
        }
      },
      createdAt: timestamp,
      updatedAt: timestamp
    };
    pack.openingTemplate = createCustomOpeningTemplate(pack);
    pack.manifest = createContentPackManifest(pack, {
      version: input.version || '1.0.0',
      engine: input.engine || '>=0.2.2 <1.0.0',
      manifestId: id,
      dependencies: [
        ...(pack.resourceManifest.basePackId
          ? [{ kind: 'content-pack', id: pack.resourceManifest.basePackId, range: '^1.0.0', optional: false, scope: 'build' }]
          : []),
        ...(Array.isArray(input.pluginDependencies) ? input.pluginDependencies : [])
      ]
    });
    await this.repository.writePack(id, pack);
    return structuredClone(pack);
  }

  async inspectPackComposition(input = {}, { basePack = null } = {}) {
    const { character, worldBooks, prompts } = await this.resolvePackResources(input);
    const includeBaseContent = input.includeBaseContent !== false;
    const baseInheritanceMode = basePack
      ? this.storyComposition.normalizeBaseInheritanceMode(input.baseInheritanceMode, includeBaseContent)
      : includeBaseContent ? 'full' : 'none';
    const base = basePack
      ? structuredClone(basePack)
      : createCustomBaselineSeed('custom-preview', input.customBaseline, this.now);
    const inheritedWorldBook = this.storyComposition.selectInheritedWorldBook(base.worldBook, baseInheritanceMode);
    const inheritedPromptModules = this.storyComposition.selectInheritedPromptModules(base.promptModules, baseInheritanceMode);
    const mode = baseInheritanceMode !== 'none'
      ? this.storyComposition.normalizeWorldBookMergeMode(input.worldBookMergeMode)
      : 'resources-only';
    const composition = this.storyComposition.composeWorldBookEntries({
      baseEntries: inheritedWorldBook,
      resourceGroups: worldBooks.map((item) => ({
        resourceId: item.id,
        title: item.title,
        entries: item.payload?.entries || []
      })),
      mode
    });
    const promptComposition = this.storyComposition.composePromptModules({
      baseModules: inheritedPromptModules,
      resources: prompts
    });
    const communityCompatibility = aggregateCommunityCompatibility(
      [character, ...worldBooks, ...prompts]
        .filter(Boolean)
        .map((item) => item.diagnostics?.communityCompatibility)
    );
    return {
      mode: composition.report.mode,
      baseInheritanceMode,
      summary: {
        ...composition.report.summary,
        ...promptComposition.report.summary
      },
      conflicts: [
        ...composition.report.conflicts,
        ...promptComposition.report.conflicts
      ],
      selected: {
        characterResourceId: character?.id || '',
        worldBookResourceIds: worldBooks.map((item) => item.id),
        promptResourceIds: prompts.map((item) => item.id)
      },
      promptModules: {
        base: inheritedPromptModules.length,
        selected: prompts.length,
        final: promptComposition.modules.length
      },
      communityCompatibility
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
    return { character, worldBooks, prompts, selected };
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
    await this.repository.writePack(internalId, pack);
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
    if (!id || !await this.getPack(id)) return false;
    return this.repository.removePack(id);
  }

  async loadStoredPacks() {
    return this.repository.listPacks();
  }
}

function buildPreviewCandidates(preview, source) {
  if (preview?.kind === 'character-card') {
    const entries = Array.isArray(preview.importData?.worldBook) ? preview.importData.worldBook : [];
    const card = enrichCharacterCard(
      normalizeCharacterCard(preview.importData?.characterCard || {}),
      { worldBookEntries: entries }
    ).card;
    const candidates = [{
      kind: 'character',
      title: card.name || '未命名角色',
      summary: summarizeText(card.description || card.personality || card.scenario),
      tags: card.tags || [],
      payload: card,
      hasEmbeddedPortrait: preview.summary?.hasEmbeddedPortrait === true,
      version: card.characterVersion
    }];
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

  if (preview?.kind === 'prompt-preset') {
    const preset = preview.importData?.promptPreset || {};
    const prompts = Array.isArray(preview.importData?.promptModules)
      ? preview.importData.promptModules
      : [];
    return prompts.map((item, index) => {
      const prompt = normalizePromptModule(item);
      return {
        kind: 'prompt',
        title: prompt.title || `${preview.title || '导入预设'} · ${index + 1}`,
        summary: summarizeText(prompt.content),
        tags: uniqueStrings([
          'SillyTavern',
          '提示词预设',
          preset.sourceFormat,
          prompt.role
        ]),
        payload: prompt,
        version: source.version
      };
    });
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

function summarizePackSourceResource(resource = {}) {
  const source = resource.source || {};
  return {
    id: String(resource.id || '').trim(),
    kind: String(resource.kind || '').trim(),
    title: String(resource.title || '').trim(),
    fingerprint: String(resource.fingerprint || '').trim(),
    source: {
      adapterId: String(source.adapterId || '').trim(),
      community: String(source.community || '').trim(),
      site: String(source.site || '').trim(),
      url: String(source.url || '').trim(),
      author: String(source.author || '').trim(),
      license: String(source.license || '').trim(),
      version: String(source.version || '').trim(),
      fileName: String(source.fileName || '').trim(),
      importedAt: String(source.importedAt || '').trim(),
      originalHash: String(source.originalHash || '').trim()
    }
  };
}

function summarizeCustomPack(pack, compatibility = null) {
  const manifest = summarizeContentPackManifest(pack);
  const openingTemplate = createCustomOpeningTemplate(pack);
  return {
    id: pack.id,
    title: pack.title,
    description: pack.description,
    sessionTitle: pack.sessionTitle,
    characterName: pack.characterCard?.name || '',
    characterPortrait: structuredClone(pack.characterCard?.portrait || null),
    stageBackground: structuredClone(pack.stageBackground || null),
    openingTemplate: structuredClone(openingTemplate),
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

function createCustomOpeningTemplate(pack = {}) {
  const character = pack.characterCard || {};
  const visibleEntries = (Array.isArray(pack.worldBook) ? pack.worldBook : [])
    .filter((entry) => entry && entry.enabled !== false)
    .filter((entry) => {
      const visibility = entry?.extensions?.visibility || entry?.visibility || 'player';
      return visibility !== 'gm' && entry?.extensions?.gmOnly !== true;
    })
    .map((entry, index) => {
      const title = normalizeOpeningEntryTitle(entry.title || entry.id, character.name);
      const content = summarizeOpeningText(entry.content, 260);
      return {
        entry,
        index,
        title,
        content,
        score: scoreOpeningEntry(entry, title, content)
      };
    })
    .filter((item) => item.title && item.content)
    .filter((item) => !isOpeningMetaEntry(item.title))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const genre = inferCustomOpeningGenre(pack, visibleEntries);
  const packTitle = String(pack.title || character.name || '自定义剧本').trim().slice(0, 80);
  const characterName = String(character.name || '').trim();
  const narrativeLead = summarizeOpeningText(
    character.scenario
      || pack.description
      || visibleEntries[0]?.content
      || character.description
      || character.firstMessage,
    140
  );
  const tabs = buildCustomOpeningTabs(visibleEntries, character);
  const destinyCards = buildCustomDestinyCards(visibleEntries, character, packTitle);

  return {
    source: 'custom-pack',
    packId: String(pack.id || ''),
    genre,
    title: packTitle,
    subtitle: characterName ? `${characterName} · 独立角色剧本` : '角色卡世界 · 独立开局',
    tagline: narrativeLead || '以当前角色卡、世界书与已选设定为边界，生成这段故事的第一幕。',
    buttonText: '[ 封存当前设定 · 开始故事 ]',
    tabs,
    fields: buildCustomOpeningFields(character, visibleEntries),
    destinyCards: {
      label: `开局抉择 · ${packTitle}`,
      hint: '候选取自当前角色卡和世界书；选择后会写入开局提示与长期事实。',
      maxSelections: Math.min(3, Math.max(1, destinyCards.length)),
      cards: destinyCards
    },
    sidebar: {
      tabs: customOpeningSidebarTabs(genre)
    }
  };
}

function inferCustomOpeningGenre(pack, entries = []) {
  const character = pack.characterCard || {};
  const primaryEvidence = [
    pack.title,
    pack.description,
    pack.sessionTitle,
    character.name,
    character.description,
    character.personality,
    character.scenario,
    character.systemPrompt,
    ...(character.tags || [])
  ].filter(Boolean).join(' ');
  const entryTitles = entries.slice(0, 32).map((item) => item.title).filter(Boolean).join(' ');
  const entryContents = entries.slice(0, 20).map((item) => item.content).filter(Boolean).join(' ');
  const visualGenre = String(pack.visualPackId || pack.resourceManifest?.basePackId || '').trim();
  const patterns = {
    yingxiongzhi: /英雄志|怒苍|正统军|五朝旧账/,
    mingmo: /明末|崇祯|大明|辽东|密诏|饷银|东林/,
    lingyi: /灵异|恐怖|诡异|怪谈|鬼怪|鬼物|鬼魂|阴阳|禁忌|凶宅|民俗|邪祟|诅咒/,
    xianxia: /修仙|仙侠|仙途|飞升|灵根|金丹|元婴|宗门|道侣|炉鼎|灵气|渡劫|境界|神宫|功法|法宝/,
    xuanhuan: /玄幻|武道|斗气|魔法|异界|神荒|江湖|武侠/
  };
  const scores = Object.fromEntries(Object.keys(patterns).map((genre) => [genre, 0]));
  Object.entries(patterns).forEach(([genre, pattern]) => {
    scores[genre] += countOpeningGenreMatches(primaryEvidence, pattern) * 5;
    scores[genre] += countOpeningGenreMatches(entryTitles, pattern) * 2;
    scores[genre] += Math.min(8, countOpeningGenreMatches(entryContents, pattern) * 0.25);
  });
  if (Object.hasOwn(scores, visualGenre)) scores[visualGenre] += 4;
  return Object.entries(scores)
    .sort((left, right) => right[1] - left[1])
    .find(([, score]) => score > 0)?.[0] || 'xuanhuan';
}

function countOpeningGenreMatches(text, pattern) {
  const matches = String(text || '').match(new RegExp(pattern.source, 'g'));
  return matches?.length || 0;
}

function buildCustomOpeningTabs(entries, character) {
  const selected = entries.slice(0, 5);
  const fallbacks = [
    ['character', '角色底稿', character.description],
    ['personality', '性格与边界', character.personality],
    ['scenario', '开局场景', character.scenario],
    ['first-message', '初始引子', character.firstMessage]
  ].filter(([, , content]) => summarizeOpeningText(content, 260));
  const sections = selected.length ? selected.map((item, index) => [
    `worldbook-${index + 1}`,
    item.title,
    item.content
  ]) : fallbacks;

  return Object.fromEntries(sections.map(([key, label, content]) => [
    key,
    { label, content: summarizeOpeningText(content, 260) }
  ]));
}

function buildCustomOpeningFields(character, entries = []) {
  const profileText = findCustomProtagonistEntry(entries)?.entry?.content || '';
  const openingText = selectCharacterOpeningText(character);
  const generatedFields = character.extensions?.local_roleplay_agent?.enrichment?.generatedFields || [];
  const authoredScenario = generatedFields.includes('scenario')
    ? ''
    : summarizeOpeningText(character.scenario, 110);
  const role = extractOpeningProfileValue(profileText, ['角色', '当前身份', '身份'])
    || summarizeOpeningText(character.role || character.description, 90);
  const background = extractOpeningProfileValue(profileText, ['背景与家庭生活', '背景经历', '背景', '来历', '出身'])
    || summarizeOpeningText(character.description, 110);
  const appearance = extractOpeningProfileValue(profileText, ['外貌与衣着', '外貌', '容貌', '形貌'])
    || summarizeOpeningText(character.appearance, 90);
  const personality = extractOpeningProfileValue(profileText, ['性格与底线', '性格', '心性', '人格'])
    || summarizeOpeningText(character.personality, 90);
  const ability = extractOpeningProfileValue(profileText, ['特殊体质', '能力与境界', '能力', '修为境界', '修为', '境界', '体质'])
    || inferOpeningAbility(profileText);
  const faction = extractOpeningProfileValue(profileText, ['阵营与归属', '阵营', '归属', '宗门', '门派'])
    || inferOpeningFaction(role);
  const inventory = extractOpeningProfileValue(profileText, ['随身物品', '重要物品', '物品', '法宝', '装备']);
  const relationship = extractOpeningProfileValue(profileText, ['关系模式', '重要关系', '人物关系', '关系'])
    || findOpeningSentence(profileText, /相依为命|青梅竹马|师徒|道侣|盟友|宿敌|仇敌|亲友|同伴/);
  const explicitGoal = authoredScenario
    || extractOpeningProfileValue(profileText, ['当前目标', '核心目标', '主线目标', '目标', '动机'])
    || findOpeningEntryValue(entries, /目标|任务|主线|诉求|目的/, /目标|任务|必须|想要|寻找|查清|守住|逃离|完成/);
  const goal = explicitGoal || buildOpeningGoal({ role, ability, relationship });
  const explicitRisk = extractOpeningProfileValue(profileText, ['秘密与风险', '秘密', '风险', '弱点', '禁忌'])
    || findOpeningEntryValue(
      entries,
      /风险|秘密|发现与后果|禁忌|弱点|代价|限制/,
      /暴露|发现|争夺|抢夺|追杀|圈养|控制|危险|代价|限制|禁忌/,
      /一旦暴露|保密的重要性|整个修真界/
    );
  const secret = explicitRisk || buildOpeningRisk(ability);
  const explicitOpening = findOpeningEntryValue(entries, /开局|当前处境|起始|第一幕|初始场景/, /开局|当前|正在|即将|必须|危机|处境/);
  const openingPressure = explicitOpening || openingText;

  return {
    name: createCustomOpeningField('姓名 / 称谓', '输入角色姓名', character.name),
    role: createCustomOpeningField('当前身份', '在当前世界中的公开身份', role),
    background: createCustomOpeningField('来历与经历', '从何处来，背负什么旧事', background),
    appearance: createCustomOpeningField('外貌与衣着', '外貌、服饰与显眼特征', appearance),
    personality: createCustomOpeningField('性格与底线', '行事方式、欲望与不可触碰的底线', personality),
    ability: createCustomOpeningField('能力 / 境界', '当前真正掌握的能力及其代价', ability),
    faction: createCustomOpeningField('阵营 / 归属', '门派、家族、组织或独行身份', faction),
    inventory: createCustomOpeningField('随身物品', '开局能够实际使用的重要物品', inventory),
    goal: createCustomOpeningField('当前目标', '此刻最想完成的事情', goal),
    secret: createCustomOpeningField('秘密 / 风险', '不愿公开的事实或迫近的危险', secret),
    relationshipStyle: createCustomOpeningField('关系模式', '角色与他人建立关系的方式', relationship),
    openingPressure: createCustomOpeningField('开局处境', '第一幕发生时正在面对的压力', openingPressure)
  };
}

function createCustomOpeningField(label, placeholder, value, alternatives = []) {
  const values = uniqueStrings([value, ...alternatives])
    .map((item) => summarizeOpeningText(item, 110))
    .filter(Boolean);
  return {
    label,
    placeholder: values[0] || placeholder,
    ...(values.length ? { defaultValue: values[0], values } : {})
  };
}

function findCustomProtagonistEntry(entries) {
  return entries.find((item) => /^(?:主角|男主角|女主角).*(?:人设|设定|档案)?$/.test(item.title))
    || entries.find((item) => /\[\s*(?:角色|身份)\s*[：:]/.test(String(item.entry?.content || '')))
    || null;
}

function extractOpeningProfileValue(content, labels = []) {
  const source = String(content || '');
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const bracketMatch = source.match(new RegExp(`\\[\\s*${escaped}\\s*[：:]\\s*([\\s\\S]*?)\\]`, 'i'));
    const lineMatch = source.match(new RegExp(`(?:^|[\\r\\n])\\s*[-*]?\\s*${escaped}\\s*[：:]\\s*([^\\r\\n]+)`, 'i'));
    const value = summarizeOpeningText(bracketMatch?.[1] || lineMatch?.[1], 110);
    if (value) return value;
  }
  return '';
}

function selectCharacterOpeningText(character) {
  const candidates = [
    character.firstMessage,
    ...(Array.isArray(character.alternateGreetings) ? character.alternateGreetings : []),
    character.scenario
  ];
  for (const candidate of candidates) {
    const raw = String(candidate || '').trim();
    if (!raw || /^【[^】]{1,40}】$/.test(raw)) continue;
    const paragraphs = raw
      .split(/(?:<UpdateVariable>|<StatusPlaceHolderImpl)/i)[0]
      .replace(/<SFW_IMG>[\s\S]*?<\/SFW_IMG>/gi, ' ')
      .replace(/<NSFW_IMG>[\s\S]*?<\/NSFW_IMG>/gi, ' ')
      .replace(/\{\{\s*user\s*\}\}/gi, '主角')
      .split(/\r?\n\s*\r?\n/)
      .map((item) => summarizeOpeningText(item, 90))
      .filter((item) => item.length >= 8)
      .slice(0, 3);
    const opening = summarizeOpeningText(paragraphs.join(' '), 110);
    if (opening) return opening;
  }
  return '';
}

function findOpeningEntryValue(entries, titlePattern, sentencePattern, preferredPattern = null) {
  const matched = entries.find((item) => titlePattern.test(item.title));
  if (!matched) return '';
  return findOpeningSentence(matched.entry?.content || matched.content, sentencePattern, {
    exclude: [matched.title],
    preferredPattern
  })
    || summarizeOpeningText(matched.entry?.content || matched.content, 110);
}

function findOpeningSentence(content, pattern, { exclude = [], preferredPattern = null } = {}) {
  const excluded = new Set(exclude.map((item) => normalizeOpeningComparable(item)).filter(Boolean));
  const sentences = String(content || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\{\{\s*user\s*\}\}/gi, '主角')
    .split(/(?<=[。！？；])|\r?\n/)
    .map((item) => summarizeOpeningText(item, 110))
    .filter((item) => item.length >= 6)
    .filter((item) => !excluded.has(normalizeOpeningComparable(item)));
  const matches = sentences.filter((item) => pattern.test(item));
  return (preferredPattern && matches.find((item) => preferredPattern.test(item)))
    || matches[0]
    || '';
}

function normalizeOpeningComparable(value) {
  return String(value || '')
    .replace(/^[#>*_【】\s-]+|[#>*_【】\s-]+$/g, '')
    .replace(/[：:。；;，,！？!?]/g, '')
    .trim();
}

function inferOpeningAbility(profileText) {
  const source = summarizeOpeningText(profileText, 500);
  const match = source.match(/(?:拥有|身负|觉醒)(?:修真界第一)?(?:特殊)?体质[“"：:\s]*([^”"'，,。；\s]{2,24})/);
  return match ? match[1] : '';
}

function inferOpeningFaction(role) {
  const match = String(role || '').match(/([\u4e00-\u9fff]{2,12}(?:宗|门|宫|派|阁|教|府|司|军|族))/);
  return match?.[1] || '';
}

function buildOpeningGoal({ role, ability, relationship }) {
  if (!role && !ability && !relationship) return '';
  const parts = [role ? `以${trimOpeningClause(role, 52)}的身份在当前局势中立足` : '在当前局势中立足'];
  if (ability) parts.push(`守住${trimOpeningClause(ability, 28)}的秘密`);
  if (relationship) parts.push(`维系${trimOpeningClause(relationship, 34)}`);
  return `${parts.join('，')}。`;
}

function buildOpeningRisk(ability) {
  if (!ability) return '';
  return `${trimOpeningClause(ability, 36)}一旦暴露，可能引来知情势力的争夺与控制。`;
}

function trimOpeningClause(value, maxLength) {
  return summarizeOpeningText(value, maxLength)
    .replace(/[”"'，,。；;！？!?\s]+$/g, '')
    .trim();
}

function buildCustomDestinyCards(entries, character, packTitle) {
  const hookPattern = /世界|基调|主角|人设|角色|地点|物品|体质|境界|势力|关系|危机|事件|任务|开局|规则|秘密|线索|因果|目标|禁忌/;
  const prioritized = [
    ...entries.filter((item) => hookPattern.test(item.title)),
    ...entries.filter((item) => !hookPattern.test(item.title))
  ];
  const seen = new Set();
  const cards = [];
  prioritized.forEach((item) => {
    const identity = item.title.toLowerCase();
    if (seen.has(identity) || cards.length >= 8) return;
    seen.add(identity);
    cards.push({
      id: `custom-world-hook-${cards.length + 1}`,
      title: item.title,
      content: summarizeOpeningText(item.content, 180),
      defaultSelected: cards.length < 3
    });
  });

  if (cards.length) return cards;
  const fallbackCards = [
    ['角色来历', character.description],
    ['开局处境', character.scenario || character.firstMessage],
    ['性格底线', character.personality]
  ].filter(([, content]) => summarizeOpeningText(content, 180));
  if (!fallbackCards.length) {
    fallbackCards.push(['世界初动', `${packTitle}的第一幕将从主角眼前正在发生的事件开始。`]);
  }
  return fallbackCards.map(([title, content], index) => ({
    id: `custom-character-hook-${index + 1}`,
    title,
    content: summarizeOpeningText(content, 180),
    defaultSelected: index < 3
  }));
}

function normalizeOpeningEntryTitle(value, characterName = '') {
  return String(value || '')
    .replace(/\{\{\s*user\s*\}\}/gi, '主角')
    .replace(/\{\{\s*char\s*\}\}/gi, characterName || '角色')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^[#*_\-\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
}

function summarizeOpeningText(value, maxLength = 180) {
  const text = String(value || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<\/?[^>]+>/g, ' ')
    .replace(/\{\{[\s\S]*?\}\}/g, ' ')
    .replace(/^[#>*_\-\s]+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, Math.max(1, maxLength - 1)).trim()}…` : text;
}

function isOpeningMetaEntry(title) {
  return /选开|COT|思维链|变量更新|插图|格式规则|正则|状态栏模板|生成模板|快速生成|免责声明|输出规则|破甲|NSFW|SFW|提示词模板/i.test(title);
}

function scoreOpeningEntry(entry, title, content) {
  const constantWeight = entry.constant ? 24 : 0;
  const priorityWeight = Math.max(0, Math.min(100, Number(entry.priority ?? 50))) / 5;
  const hookWeight = /世界|基调|主角|人设|角色|地点|物品|体质|境界|势力|关系|危机|事件|任务|开局|规则|秘密|线索|因果|目标|禁忌/.test(title) ? 32 : 0;
  const contentWeight = Math.min(content.length, 260) / 26;
  return constantWeight + priorityWeight + hookWeight + contentWeight;
}

function customOpeningSidebarTabs(genre) {
  const tabsByGenre = {
    xianxia: ['主角信息', '互动角色', '世界规则', '关系与势力', '故事线索'],
    lingyi: ['调查者档案', '互动角色', '禁忌规则', '线索证物', '事件进度'],
    mingmo: ['主角文书', '互动角色', '银粮账目', '关系与势力', '故事线索'],
    yingxiongzhi: ['人物档案', '互动角色', '剧情节点', '旧账关系', '江湖传闻'],
    xuanhuan: ['主角信息', '互动角色', '世界规则', '关系与势力', '故事线索']
  };
  return tabsByGenre[genre] || tabsByGenre.xuanhuan;
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
