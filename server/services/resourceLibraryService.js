import crypto from 'node:crypto';
import { rm } from 'node:fs/promises';
import {
  normalizeCharacterCard,
  normalizePromptModule,
  normalizeWorldBookEntry
} from '../config/configService.js';
import { resolveResourceAdapter } from '../resources/resourceAdapters.js';

const RESOURCE_DIR = 'library/resources';
const PACK_DIR = 'library/packs';
const RESOURCE_KINDS = new Set(['character', 'worldbook', 'prompt']);

export class ResourceLibraryService {
  constructor(store, { now = () => new Date() } = {}) {
    this.store = store;
    this.now = now;
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
    const adapter = resolveResourceAdapter({ preview, source });
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
        diagnostics: diagnoseCandidate(candidate, conflicts)
      };
    });

    const score = resources.length
      ? Math.round(resources.reduce((sum, item) => sum + item.diagnostics.score, 0) / resources.length)
      : 0;
    return {
      adapter,
      score,
      grade: score >= 85 ? '完整' : score >= 65 ? '可用' : '待补全',
      resources,
      warningCount: resources.reduce((sum, item) => sum + item.diagnostics.warnings.length, 0),
      conflictCount: resources.reduce((sum, item) => sum + item.diagnostics.conflicts.length, 0),
      riskCount: resources.reduce((sum, item) => sum + item.diagnostics.riskFlags.length, 0)
    };
  }

  async savePreview(preview, source = {}) {
    const inspection = await this.inspectPreview(preview, source);
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
    const files = await this.store.list(PACK_DIR);
    const packs = await loadJsonFiles(this.store, PACK_DIR, files);
    return packs
      .map(summarizeCustomPack)
      .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
  }

  async getPack(packId) {
    const id = normalizeId(packId);
    if (!id) return null;
    return this.store.read(`${PACK_DIR}/${id}.json`, null);
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
    await this.store.write(`${PACK_DIR}/${id}.json`, pack);
    return structuredClone(pack);
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

function diagnoseCandidate(candidate, conflicts) {
  const warnings = [];
  const missingFields = [];
  const riskFlags = detectExecutionRisks(candidate.payload);
  let score = 100;

  if (candidate.kind === 'character') {
    const card = candidate.payload;
    for (const [field, label, penalty] of [
      ['description', '角色描述', 15],
      ['personality', '性格', 12],
      ['scenario', '当前场景', 10],
      ['firstMessage', '开场白', 15]
    ]) {
      if (!String(card[field] || '').trim()) {
        missingFields.push({ field, label });
        score -= penalty;
      }
    }
    if (!String(card.systemPrompt || '').trim() && !String(card.postHistoryInstructions || '').trim()) {
      warnings.push({ code: 'CHARACTER_WITHOUT_BEHAVIOR_RULE', message: '缺少角色行为约束，长对话中更容易偏离人设。' });
      score -= 8;
    }
    if (!Array.isArray(card.exampleDialog) || !card.exampleDialog.length) {
      warnings.push({ code: 'CHARACTER_WITHOUT_DIALOG_EXAMPLE', message: '没有示例对话，语言风格主要依赖模型自行发挥。' });
      score -= 5;
    }
  }

  if (candidate.kind === 'worldbook') {
    const entries = candidate.payload.entries || [];
    if (!entries.length) {
      missingFields.push({ field: 'entries', label: '世界书条目' });
      score -= 70;
    }
    const inertEntries = entries.filter((entry) => !entry.constant && !(entry.keywords || []).length && !(entry.regex || []).length);
    if (inertEntries.length) {
      warnings.push({ code: 'WORLD_BOOK_INERT_ENTRIES', message: `${inertEntries.length} 条设定没有关键词、正则或常驻标记，可能永远不会触发。` });
      score -= Math.min(20, inertEntries.length * 3);
    }
    const duplicateTitles = findDuplicates(entries.map((entry) => normalizeTitle(entry.title)).filter(Boolean));
    if (duplicateTitles.length) {
      warnings.push({ code: 'WORLD_BOOK_DUPLICATE_TITLES', message: `存在 ${duplicateTitles.length} 组同名条目，建议确认覆盖关系。` });
      score -= Math.min(12, duplicateTitles.length * 2);
    }
    if (entries.length > 240) {
      warnings.push({ code: 'WORLD_BOOK_LARGE', message: '条目很多，建议用触发词和深度控制上下文用量。' });
      score -= 4;
    }
  }

  if (candidate.kind === 'prompt') {
    if (!String(candidate.payload.content || '').trim()) {
      missingFields.push({ field: 'content', label: 'Prompt 内容' });
      score -= 80;
    }
  }

  const exactDuplicates = conflicts.filter((item) => item.type === 'exact-duplicate').length;
  const sameTitles = conflicts.filter((item) => item.type === 'same-title').length;
  if (exactDuplicates) warnings.push({ code: 'EXACT_DUPLICATE', message: '素材库中已有完全相同的内容，本次不会重复保存。' });
  if (sameTitles) warnings.push({ code: 'SAME_TITLE_DIFFERENT_CONTENT', message: '素材库中存在同名不同内容，将作为独立版本保留。' });
  if (riskFlags.length) score -= Math.min(30, riskFlags.length * 10);

  return {
    score: Math.max(0, score),
    grade: score >= 85 ? '完整' : score >= 65 ? '可用' : '待补全',
    warnings,
    missingFields,
    conflicts,
    riskFlags
  };
}

function detectExecutionRisks(payload) {
  const text = JSON.stringify(payload || {}).toLowerCase();
  const patterns = [
    ['script-tag', '<script', '包含脚本标签；只会作为文本保存，不会执行。'],
    ['process-command', 'child_process', '包含进程执行描述；不会获得本机执行权限。'],
    ['mcp-command', 'mcpservers', '包含 MCP 配置片段；不会自动注册或连接。'],
    ['shell-command', 'shell_command', '包含 Shell 命令字段；不会自动执行。']
  ];
  return patterns
    .filter(([, marker]) => text.includes(marker))
    .map(([code, , message]) => ({ code, message }));
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

function summarizeCustomPack(pack) {
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
    counts: {
      promptModules: pack.promptModules?.length || 0,
      worldBook: pack.worldBook?.length || 0,
      memoryCards: pack.memory?.memoryCards?.length || 0,
      characterPresets: 1
    },
    resourceManifest: structuredClone(pack.resourceManifest || {})
  };
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

function findDuplicates(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
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
  diagnoseCandidate
};
