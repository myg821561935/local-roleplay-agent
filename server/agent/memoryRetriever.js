export function retrieveCards(args = {}) {
  const { query, maxCards = 5 } = args;
  const safeWorldBook = Array.isArray(args.worldBook) ? args.worldBook : [];
  const safeMemoryCards = Array.isArray(args.memoryCards) ? args.memoryCards : [];
  const candidates = [...safeWorldBook, ...safeMemoryCards]
    .filter((card) => card && card.enabled !== false && String(card.content || '').trim())
    .map((card) => ({ card, score: scoreCard(card, query) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || String(left.card.title).localeCompare(String(right.card.title)));

  return candidates.slice(0, maxCards).map((item) => item.card);
}

function scoreCard(card, query) {
  const text = String(query || '').toLowerCase();
  const keywords = Array.isArray(card.keywords) ? card.keywords : [];
  const hitCount = keywords.reduce((count, keyword) => {
    const normalized = String(keyword || '').toLowerCase();
    if (!normalized) return count;
    return text.includes(normalized) ? count + 1 : count;
  }, 0);
  if (!hitCount) return 0;
  const priority = Number(card.priority ?? 50);
  return hitCount * 100 + priority / 10;
}
