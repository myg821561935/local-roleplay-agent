import crypto from 'node:crypto';
import { defaultCharacterCard, defaultPersona, defaultPromptModules, defaultProviders, defaultQuickReplies, defaultWorldBook } from './defaults.js';
import { dedupeWorldBookEntries } from '../agent/factCards.js';

export class ConfigService {
  constructor(store) {
    this.store = store;
  }

  async getAll() {
    const providers = await this.store.read('config/providers.local.json', defaultProviders);
    const promptModules = await this.store.read('config/prompt-modules.json', defaultPromptModules);
    const worldBook = await this.store.read('config/world-book.json', defaultWorldBook);
    const characterCard = await this.store.read('config/character-card.json', defaultCharacterCard);
    const persona = await this.store.read('config/persona.json', defaultPersona);
    const quickReplies = await this.store.read('config/quick-replies.json', defaultQuickReplies);
    const characterPresets = await this.store.read('config/character-presets.json', []);
    const promptPresets = await this.store.read('config/prompt-presets.json', []);
    const groupMembers = await this.store.read('config/group-members.json', []);
    const macroTemplates = await this.store.read('config/macro-templates.json', []);
    const vectorMemory = await this.store.read('config/vector-memory.json', { enabled: false, providerId: '', topK: 5 });
    const mcpServers = await this.store.read('config/mcp-servers.json', []);
    return { providers, promptModules, worldBook, characterCard, persona, quickReplies, characterPresets, promptPresets, groupMembers, macroTemplates, vectorMemory, mcpServers };
  }

  async saveMacroTemplates(macroTemplates) {
    const normalized = (Array.isArray(macroTemplates) ? macroTemplates : [])
      .filter((t) => isPlainObject(t) && String(t.name || '').trim() && String(t.content || '').trim())
      .map((t) => ({
        name: String(t.name).trim().slice(0, 30),
        content: String(t.content),
        description: String(t.description || '').trim(),
        createdAt: t.createdAt || new Date().toISOString()
      }));
    return this.store.write('config/macro-templates.json', normalized);
  }

  async saveVectorMemory(vectorMemory) {
    const source = isPlainObject(vectorMemory) ? vectorMemory : {};
    return this.store.write('config/vector-memory.json', normalizeVectorMemory(source));
  }

  async saveMcpServers(mcpServers) {
    const source = Array.isArray(mcpServers) ? mcpServers : [];
    const normalized = source
      .filter((s) => isPlainObject(s) && String(s.id || '').trim())
      .map((s) => normalizeMcpServer(s));
    return this.store.write('config/mcp-servers.json', normalized);
  }

  async saveGroupMembers(groupMembers) {
    const normalized = (Array.isArray(groupMembers) ? groupMembers : [])
      .filter((m) => isPlainObject(m) && String(m.name || '').trim())
      .map((m) => ({
        id: String(m.id || `member-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`),
        name: String(m.name).trim().slice(0, 30),
        role: String(m.role || '').trim().slice(0, 60),
        description: String(m.description || '').trim(),
        personality: String(m.personality || '').trim(),
        systemPrompt: String(m.systemPrompt || '').trim(),
        enabled: m.enabled !== false
      }));
    return this.store.write('config/group-members.json', normalized);
  }

  async savePromptPresets(promptPresets) {
    const normalized = (Array.isArray(promptPresets) ? promptPresets : [])
      .filter((p) => isPlainObject(p) && Array.isArray(p.promptModules))
      .map((p) => ({
        id: String(p.id || `prompt-preset-${Date.now()}`),
        name: String(p.name || '未命名预设').trim().slice(0, 30),
        promptModules: p.promptModules.map(normalizePromptModule),
        createdAt: p.createdAt || new Date().toISOString()
      }));
    return this.store.write('config/prompt-presets.json', normalized);
  }

  async saveCharacterPresets(presets) {
    const normalized = (Array.isArray(presets) ? presets : [])
      .filter((p) => isPlainObject(p) && p.characterCard)
      .map((p) => ({
        id: String(p.id || `preset-${Date.now()}`),
        name: String(p.name || p.characterCard?.name || '未命名').trim().slice(0, 30),
        characterCard: p.characterCard,
        worldBook: Array.isArray(p.worldBook) ? p.worldBook : [],
        promptModules: Array.isArray(p.promptModules) ? p.promptModules : [],
        createdAt: p.createdAt || new Date().toISOString()
      }));
    return this.store.write('config/character-presets.json', normalized);
  }

  async saveProviders(providers) {
    return this.store.write('config/providers.local.json', normalizeProviders(providers));
  }

  async savePromptModules(promptModules) {
    return this.store.write('config/prompt-modules.json', promptModules.map(normalizePromptModule));
  }

  async saveWorldBook(worldBook) {
    return this.store.write('config/world-book.json', worldBook.map(normalizeWorldBookEntry));
  }

  async saveCharacterCard(characterCard) {
    return this.store.write('config/character-card.json', normalizeCharacterCard(characterCard));
  }

  async savePersona(persona) {
    return this.store.write('config/persona.json', normalizePersona(persona));
  }

  async saveQuickReplies(quickReplies) {
    return this.store.write('config/quick-replies.json', normalizeQuickReplies(quickReplies));
  }

  async importCharacterCard({ characterCard, worldBook = [] }) {
    const currentWorldBook = await this.store.read('config/world-book.json', defaultWorldBook);
    const savedCharacterCard = await this.saveCharacterCard(characterCard);
    const importedEntries = worldBook.map(normalizeWorldBookEntry);
    const nextImportedEntries = dedupeWorldBookEntries(currentWorldBook, importedEntries);
    const nextWorldBook = await this.saveWorldBook([...currentWorldBook, ...nextImportedEntries]);
    return { characterCard: savedCharacterCard, worldBook: nextWorldBook, importedWorldBookCount: nextImportedEntries.length };
  }

  async importWorldBook(worldBook = []) {
    const currentWorldBook = await this.store.read('config/world-book.json', defaultWorldBook);
    const importedEntries = worldBook.map(normalizeWorldBookEntry);
    const nextImportedEntries = dedupeWorldBookEntries(currentWorldBook, importedEntries);
    const nextWorldBook = await this.saveWorldBook([...currentWorldBook, ...nextImportedEntries]);
    return { worldBook: nextWorldBook, importedWorldBookCount: nextImportedEntries.length };
  }
}

function normalizeProviders(value) {
  const source = isPlainObject(value) ? value : {};
  return {
    activeProviderId: String(source.activeProviderId || ''),
    taskProviders: {
      chat: String(source.taskProviders?.chat || ''),
      rewrite: String(source.taskProviders?.rewrite || ''),
      fact: String(source.taskProviders?.fact || ''),
      summary: String(source.taskProviders?.summary || '')
    },
    taskFallbackChains: normalizeTaskFallbackChains(source.taskFallbackChains),
    fallbackChain: Array.isArray(source.fallbackChain) ? source.fallbackChain.map((id) => String(id || '')).filter(Boolean) : [],
    providers: Array.isArray(source.providers) ? source.providers.map((provider) => ({
      id: String(provider.id || ''),
      kind: normalizeProviderKind(provider.kind),
      preset: String(provider.preset || ''),
      baseUrl: String(provider.baseUrl || ''),
      apiKey: String(provider.apiKey || ''),
      model: String(provider.model || ''),
      temperature: normalizeFiniteNumber(provider.temperature, 0.9),
      maxTokens: normalizePositiveFiniteNumber(provider.maxTokens, 2000),
      headers: isPlainObject(provider.headers) ? provider.headers : {}
    })) : []
  };
}

function normalizeTaskFallbackChains(value) {
  const source = isPlainObject(value) ? value : {};
  return Object.fromEntries(['chat', 'rewrite', 'fact', 'summary'].map((taskKey) => [
    taskKey,
    Array.isArray(source[taskKey])
      ? source[taskKey].map((id) => String(id || '')).filter(Boolean)
      : []
  ]));
}

function normalizeProviderKind(kind) {
  const value = String(kind || 'openai-compatible').toLowerCase();
  return ['openai-compatible', 'anthropic', 'gemini'].includes(value) ? value : 'openai-compatible';
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizePersona(value) {
  const persona = isPlainObject(value) ? value : {};
  return {
    name: String(persona.name || '').trim(),
    description: String(persona.description || '').trim(),
    background: String(persona.background || '').trim(),
    personality: String(persona.personality || '').trim(),
    enabled: persona.enabled === true
  };
}

function normalizeVectorMemory(value) {
  const source = isPlainObject(value) ? value : {};
  const topK = normalizeFiniteNumber(source.topK, 5);
  return {
    enabled: source.enabled === true,
    providerId: String(source.providerId || '').trim(),
    topK: Math.min(20, Math.max(1, topK))
  };
}

function normalizeMcpServer(server) {
  const id = String(server.id || '').trim();
  const name = String(server.name || id).trim().slice(0, 60);
  const transport = ['stdio', 'sse', 'http'].includes(String(server.transport || '')) ? server.transport : 'stdio';
  return {
    id,
    name,
    transport,
    command: String(server.command || '').trim(),
    args: Array.isArray(server.args) ? server.args.map(String) : [],
    env: isPlainObject(server.env) ? server.env : {},
    url: String(server.url || '').trim(),
    enabled: server.enabled !== false
  };
}

function normalizeQuickReplies(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => isPlainObject(item) && String(item.content || '').trim())
    .map((item) => ({
      label: String(item.label || item.content || '').trim().slice(0, 20),
      content: String(item.content || '').trim(),
      enabled: item.enabled !== false
    }));
}

function normalizeFiniteNumber(value, fallback) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}

function normalizePositiveFiniteNumber(value, fallback) {
  const number = normalizeFiniteNumber(value, fallback);
  return number > 0 ? number : fallback;
}

export function normalizePromptModule(module) {
  return {
    id: String(module.id || crypto.randomUUID()),
    title: String(module.title || '未命名模块'),
    enabled: Boolean(module.enabled),
    content: String(module.content || '')
  };
}

export function normalizeWorldBookEntry(entry) {
  return {
    id: String(entry.id || crypto.randomUUID()),
    type: String(entry.type || 'memory'),
    title: String(entry.title || '未命名条目'),
    keywords: Array.isArray(entry.keywords) ? entry.keywords.map(String) : [],
    secondaryKeywords: Array.isArray(entry.secondaryKeywords) ? entry.secondaryKeywords.map(String) : [],
    matchMode: String(entry.matchMode || 'keyword'),
    regex: Array.isArray(entry.regex) ? entry.regex.map(String) : [],
    logic: String(entry.logic || 'any'),
    content: String(entry.content || ''),
    priority: normalizeFiniteNumber(entry.priority, 50),
    depth: normalizeFiniteNumber(entry.depth, 4),
    insertionOrder: normalizeFiniteNumber(entry.insertionOrder ?? entry.insertion_order, 0),
    constant: entry.constant === true,
    caseSensitive: entry.caseSensitive === true,
    position: String(entry.position || 'after_character'),
    scope: String(entry.scope || 'prompt'),
    enabled: Boolean(entry.enabled),
    source: String(entry.source || 'manual'),
    extensions: isPlainObject(entry.extensions) ? entry.extensions : {},
    updatedAt: String(entry.updatedAt || new Date().toISOString())
  };
}

export function normalizeCharacterCard(card = {}) {
  return {
    name: String(card.name || '未命名主角'),
    role: String(card.role || '个人创作主角'),
    description: String(card.description || ''),
    personality: String(card.personality || ''),
    scenario: String(card.scenario || ''),
    firstMessage: String(card.firstMessage || ''),
    exampleDialog: Array.isArray(card.exampleDialog) ? card.exampleDialog.map(String) : [],
    creatorNotes: String(card.creatorNotes || ''),
    systemPrompt: String(card.systemPrompt || ''),
    postHistoryInstructions: String(card.postHistoryInstructions || ''),
    alternateGreetings: Array.isArray(card.alternateGreetings) ? card.alternateGreetings.map(String) : [],
    tags: Array.isArray(card.tags) ? card.tags.map(String) : [],
    creator: String(card.creator || ''),
    characterVersion: String(card.characterVersion || ''),
    sourceSpec: String(card.sourceSpec || ''),
    portrait: normalizeCharacterPortrait(card.portrait),
    extensions: isPlainObject(card.extensions) ? card.extensions : {},
    raw: isPlainObject(card.raw) ? card.raw : undefined,
    enabled: card.enabled !== false
  };
}

function normalizeCharacterPortrait(value) {
  if (!isPlainObject(value)) return undefined;
  const assetId = String(value.assetId || '').trim().toLowerCase();
  const url = String(value.url || '').trim();
  if (!/^[a-f0-9]{64}$/.test(assetId) || !/^\/api\/character-images\/[a-f0-9]{64}\.png$/.test(url)) {
    return undefined;
  }
  return {
    assetId,
    url,
    mimeType: 'image/png',
    width: Math.max(0, Math.trunc(normalizeFiniteNumber(value.width, 0))),
    height: Math.max(0, Math.trunc(normalizeFiniteNumber(value.height, 0))),
    source: String(value.source || 'embedded-character-card')
  };
}
