export function createWorldBookEntryTemplate({ now = () => new Date() } = {}) {
  const current = now();
  const timestamp = current instanceof Date ? current : new Date(current);
  return {
    id: `manual-${timestamp.getTime()}`,
    type: 'memory',
    title: '新世界书条目',
    keywords: ['关键词'],
    secondaryKeywords: [],
    matchMode: 'keyword',
    regex: [],
    logic: 'any',
    content: '这里写设定、地点、势力、物品、伏笔或长期事实。',
    priority: 50,
    depth: 4,
    insertionOrder: 0,
    constant: false,
    caseSensitive: false,
    position: 'after_character',
    scope: 'prompt',
    enabled: true,
    source: 'manual',
    extensions: {},
    updatedAt: timestamp.toISOString()
  };
}

export function createCharacterCardTemplate() {
  return {
    name: '未命名主角',
    role: '身份/职业',
    description: '外貌、背景、能力、限制、长期目标。',
    personality: '性格、说话方式、价值观。',
    scenario: '当前处境、开局地点、正在面对的问题。',
    firstMessage: '',
    exampleDialog: [],
    creatorNotes: '',
    systemPrompt: '',
    postHistoryInstructions: '',
    alternateGreetings: [],
    tags: [],
    creator: '',
    characterVersion: '',
    extensions: {},
    enabled: true
  };
}
