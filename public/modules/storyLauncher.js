export const STORY_CATEGORY_LABELS = {
  all: '全部',
  xuanhuan: '玄幻',
  xianxia: '仙侠',
  lingyi: '灵异',
  mingmo: '历史',
  yingxiongzhi: '武侠群像',
  custom: '自定义'
};

const DEFAULT_VISUAL_PACK_IDS = new Set(['xuanhuan', 'xianxia', 'lingyi', 'mingmo', 'yingxiongzhi']);

export function getStoryPackVisualId(packOrId, packs = [], visualPackIds = DEFAULT_VISUAL_PACK_IDS) {
  const pack = typeof packOrId === 'object'
    ? packOrId
    : packs.find((item) => item.id === packOrId);
  const candidate = pack?.visualPackId || pack?.basePackId || pack?.id || String(packOrId || '');
  return visualPackIds.has(candidate) ? candidate : 'xuanhuan';
}

export function getStoryPackCategories(pack, options = {}) {
  const visualId = getStoryPackVisualId(pack, options.packs, options.visualPackIds);
  return Array.from(new Set([visualId, pack?.custom ? 'custom' : ''].filter(Boolean)));
}

export function filterStoryPacks(packs, { category = 'all', query = '', visualPackIds } = {}) {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  return (Array.isArray(packs) ? packs : []).filter((pack) => {
    const categories = getStoryPackCategories(pack, { packs, visualPackIds });
    if (category !== 'all' && !categories.includes(category)) return false;
    if (!normalizedQuery) return true;
    const haystack = [
      pack.title,
      pack.description,
      pack.characterName,
      pack.narrative?.label,
      pack.ruleSystem?.title,
      ...categories.map((item) => STORY_CATEGORY_LABELS[item]),
      ...(pack.inspirationRefs || [])
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

export function createStoryLauncherController({ render, open, close } = {}) {
  return {
    render: (...args) => render?.(...args),
    open: (...args) => open?.(...args),
    close: (...args) => close?.(...args)
  };
}
