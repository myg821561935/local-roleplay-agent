export function retrieveCards({ query, worldBook = [], memoryCards = [], maxCards = 5 }) {
  const candidates = [...worldBook, ...memoryCards]
    .filter((card) => card && card.enabled !== false && String(card.content || '').trim())
    .map((card) => ({ card, score: scoreCard(card, query) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || String(left.card.title).localeCompare(String(right.card.title)));

  return candidates.slice(0, maxCards).map((item) => item.card);
}

function scoreCard(card, query) {
  const text = String(query || '').toLowerCase();
  const keywords = Array.isArray(card.keywords) ? card.keywords : [];
  const hitScore = keywords.reduce((score, keyword) => {
    const normalized = String(keyword || '').toLowerCase();
    if (!normalized) return score;
    return text.includes(normalized) ? score + 100 : score;
  }, 0);
  const priority = Number(card.priority ?? 50);
  return hitScore + priority / 10;
}
