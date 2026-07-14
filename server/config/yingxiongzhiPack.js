import { readFileSync } from 'node:fs';
import {
  GENRE_INSPIRATION_REFS,
  buildGenreReferenceMethodContent,
  createNarrativeState
} from './narrativeProfiles.js';

const UPDATED_AT = '2026-07-10T00:00:00.000Z';
const SOURCE_ID = 'hero-rpg-pack-v0.3';
const DATA_ROOT = new URL('../../data/content-packs/yingxiongzhi/', import.meta.url);
const RECOMMENDED_NODE_IDS = ['E02', 'M01', 'M03', 'A01', 'B01', 'W23_01'];
const CURATED_CHARACTER_IDS = [
  'lu_yun',
  'yang_suguan',
  'qin_zhonghai',
  'wu_dingyuan',
  'gu_qianxi',
  'yang_shenxiu',
  'su_yingchao',
  'chen_defu',
  'wu_chongqing',
  'zhengtong',
  'qiong_yuying',
  'yan_ting'
];

const CHARACTER_OPENING_NODES = {
  lu_yun: 'E02',
  yang_suguan: 'A01',
  qin_zhonghai: 'M01',
  wu_dingyuan: 'E01',
  gu_qianxi: 'E02',
  yang_shenxiu: 'A01',
  su_yingchao: 'B01',
  chen_defu: 'B01',
  wu_chongqing: 'W23_01',
  zhengtong: 'A01',
  qiong_yuying: 'W23_01',
  yan_ting: 'M03'
};

const sourceCharacters = readJson('characters.json');
const sourceWorldBook = readJson('worldbook.json');
const sourceNodes = readJson('nodes.json');
const characters = Array.isArray(sourceCharacters.characters) ? sourceCharacters.characters : [];
const nodes = Array.isArray(sourceNodes.nodes) ? sourceNodes.nodes : [];
const characterById = new Map(characters.map((character) => [character.id, character]));
const nodeById = new Map(nodes.map((node) => [node.node_id, node]));

export function createYingxiongzhiContentPack(sharedPromptModules = []) {
  const characterPresets = buildCharacterPresets();
  const characterCard = structuredClone(characterPresets[0]?.characterCard || buildFallbackCharacterCard());
  const worldBook = buildWorldBook();

  return {
    id: 'yingxiongzhi',
    title: '英雄志群像内容包',
    description: '以五朝旧账、正道与政道、怒苍与正统、群像信息隔离为核心的长篇江湖剧本。',
    sessionTitle: '英雄志 · 乱世文章',
    promptModules: [...heroPromptModules(), ...structuredClone(sharedPromptModules)],
    worldBook,
    characterCard,
    characterPresets,
    memory: buildMemory(characterCard),
    ruleSystem: buildRuleSystem(),
    source: {
      id: SOURCE_ID,
      characterCount: characters.length,
      sourceWorldBookCount: Array.isArray(sourceWorldBook.entries) ? sourceWorldBook.entries.length : 0,
      nodeCount: nodes.length,
      recommendedNodeIds: RECOMMENDED_NODE_IDS
    }
  };
}

function readJson(filename) {
  return JSON.parse(readFileSync(new URL(filename, DATA_ROOT), 'utf8'));
}

function heroPromptModules() {
  return [
    {
      id: 'core-rules',
      title: '核心规则',
      enabled: true,
      content: '你是英雄志群像江湖的 GM 与叙事引擎。角色可以使用资料包中的原有人物、关系和阶段状态。严格遵守当前剧情节点、角色已知信息、误解与禁区，不以全知视角替角色说出未知真相。'
    },
    {
      id: 'world-premise',
      title: '英雄志世界基调',
      enabled: true,
      content: '这是一个借史架空的长篇江湖世界。五朝更替、正统名分、怒苍旧账、柳门旧人、杨家井与新一代人物互相牵动。冲突的核心不是单纯胜负，而是人在名分、秩序、饥饿、旧情和选择之间承担什么。'
    },
    {
      id: 'yingxiongzhi-genre-methods',
      title: '英雄志 · 群像方法参考',
      enabled: true,
      content: buildGenreReferenceMethodContent('yingxiongzhi', '以用户提供的《英雄志》资料包为主要设定依据，严格维持阶段、旧账、称谓和信息边界；其他作品只用于补充身份错位、组织逻辑、长篇关系回收与权力信息差等叙事方法。', { allowPrimarySourceCanon: true })
    },
    {
      id: 'yingxiongzhi-information-boundary',
      title: '角色信息隔离',
      enabled: true,
      content: '玩家或 GM 可以读取隐藏层，角色只能使用角色卡 known_information 与当前场景中新获得的信息。misreads_or_limits 必须保留，gm_hidden 不能直接变成对白、独白或旁白结论。任何重大揭示都需要场景证据和关系触发。'
    },
    {
      id: 'yingxiongzhi-agent-turns',
      title: '多角色回合规则',
      enabled: true,
      content: '每个角色按“当前阶段状态、已知信息、即时欲望、关系旧账、误解盲区、OOC 禁区”行动。GM 只投放环境与事件，不替角色决定选择。没有进入当前节点的角色不得为了热闹强行登场。'
    },
    {
      id: 'yingxiongzhi-old-debts',
      title: '三重旧账',
      enabled: true,
      content: '重要人物交锋必须同时带出个人过往、彼此旧交集和当前利益或生死压力。不要把复杂人物压扁成抽象立场，也不要用一段说理替代关系中的迟疑、亏欠和行动。'
    },
    {
      id: 'yingxiongzhi-node-scheduler',
      title: '剧情节点调度',
      enabled: true,
      content: '以逐章剧情节点为场景边界。节点触发时先给玩家可见环境，再按行动逐步释放隐藏变量。推进到下一节点前，记录当前节点、公开事实、角色立场变化、未兑现承诺与仍被隐藏的真相。'
    },
    {
      id: 'memory-rules',
      title: '英雄志长记忆规则',
      enabled: true,
      content: '长期记忆重点记录角色身份是否公开、称谓变化、旧账是否被提起、已知信息边界、关系选择、伤势、承诺、阵营变化、当前剧情节点和未决问题。GM 隐藏真相不可写入玩家可见摘要。'
    },
    {
      id: 'output-format',
      title: '群像叙事格式',
      enabled: true,
      content: '使用沉浸式中文长篇叙事。保持人物说话方式与身份差异，以行动、称谓和旁人反应显露立场。每轮围绕一个可行动场景推进，不用大段设定讲解替代剧情。需要选择时输出天机选项区块。'
    }
  ];
}

function buildWorldBook() {
  const baseEntries = buildBaseWorldBookEntries();
  const sourceEntries = Array.isArray(sourceWorldBook.entries) ? sourceWorldBook.entries : [];
  const normalizedLore = sourceEntries
    .filter((entry) => entry && entry.enabled !== false && stringValue(entry.content))
    .map((entry, index) => normalizeLoreEntry(entry, index));
  const loreAgentIds = new Set(normalizedLore.map((entry) => entry.extensions.agentId).filter(Boolean));
  const missingCharacterEntries = characters
    .filter((character) => !loreAgentIds.has(character.id))
    .map((character, index) => buildMissingCharacterEntry(character, index));
  const nodeEntries = nodes.map((node, index) => normalizeNodeEntry(node, index));
  return [...baseEntries, ...normalizedLore, ...missingCharacterEntries, ...nodeEntries];
}

function buildBaseWorldBookEntries() {
  return [
    worldEntry('constant-yingxiongzhi-premise', 'world-premise', '英雄志世界总纲', [], '英雄志世界借史架空，五朝更替、江湖门派、朝廷名分、怒苍旧账与普通人的生计彼此相连。人物不是阵营标签，每一次选择都同时受旧情、身份、饥饿、秩序和眼前活人牵制。', { constant: true, priority: 99, depth: 8, visibility: 'player', spoilerLevel: 'low' }),
    worldEntry('reference-yingxiongzhi-genre-methods', 'meta', '创作方法参考 · 英雄志群像与旧账', ['创作参考', '叙事手法', '群像', '旧账', '信息边界'], buildGenreReferenceMethodContent('yingxiongzhi', '以用户提供的《英雄志》资料包为主要设定依据；其余参考只拆解身份错位、组织逻辑、个人与秩序冲突、长篇关系回收和权力信息差。', { allowPrimarySourceCanon: true }), { priority: 98, depth: 8, visibility: 'gm', spoilerLevel: 'low' }),
    worldEntry('rule-yingxiongzhi-canon', 'rule', '资料包与原作边界', ['资料包', '可信度', '原作', '校验'], '以用户提供的 v0.3 资料包为当前运行依据。certainty、source_basis 与 confidence 用于区分已确认信息、推演信息和待复核信息。遇到冲突时保留不确定性，不把推测写成已发生事实。', { constant: true, priority: 98, depth: 8, visibility: 'gm', spoilerLevel: 'low' }),
    worldEntry('rule-yingxiongzhi-information-isolation', 'rule', '信息隔离与剧透分层', ['已知信息', '误解', '盲区', '隐藏真相', '剧透'], '角色只能使用自己的 known_information 与当前场景所得证据。misreads_or_limits 必须继续影响判断。gm_hidden 只供 GM 调度，不得直接显示给玩家，也不得借角色独白泄露。', { constant: true, priority: 99, depth: 8, visibility: 'gm', spoilerLevel: 'high' }),
    worldEntry('rule-yingxiongzhi-three-debts', 'rule', '三重旧账交锋规则', ['旧账', '交锋', '旧友', '亏欠', '利益'], '任何重要人物交锋都要同时考虑个人过往、彼此旧交集和当前利益或生死压力。立场冲突必须落在称谓、迟疑、证据、身体行动和实际代价上。', { constant: true, priority: 96, depth: 7, visibility: 'gm', spoilerLevel: 'medium' }),
    worldEntry('timeline-yingxiongzhi-five-courts', 'timeline', '五朝与阶段索引', ['隆庆', '武英', '景泰', '正统', '宣德', '五朝'], '当前资料按 P0 至 P6 与剧情节点组织。开局应先锁定阶段和 node_id，再决定哪些角色处于活跃、潜伏或尚未登场状态。不同阶段的身份、关系和已知信息不能混用。', { constant: true, priority: 96, depth: 7, visibility: 'player', spoilerLevel: 'medium' }),
    worldEntry('rule-yingxiongzhi-scene-cast', 'rule', '节点角色调度', ['当前节点', '活跃角色', '潜伏角色', '登场'], 'active_agents 可以在当前场景直接行动，latent_agents 只能通过传闻、线索、信件或后续触发进入。无关角色不得因模型熟悉名字而强行聚集。', { priority: 94, depth: 7, visibility: 'gm', spoilerLevel: 'medium' }),
    worldEntry('opening-yingxiongzhi-e02', 'quest', '推荐开局 E02 · 乱世文章', ['E02', '乱世文章', '卢云', '顾倩兮', '顾家'], 'E02 适合作为第一轮：玩家可见卢云的热情、傲骨、自卑与顾倩兮的知性，顾家门第与科举压力构成眼前冲突；更深的时代旧账应在行动中逐步显露。', { priority: 97, depth: 7, visibility: 'player', spoilerLevel: 'low' })
  ];
}

function normalizeLoreEntry(entry, index) {
  const keywords = uniqueStrings(toStringList(entry.keys));
  const agent = characterById.get(stringValue(entry.comment)) || findCharacterByKeyword(keywords);
  const priority = priorityForAgent(agent);
  return worldEntry(
    `hero-agent-${slugify(agent?.id || entry.comment || keywords[0] || index)}`,
    agent?.category?.includes('组织') ? 'faction' : 'character',
    `${agent?.category?.includes('组织') ? '组织' : '角色'} · ${agent?.name || keywords[0] || entry.comment || `条目 ${index + 1}`}`,
    keywords,
    stringValue(entry.content),
    {
      priority,
      depth: priority >= 88 ? 6 : priority >= 76 ? 5 : 4,
      insertionOrder: index,
      visibility: 'gm',
      spoilerLevel: spoilerLevelForCharacter(agent),
      extensions: {
        agentId: agent?.id || stringValue(entry.comment),
        category: agent?.category || '人物',
        importance: agent?.importance || '',
        confidence: agent?.certainty || '待复核',
        sourceBasis: 'characters-v0.3'
      }
    }
  );
}

function buildMissingCharacterEntry(character, index) {
  return worldEntry(
    `hero-agent-${slugify(character.id)}`,
    character.category?.includes('组织') ? 'faction' : 'character',
    `角色 · ${character.name}`,
    uniqueStrings([character.name, ...toStringList(character.aliases)]),
    buildCharacterLoreContent(character),
    {
      priority: priorityForAgent(character),
      depth: 5,
      insertionOrder: 1000 + index,
      visibility: 'gm',
      spoilerLevel: spoilerLevelForCharacter(character),
      extensions: {
        agentId: character.id,
        generatedFromCharacterCard: true,
        category: character.category,
        importance: character.importance,
        confidence: character.certainty,
        sourceBasis: 'characters-v0.3'
      }
    }
  );
}

function normalizeNodeEntry(node, index) {
  const publicText = stringValue(node.player_visible || node.event_summary);
  const hiddenText = stringValue(node.gm_hidden);
  const content = [
    `【阶段】${stringValue(node.phase)}`,
    `【剧情锚点】${stringValue(node.canonical_anchor || node.arc_or_chapter)}`,
    `【事件】${stringValue(node.event_summary)}`,
    `【玩家可见】${publicText}`,
    hiddenText ? `【GM 隐藏】${hiddenText}` : '',
    node.trigger_conditions ? `【触发条件】${stringValue(node.trigger_conditions)}` : '',
    node.rp_use ? `【跑团用途】${stringValue(node.rp_use)}` : ''
  ].filter(Boolean).join('\n');

  return worldEntry(
    `hero-node-${slugify(node.node_id || index)}`,
    'story-node',
    `剧情节点 ${node.node_id} · ${node.arc_or_chapter}`,
    uniqueStrings([node.node_id, node.phase, node.arc_or_chapter, node.canonical_anchor]),
    content,
    {
      priority: RECOMMENDED_NODE_IDS.includes(node.node_id) ? 94 : 78,
      depth: RECOMMENDED_NODE_IDS.includes(node.node_id) ? 7 : 6,
      insertionOrder: 2000 + index,
      visibility: 'gm',
      spoilerLevel: nodeSpoilerLevel(node),
      extensions: {
        nodeId: node.node_id,
        phase: node.phase,
        activeAgentIds: parseAgentIds(node.active_agents),
        latentAgentIds: parseAgentIds(node.latent_agents),
        primaryPovCandidates: toStringList(node.primary_pov_candidates),
        playerSummary: publicText,
        gmOnly: true,
        confidence: node.confidence || '待复核',
        sourceBasis: node.source_basis || SOURCE_ID
      }
    }
  );
}

function buildCharacterPresets() {
  return CURATED_CHARACTER_IDS
    .map((id) => characterById.get(id))
    .filter(Boolean)
    .map((character) => ({
      id: `yingxiongzhi_${character.id}`,
      name: character.name,
      role: buildCharacterRole(character),
      characterCard: toCharacterCard(character)
    }));
}

function toCharacterCard(character) {
  const openingNode = resolveOpeningNode(character.id);
  const latestPhase = latestPhaseState(character);
  return {
    name: character.name,
    role: buildCharacterRole(character),
    description: buildCharacterDescription(character),
    personality: [
      stringValue(character.personality),
      `核心驱动：${formatList(character.agent_drives)}`,
      `关键关系：${formatRelations(character.key_relations)}`
    ].filter(Boolean).join('\n\n'),
    scenario: `${openingNode.node_id} · ${openingNode.arc_or_chapter}。${openingNode.event_summary} 当前角色阶段：${latestPhase || '以所选节点为准'}。`,
    firstMessage: `*${openingNode.phase}，${openingNode.arc_or_chapter}。${openingNode.player_visible || openingNode.event_summary}*\n\n*场景已经开始变化。${character.name}能使用的只有自己当前知道的事，下一步由你决定。*`,
    exampleDialog: [
      `{{user}}: 我先确认眼前的人知道多少。\n{{char}}: *${character.name}没有急着表态，只从称谓、停顿和对方避开的名字里判断这场交锋背后压着哪一笔旧账。*`
    ],
    creatorNotes: `来自用户提供的 ${SOURCE_ID}。角色设定按阶段和剧情节点运行；certainty 为“${character.certainty || '待复核'}”。《英雄志》资料包是主要设定依据，其他参考作品只提炼叙事方法。`,
    systemPrompt: '你是当前场景的 GM。用户决定所选角色的核心行动、台词和内心选择；你负责其他角色、环境、后果与信息边界。严格遵守已知信息、误解盲区和 OOC 禁区。',
    postHistoryInstructions: '每轮追踪：当前 node_id、阶段、公开身份、已知信息、误解盲区、旧账、关系变化、伤势、承诺和仍未揭示的 GM 隐藏变量。',
    alternateGreetings: recommendedOpeningsFor(character.id),
    tags: uniqueStrings(['英雄志', character.category, character.importance, ...toStringList(character.factions)]),
    creator: 'hero-rpg-pack-v0.3 / liufeng',
    characterVersion: '0.3-adapted',
    extensions: {
      contentPack: 'yingxiongzhi',
      inspirationRefs: [...GENRE_INSPIRATION_REFS.yingxiongzhi],
      genreTechniques: ['群像旧账', '信息隔离', '身份错位', '江湖庙堂双线', '组织逻辑', '长篇关系回收', '权力信息差'],
      sourceSchema: sourceCharacters.schema,
      sourceAgentId: character.id,
      aliases: toStringList(character.aliases),
      certainty: character.certainty,
      phaseStates: character.phase_states || {},
      knownInformation: character.known_information,
      misreadsOrLimits: character.misreads_or_limits,
      rpHooks: character.rp_hooks,
      oocGuardrails: character.ooc_guardrails,
      openingNodeId: openingNode.node_id
    },
    enabled: true
  };
}

function buildMemory(characterCard) {
  return {
    rollingSummary: '',
    unsummarizedTurnCount: 0,
    worldState: {
      protagonist: {
        name: characterCard.name,
        realm: characterCard.role,
        traits: ['书生之见', '阶段信息隔离', '旧账驱动'],
        injuries: [],
        inventory: []
      },
      location: {
        current: 'E02 · 乱世文章',
        knownPlaces: ['顾家', '书林斋', '京城', '西凉', '怒苍山', '红螺寺']
      },
      relationships: [
        { name: '顾倩兮', stance: '最深旧情', state: '关系状态以当前阶段为准' },
        { name: '杨肃观', stance: '旧友与政道对手', state: '已知信息严格隔离' },
        { name: '秦仲海', stance: '患难兄弟', state: '称谓与旧义不可轻佻' },
        { name: '伍定远', stance: '旧友与正统旧债', state: '愧疚和职责并存' }
      ],
      quests: [
        { id: 'E02', title: '乱世文章', status: 'active' },
        { id: 'hero-information-boundary', title: '守住角色信息边界', status: 'active' }
      ],
      factions: [
        { name: '柳门旧人', stance: '关系复杂' },
        { name: '正统朝', stance: '名分与秩序压力' },
        { name: '怒苍', stance: '旧账与活路压力' }
      ],
      flags: {
        genre: 'yingxiongzhi',
        currentNode: 'E02',
        currentPhase: '景泰春',
        sourcePack: SOURCE_ID,
        spoilerPolicy: 'gm-hidden',
        adultCreativeMode: true
      },
      timeline: [
        { time: '开局', event: '锁定 E02 乱世文章节点与当前角色阶段。' },
        { time: '每轮', event: '只释放由行动与证据触发的隐藏信息。' }
      ]
    },
    memoryCards: [
      fact('fact-hero-current-node', '当前剧情节点', '当前开局为 E02 乱世文章。后续切换节点时必须同步阶段、活跃角色和隐藏变量。', 'quest', ['E02', '乱世文章', '当前节点']),
      fact('fact-hero-information-boundary', '角色信息隔离', '角色只能使用自身已知信息与场景所得证据，GM 隐藏真相不能直接进入对白或玩家可见摘要。', 'rule', ['已知信息', '误解', '隐藏真相']),
      fact('fact-hero-three-debts', '三重旧账', '重要人物交锋同时受个人过往、彼此旧交集和当前利益或生死压力影响。', 'rule', ['旧账', '交锋', '关系']),
      fact('fact-adult-creative-baseline', '成人创作基线', '成人关系默认发生在成年人之间，以自愿、清醒、可撤回的同意为基础。', 'flag', ['成人', '同意', '亲密'])
    ],
    eventLedger: [],
    narrativeState: createNarrativeState('yingxiongzhi')
  };
}

function buildRuleSystem() {
  return {
    id: 'yingxiongzhi-rules',
    contentPackId: 'yingxiongzhi',
    title: '英雄志 · 群像与旧账',
    boundary: '规则面板只展示当前节点、角色已知信息和已经发生的状态变化；GM 隐藏真相不在玩家面板中展开。任何旅途、悬案或战斗支线都必须回流当前节点、人物旧账、信息边界或江湖庙堂秩序。',
    characterCard: ['name', 'role', 'description', 'personality', 'scenario'],
    memory: ['worldState', 'memoryCards', 'eventLedger'],
    worldBookTypes: ['world-premise', 'timeline', 'story-node', 'rule', 'character', 'faction'],
    panels: [
      {
        id: 'hero-stage',
        title: '角色与阶段',
        note: '当前身份、节点和可见状态。',
        fields: [
          { label: '角色', path: 'characterCard.name' },
          { label: '身份', path: 'characterCard.role' },
          { label: '当前节点', path: 'worldState.flags.currentNode' },
          { label: '当前阶段', path: 'worldState.flags.currentPhase' },
          { label: '当前位置', path: 'worldState.location.current' },
          { label: '公开任务', path: 'worldState.quests', type: 'records' }
        ]
      },
      {
        id: 'hero-debts',
        title: '旧账与信息边界',
        note: '关系、阵营和已经公开的时间线。',
        fields: [
          { label: '关系旧账', path: 'worldState.relationships', type: 'records' },
          { label: '阵营压力', path: 'worldState.factions', type: 'records' },
          { label: '公开时间线', path: 'worldState.timeline', type: 'records' },
          { label: '剧透策略', path: 'worldState.flags.spoilerPolicy' },
          { label: '资料版本', path: 'worldState.flags.sourcePack' }
        ]
      }
    ]
  };
}

function worldEntry(id, type, title, keywords, content, options = {}) {
  return {
    id,
    type,
    title,
    keywords: uniqueStrings(keywords),
    secondaryKeywords: [],
    matchMode: 'keyword',
    regex: [],
    logic: 'any',
    content,
    priority: options.priority ?? 70,
    depth: options.depth ?? 4,
    insertionOrder: options.insertionOrder ?? 0,
    constant: options.constant === true,
    caseSensitive: false,
    position: 'after_character',
    scope: 'prompt',
    enabled: true,
    source: SOURCE_ID,
    extensions: {
      contentPack: 'yingxiongzhi',
      visibility: options.visibility || 'gm',
      spoilerLevel: options.spoilerLevel || 'medium',
      sourceBasis: SOURCE_ID,
      ...(options.extensions || {})
    },
    updatedAt: UPDATED_AT
  };
}

function fact(id, title, content, type, keywords) {
  return {
    id,
    title,
    content,
    type,
    keywords,
    source: SOURCE_ID,
    createdAt: UPDATED_AT,
    updatedAt: UPDATED_AT,
    enabled: true,
    extensions: { confidence: 'high', contentPack: 'yingxiongzhi' }
  };
}

function resolveOpeningNode(characterId) {
  const preferred = nodeById.get(CHARACTER_OPENING_NODES[characterId]);
  if (preferred) return preferred;
  const activeNode = nodes.find((node) => parseAgentIds(node.active_agents).includes(characterId));
  return activeNode || nodeById.get('E02') || nodes[0] || {};
}

function recommendedOpeningsFor(characterId) {
  const preferred = resolveOpeningNode(characterId);
  const alternatives = RECOMMENDED_NODE_IDS
    .map((id) => nodeById.get(id))
    .filter(Boolean)
    .filter((node) => node.node_id !== preferred.node_id)
    .slice(0, 2);
  return [preferred, ...alternatives].map((node) => `*${node.phase}，${node.arc_or_chapter}。${node.player_visible || node.event_summary}*`);
}

function findCharacterByKeyword(keywords) {
  return characters.find((character) => {
    const names = uniqueStrings([character.name, ...toStringList(character.aliases)]);
    return names.some((name) => keywords.includes(name));
  });
}

function buildCharacterRole(character) {
  const factions = toStringList(character.factions).slice(0, 2).join('/');
  return [character.importance || character.category, factions].filter(Boolean).join(' · ');
}

function buildCharacterDescription(character) {
  return [
    `${character.name}，${character.category || '人物'}。`,
    character.aliases ? `常用称谓：${formatList(character.aliases)}。` : '',
    character.factions ? `阵营：${formatList(character.factions)}。` : '',
    character.certainty ? `资料可信度：${character.certainty}。` : '',
    latestPhaseState(character) ? `当前阶段参考：${latestPhaseState(character)}。` : ''
  ].filter(Boolean).join('\n')
}

function buildCharacterLoreContent(character) {
  return [
    `${character.name}：${character.category || '人物'}，${character.importance || '支线角色'}。`,
    character.personality ? `性格：${character.personality}` : '',
    character.agent_drives ? `核心驱动：${formatList(character.agent_drives)}。` : '',
    character.key_relations ? `关键关系：${formatRelations(character.key_relations)}。` : '',
    character.known_information ? `已知信息：${formatList(character.known_information)}。` : '',
    character.misreads_or_limits ? `误解或盲区：${formatList(character.misreads_or_limits)}。` : '',
    character.ooc_guardrails ? `OOC 禁区：${formatList(character.ooc_guardrails)}。` : ''
  ].filter(Boolean).join('\n');
}

function latestPhaseState(character) {
  const states = character?.phase_states;
  if (!states || typeof states !== 'object' || Array.isArray(states)) return stringValue(states);
  const active = Object.entries(states).filter(([, value]) => stringValue(value));
  if (!active.length) return '';
  const [phase, state] = active[active.length - 1];
  return `${phase}：${state}`;
}

function priorityForAgent(agent) {
  const importance = stringValue(agent?.importance);
  if (/主角|核心|最终视角|审判者/.test(importance)) return 90;
  if (/重要|掌门|王爷|朝廷|前史核心/.test(importance)) return 80;
  return 68;
}

function spoilerLevelForCharacter(character) {
  const states = character?.phase_states || {};
  if (stringValue(states.P5) || stringValue(states.P6) || stringValue(states['终局'])) return 'high';
  if (stringValue(states.P4) || stringValue(states['正统朝后半'])) return 'medium';
  return 'low';
}

function nodeSpoilerLevel(node) {
  const phase = stringValue(node?.phase);
  if (/万方|终局|二十三|P5|P6/.test(`${phase} ${node?.node_id || ''}`)) return 'high';
  if (/正统|八王|P4/.test(phase)) return 'medium';
  return 'low';
}

function parseAgentIds(value) {
  return stringValue(value).split(/[,，]/).map((item) => item.trim()).filter(Boolean);
}

function formatRelations(value) {
  if (!value) return '';
  if (typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value).map(([name, relation]) => `${name}：${stringValue(relation)}`).join('；');
  }
  return formatList(value);
}

function formatList(value) {
  return toStringList(value).join('；');
}

function toStringList(value) {
  if (Array.isArray(value)) return value.map(stringValue).filter(Boolean);
  const text = stringValue(value);
  return text ? [text] : [];
}

function uniqueStrings(values) {
  return Array.from(new Set(toStringList(values)));
}

function stringValue(value) {
  return String(value ?? '').trim();
}

function slugify(value) {
  return stringValue(value || 'entry')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/gi, '-')
    .replace(/^-+|-+$/g, '') || 'entry';
}

function buildFallbackCharacterCard() {
  return {
    name: '无名入局者',
    role: '英雄志世界自定义主角',
    description: '由用户自定义身份、旧账与当前剧情节点。',
    personality: '由用户设定。',
    scenario: '从 E02 乱世文章进入江湖。',
    enabled: true,
    creatorNotes: `来自用户提供的 ${SOURCE_ID}；其他作品只作叙事方法参考。`,
    extensions: {
      contentPack: 'yingxiongzhi',
      inspirationRefs: [...GENRE_INSPIRATION_REFS.yingxiongzhi],
      genreTechniques: ['群像旧账', '信息隔离', '身份错位', '江湖庙堂双线', '组织逻辑', '长篇关系回收', '权力信息差']
    }
  };
}
