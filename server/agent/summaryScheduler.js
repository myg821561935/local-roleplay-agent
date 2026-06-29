export function shouldSummarize({ unsummarizedTurnCount, promptTokenEstimate, maxPromptTokens }) {
  if (Number(unsummarizedTurnCount) >= 4) return true;
  if (Number(promptTokenEstimate) > Number(maxPromptTokens || 8000) * 0.85) return true;
  return false;
}

export function buildSummaryPrompt({ rollingSummary, messages }) {
  const transcript = messages.map((message) => `${message.role}: ${message.content}`).join('\n');
  return [
    { role: 'system', content: '你是长篇角色扮演的记忆整理器。请用中文更新滚动摘要，保留事实、关系、目标、承诺和未完成线索。不要添加原文没有确认的事实。' },
    { role: 'user', content: `旧摘要：\n${rollingSummary || '无'}\n\n新增对话：\n${transcript}\n\n请输出新的滚动摘要。` }
  ];
}
