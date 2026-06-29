export function estimateTokens(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return 0;
  let estimate = 0;
  for (const char of text) {
    estimate += /[\u4e00-\u9fff]/.test(char) ? 1 : 0.35;
  }
  return Math.max(1, Math.ceil(estimate));
}
