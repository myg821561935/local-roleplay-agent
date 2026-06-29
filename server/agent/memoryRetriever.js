export function retrieveCards(args = {}) {
  const { query, maxCards = 5 } = args;
  const safeWorldBook = Array.isArray(args.worldBook) ? args.worldBook : [];
  const safeMemoryCards = Array.isArray(args.memoryCards) ? args.memoryCards : [];
  const candidates = [...safeWorldBook, ...safeMemoryCards]
    .filter((card) => card && card.enabled !== false && String(card.content || '').trim())
    .map((card) => ({ card, score: scoreCard(card, query) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => (
      right.score - left.score
      || Number(left.card.insertionOrder ?? left.card.insertion_order ?? 0) - Number(right.card.insertionOrder ?? right.card.insertion_order ?? 0)
      || String(left.card.title).localeCompare(String(right.card.title))
    ));

  return candidates.slice(0, maxCards).map((item) => item.card);
}

function scoreCard(card, query) {
  if (card.constant === true) return 10000 + priorityScore(card);

  const primaryMatches = countMatches({
    query,
    terms: getPrimaryTerms(card),
    matchMode: card.matchMode,
    caseSensitive: card.caseSensitive
  });
  const secondaryMatches = countMatches({
    query,
    terms: getSecondaryTerms(card),
    matchMode: card.secondaryMatchMode || card.matchMode,
    caseSensitive: card.caseSensitive
  });
  const logic = String(card.logic || (card.selective ? 'selective' : 'any')).toLowerCase();

  if (logic === 'all' && primaryMatches.hitCount !== primaryMatches.total) return 0;
  if (logic === 'selective' && (!primaryMatches.hitCount || !secondaryMatches.hitCount)) return 0;
  if (logic !== 'selective' && !primaryMatches.hitCount) return 0;

  const hitCount = primaryMatches.hitCount + secondaryMatches.hitCount;
  if (!hitCount) return 0;
  return hitCount * 100 + priorityScore(card);
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

function regexMatches({ query, pattern, caseSensitive }) {
  try {
    return new RegExp(pattern, caseSensitive ? '' : 'i').test(String(query || ''));
  } catch {
    return false;
  }
}

function getPrimaryTerms(card) {
  if (String(card.matchMode || '').toLowerCase() === 'regex') {
    return normalizeArray(card.regex ?? card.regexes ?? card.patterns ?? card.keywords);
  }
  return normalizeArray(card.keywords);
}

function getSecondaryTerms(card) {
  return normalizeArray(card.secondaryKeywords ?? card.secondary_keys);
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
