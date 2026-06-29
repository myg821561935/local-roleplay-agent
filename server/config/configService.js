import { defaultPromptModules, defaultProviders, defaultWorldBook } from './defaults.js';

export class ConfigService {
  constructor(store) {
    this.store = store;
  }

  async getAll() {
    const providers = await this.store.read('config/providers.local.json', defaultProviders);
    const promptModules = await this.store.read('config/prompt-modules.json', defaultPromptModules);
    const worldBook = await this.store.read('config/world-book.json', defaultWorldBook);
    return { providers, promptModules, worldBook };
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
}

function normalizeProviders(value) {
  return {
    activeProviderId: String(value.activeProviderId || ''),
    providers: Array.isArray(value.providers) ? value.providers.map((provider) => ({
      id: String(provider.id || ''),
      kind: provider.kind === 'openai-compatible' ? provider.kind : 'openai-compatible',
      baseUrl: String(provider.baseUrl || ''),
      apiKey: String(provider.apiKey || ''),
      model: String(provider.model || ''),
      temperature: normalizeFiniteNumber(provider.temperature, 0.9),
      maxTokens: normalizePositiveFiniteNumber(provider.maxTokens, 2000),
      headers: isPlainObject(provider.headers) ? provider.headers : {}
    })) : []
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeFiniteNumber(value, fallback) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}

function normalizePositiveFiniteNumber(value, fallback) {
  const number = normalizeFiniteNumber(value, fallback);
  return number > 0 ? number : fallback;
}

function normalizePromptModule(module) {
  return {
    id: String(module.id || crypto.randomUUID()),
    title: String(module.title || '未命名模块'),
    enabled: Boolean(module.enabled),
    content: String(module.content || '')
  };
}

function normalizeWorldBookEntry(entry) {
  return {
    id: String(entry.id || crypto.randomUUID()),
    type: String(entry.type || 'memory'),
    title: String(entry.title || '未命名条目'),
    keywords: Array.isArray(entry.keywords) ? entry.keywords.map(String) : [],
    content: String(entry.content || ''),
    priority: Number(entry.priority ?? 50),
    depth: Number(entry.depth ?? 4),
    scope: String(entry.scope || 'prompt'),
    enabled: Boolean(entry.enabled),
    source: String(entry.source || 'manual'),
    updatedAt: String(entry.updatedAt || new Date().toISOString())
  };
}
