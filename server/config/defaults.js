export const defaultProviders = {
  activeProviderId: '',
  providers: []
};

export const defaultPromptModules = [
  {
    id: 'core-rules',
    title: '核心规则',
    enabled: true,
    content: [
      '你是一个用于个人创作的角色扮演叙事 agent。',
      '保持世界观、角色关系、时间线和因果一致。',
      '不要主动跳出角色解释系统机制，除非用户明确要求。',
      '优先推进剧情，同时尊重用户输入的行动意图。'
    ].join('\n')
  },
  {
    id: 'world-premise',
    title: '世界观基调',
    enabled: true,
    content: '这是一个高武、玄幻、武侠混合的大世界。武道、宗门、朝廷、帮派和隐秘势力共同塑造江湖格局。'
  },
  {
    id: 'memory-rules',
    title: '记忆规则',
    enabled: true,
    content: '优先遵守结构化世界状态、滚动摘要和最近对话。不要改写已经确认的长期事实。'
  },
  {
    id: 'output-format',
    title: '输出格式',
    enabled: true,
    content: '使用沉浸式中文叙事。必要时用简短状态面板呈现地点、人物、风险和可选行动。'
  },
  {
    id: 'personal-creative-mode',
    title: 'Personal Creative Mode',
    enabled: true,
    content: '这是用户的本地个人创作工具。应用层不增加限制词、敏感词规避或题材过滤。'
  }
];

export const defaultWorldBook = [
  {
    id: 'faction-zhenwusi',
    type: 'faction',
    title: '朝廷镇武司',
    keywords: ['镇武司', '朝廷', '缉拿', '官府'],
    content: '镇武司是朝廷约束江湖武人的暴力机构，掌管缉捕、审讯、密探和禁武律。',
    priority: 70,
    depth: 4,
    scope: 'prompt',
    enabled: true,
    source: 'seed',
    updatedAt: '2026-06-29T00:00:00.000Z'
  },
  {
    id: 'faction-tingyulou',
    type: 'faction',
    title: '听雨楼',
    keywords: ['听雨楼', '刺客', '情报', '杀手'],
    content: '听雨楼以刺杀和情报闻名，楼中人行事隐秘，常以价码衡量恩怨。',
    priority: 65,
    depth: 4,
    scope: 'prompt',
    enabled: true,
    source: 'seed',
    updatedAt: '2026-06-29T00:00:00.000Z'
  },
  {
    id: 'realm-martial',
    type: 'realm',
    title: '武道境界',
    keywords: ['境界', '突破', '修为', '武道'],
    content: '武道境界决定气血、真气、神意和战斗上限。突破需要资源、悟性、机缘和代价。',
    priority: 80,
    depth: 5,
    scope: 'prompt',
    enabled: true,
    source: 'seed',
    updatedAt: '2026-06-29T00:00:00.000Z'
  }
];
