import { buildNarrativeMaintenanceAnchor } from './narrativeControl.js';

export function shouldSummarize({ unsummarizedTurnCount, promptTokenEstimate, maxPromptTokens }) {
  if (Number(unsummarizedTurnCount) >= 4) return true;
  if (Number(promptTokenEstimate) > Number(maxPromptTokens || 8000) * 0.85) return true;
  return false;
}

export function buildSummaryPrompt({ rollingSummary, messages, narrativeContext }) {
  const transcript = messages.map((message) => `${message.role}: ${message.content}`).join('\n');
  const narrativeAnchor = buildNarrativeMaintenanceAnchor(narrativeContext);
  return [
    {
      role: 'system',
      content: [
        '你是长篇角色扮演的记忆整理器。请用中文更新滚动摘要，保留事实、关系、目标、承诺和未完成线索。不要添加原文没有确认的事实。',
        narrativeAnchor ? `\n【不可丢失的叙事锚点】\n${narrativeAnchor}` : '',
        '输出依次保留：题材锚点、当前主线、稳定事实、关系与承诺、从属支线、未完成线索。',
        '从属支线只记录其对主线、题材支柱、资源、关系或证据的回流，不得在摘要中擅自升级为新主线。'
      ].filter(Boolean).join('\n')
    },
    { role: 'user', content: `旧摘要：\n${rollingSummary || '无'}\n\n新增对话：\n${transcript}\n\n请输出新的滚动摘要。` }
  ];
}
