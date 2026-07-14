export function retrieveCards(args = {}) {
  const { query, maxCards = 5, maxRecursionDepth = 1 } = args;
  const safeWorldBook = Array.isArray(args.worldBook) ? args.worldBook : [];
  const safeMemoryCards = Array.isArray(args.memoryCards) ? args.memoryCards : [];

  let availableCards = [...safeWorldBook, ...safeMemoryCards]
    .filter((card) => card && card.enabled !== false && String(card.content || '').trim());

  let currentQuery = String(query || '');
  const triggeredItems = [];

  for (let depth = 0; depth <= maxRecursionDepth; depth++) {
    const newlyTriggered = [];
    const remainingCards = [];

    for (const card of availableCards) {
      const score = scoreCard(card, currentQuery);
      if (score > 0) {
        newlyTriggered.push({ card, score });
      } else {
        remainingCards.push(card);
      }
    }

    if (newlyTriggered.length === 0) {
      break;
    }

    triggeredItems.push(...newlyTriggered);
    availableCards = remainingCards;

    const newContent = newlyTriggered.map(item => String(item.card.content || '')).join('\n');
    // 限制 currentQuery 长度，避免递归轮中扫描字符串呈 O(n²) 膨胀
    const appended = (currentQuery + '\n' + newContent).slice(-4000);
    currentQuery = appended;
  }

  triggeredItems.sort((left, right) => (
    right.score - left.score
    || Number(left.card.insertionOrder ?? left.card.insertion_order ?? 0) - Number(right.card.insertionOrder ?? right.card.insertion_order ?? 0)
    || String(left.card.title).localeCompare(String(right.card.title))
  ));

  return triggeredItems.slice(0, maxCards).map((item) => item.card);
}

/**
 * SillyTavern 兼容的世界书触发评分
 *
 * matchMode:
 *   - 'keyword'  : 主关键词命中即触发（受 logic 修饰）
 *   - 'regex'    : 仅看 regex 字段
 *   - 'selective': 需主关键词和次关键词同时命中
 *
 * logic（仅影响 keyword / selective 模式）:
 *   - 'any' / 'or'        : 任一主关键词命中即触发（默认）
 *   - 'all' / 'and'       : 所有主关键词都需命中
 *   - 'not' / 'not any'   : 任一命中则不触发，未命中才触发
 *   - 'not all'           : 全部命中才不触发，否则触发
 */
function scoreCard(card, query) {
  if (card.constant === true) return 10000 + priorityScore(card);

  const matchMode = String(card.matchMode || 'keyword').toLowerCase();
  const logicValue = String(card.logic || 'any').toLowerCase().trim();
  // 兼容：logic === 'selective' 等价于 matchMode='selective'
  const effectiveMatchMode = (matchMode === 'keyword' && logicValue === 'selective') ? 'selective' : matchMode;
  let triggered = false;
  let primaryHits = 0;
  let primaryTotal = 0;
  let secondaryHits = 0;
  let secondaryTotal = 0;

  if (effectiveMatchMode === 'regex') {
    const result = countMatches({
      query,
      terms: normalizeArray(card.regex ?? card.regexes ?? card.patterns),
      matchMode: 'regex',
      caseSensitive: card.caseSensitive
    });
    primaryHits = result.hitCount;
    primaryTotal = result.total;
    triggered = primaryHits > 0;
  } else {
    const primary = countMatches({
      query,
      terms: normalizeArray(card.keywords),
      matchMode: 'keyword',
      caseSensitive: card.caseSensitive
    });
    primaryHits = primary.hitCount;
    primaryTotal = primary.total;

    // 辅助：把 regex 字段作为额外主触发器（兼容已有数据）
    const regexAsPrimary = countMatches({
      query,
      terms: normalizeArray(card.regex ?? card.regexes ?? card.patterns),
      matchMode: 'regex',
      caseSensitive: card.caseSensitive
    });
    primaryHits += regexAsPrimary.hitCount;
    primaryTotal += regexAsPrimary.total;

    if (effectiveMatchMode === 'selective') {
      const secondary = countMatches({
        query,
        terms: normalizeArray(card.secondaryKeywords ?? card.secondary_keys),
        matchMode: String(card.secondaryMatchMode || 'keyword').toLowerCase(),
        caseSensitive: card.caseSensitive
      });
      secondaryHits = secondary.hitCount;
      secondaryTotal = secondary.total;
      triggered = primaryHits > 0 && secondaryHits > 0;
    } else {
      triggered = applyLogic({ logic: card.logic, hitCount: primaryHits, total: primaryTotal });
    }
  }

  if (!triggered) return 0;
  const hitCount = primaryHits + secondaryHits;
  return hitCount * 100 + priorityScore(card);
}

function applyLogic({ logic, hitCount, total }) {
  const value = String(logic || 'any').toLowerCase().trim();
  if (value === 'all' || value === 'and') return hitCount === total && total > 0;
  if (value === 'not' || value === 'not any' || value === 'notany') return hitCount === 0;
  if (value === 'not all' || value === 'notall') return hitCount !== total || total === 0;
  return hitCount > 0; // 'any' / 'or' / 默认
}

function countMatches({ query, terms, matchMode, caseSensitive }) {
  const safeTerms = terms.map((term) => String(term || '')).filter(Boolean);
  if (!safeTerms.length) return { hitCount: 0, total: 0 };

  const hitCount = safeTerms.reduce((count, term) => {
    const hit = String(matchMode || 'keyword').toLowerCase() === 'regex'
      ? regexMatches({ query, pattern: term, caseSensitive })
      : keywordMatches({ query, keyword: term, caseSensitive });
    return hit ? count + 1 : count;
  }, 0);

  return { hitCount, total: safeTerms.length };
}

function keywordMatches({ query, keyword, caseSensitive }) {
  const haystack = String(query || '');
  if (caseSensitive) return haystack.includes(keyword);
  return haystack.toLowerCase().includes(String(keyword).toLowerCase());
}

const regexCache = new Map();

function regexMatches({ query, pattern, caseSensitive }) {
  const cacheKey = `${pattern}|${caseSensitive ? '1' : '0'}`;
  let regex = regexCache.get(cacheKey);
  if (!regex) {
    try {
      regex = new RegExp(pattern, caseSensitive ? '' : 'i');
    } catch {
      regex = null;
    }
    regexCache.set(cacheKey, regex);
  }
  if (!regex) return false;
  return regex.test(String(query || ''));
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function priorityScore(card) {
  const priority = Number(card.priority ?? 50);
  return priority / 10;
}
