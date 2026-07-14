const RESOURCE_ADAPTERS = [
  {
    id: 'character-card-v2',
    label: 'Character Card V2',
    kinds: ['character'],
    formats: ['png', 'json'],
    description: '兼容 SillyTavern 等客户端使用的 PNG 内嵌或 JSON 角色卡。'
  },
  {
    id: 'sillytavern-lorebook',
    label: 'SillyTavern 世界书',
    kinds: ['worldbook'],
    formats: ['json'],
    description: '保留关键词、正则、逻辑、优先级和插入深度。'
  },
  {
    id: 'text-yaml-resource',
    label: '文本 / YAML 素材',
    kinds: ['character', 'worldbook', 'prompt'],
    formats: ['txt', 'yaml', 'json'],
    description: '用于社区常见的纯文本、YAML 风格角色设定与世界书。'
  },
  {
    id: 'liunao-community-generic',
    label: '类脑社区通用适配',
    kinds: ['character', 'worldbook', 'prompt'],
    formats: ['png', 'json', 'txt', 'yaml'],
    description: '先归一化为内部格式；获得真实专有样本后可单独扩展解析器。'
  }
];

export function listResourceAdapters() {
  return structuredClone(RESOURCE_ADAPTERS);
}

export function resolveResourceAdapter({ preview, source = {} } = {}) {
  const requested = String(source.adapterId || '').trim();
  if (requested) {
    const adapter = RESOURCE_ADAPTERS.find((item) => item.id === requested);
    if (adapter) return structuredClone(adapter);
  }

  const site = `${source.site || ''} ${source.community || ''} ${source.url || ''}`.toLowerCase();
  if (site.includes('类脑') || site.includes('liunao')) {
    return structuredClone(RESOURCE_ADAPTERS.find((item) => item.id === 'liunao-community-generic'));
  }

  if (preview?.kind === 'character-card') {
    const sourceSpec = String(preview.importData?.characterCard?.sourceSpec || '').toLowerCase();
    if (sourceSpec.includes('chara_card_v2')) {
      return structuredClone(RESOURCE_ADAPTERS.find((item) => item.id === 'character-card-v2'));
    }
  }

  if (preview?.kind === 'world-book') {
    return structuredClone(RESOURCE_ADAPTERS.find((item) => item.id === 'sillytavern-lorebook'));
  }

  return structuredClone(RESOURCE_ADAPTERS.find((item) => item.id === 'text-yaml-resource'));
}
