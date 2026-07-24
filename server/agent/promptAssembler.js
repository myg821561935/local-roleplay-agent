import { estimateTokens } from './token.js';
import { normalizeFactCards } from './factCards.js';
import { retrieveCards } from './memoryRetriever.js';
import { expandMacros } from './macroEngine.js';
import { buildNarrativeControlPrompt, resolveNarrativeContext } from './narrativeControl.js';
import { buildActionProtocolPrompt } from '../simulation/actionProtocol.js';
import { renderSimulationPrompt } from '../simulation/npcSimulation.js';
import { buildAgentProfilePrompt, normalizeAgentProfileId } from '../authoring/agentProfiles.js';
import { renderAuthoringLedgerPrompt } from '../authoring/authoringLedger.js';
import { buildMvuPatchPrompt } from '../compat/mvuProtocol.js';

export function assemblePrompt({
  promptModules,
  characterCard,
  worldBook,
  memory,
  authoring,
  messages,
  userMessage,
  persona,
  groupMembers,
  targetSpeaker,
  templates,
  customArrays,
  vectorHits,
  options = {}
}) {
  const safePromptModules = Array.isArray(promptModules) ? promptModules : [];
  const safeWorldBook = Array.isArray(worldBook) ? worldBook : [];
  const safeMessages = Array.isArray(messages) ? messages : [];
  const recentPairs = Number(options.recentPairs ?? 8);
  const maxInjectedCards = Number(options.maxInjectedCards ?? 15);
  const maxRecursionDepth = Number(options.maxRecursionDepth ?? 1);
  const memoryCards = normalizeFactCards(Array.isArray(memory?.memoryCards) ? memory.memoryCards : []);
  const query = [userMessage, ...safeMessages.filter((message) => !message.excluded).slice(-recentPairs * 2).map((message) => message.content)].join('\n');
  const injectedCards = retrieveCards({ query, worldBook: safeWorldBook, memoryCards, maxCards: maxInjectedCards, maxRecursionDepth });
  const renderedPromptModules = getRenderablePromptModules(safePromptModules);
  const narrativeContext = resolveNarrativeContext({ memory, mode: options.narrativeMode });
  const narrativeControlPrompt = buildNarrativeControlPrompt({ memory, mode: narrativeContext.mode });
  const simulationPrompt = renderSimulationPrompt(memory, { targetSpeaker });
  const actionProtocolPrompt = buildActionProtocolPrompt({ memory, targetSpeaker });
  const mvuPatchPrompt = buildMvuPatchPrompt({ memory });
  const agentProfileId = normalizeAgentProfileId(options.activeAgentProfileId);
  const agentProfilePrompt = buildAgentProfilePrompt(agentProfileId);
  const authoringLedgerPrompt = renderAuthoringLedgerPrompt(authoring);

  // 宏展开上下文
  const macroContext = {
    user: persona?.enabled ? (persona.name || '用户') : '用户',
    characterCard,
    persona,
    groupMembers,
    messages: safeMessages,
    userMessage,
    worldBook: safeWorldBook,
    templates,
    customArrays,
    lightFrontendState: memory?.lightFrontendState || {}
  };

  const cardsByDepth = new Map();
  injectedCards.forEach((card) => {
    let depth;
    if (card.constant === true && (card.depth ?? card.scanDepth ?? card.scan_depth) === undefined) {
      depth = 0;
    } else {
      depth = normalizeDepth(card.depth ?? card.scanDepth ?? card.scan_depth);
    }
    if (!cardsByDepth.has(depth)) cardsByDepth.set(depth, []);
    // 对世界书条目内容展开宏
    cardsByDepth.get(depth).push({ ...card, content: expandMacros(card.content, macroContext) });
  });

  const topCards = cardsByDepth.get(0) || [];
  cardsByDepth.delete(0);

  const topCardsText = topCards.length
    ? ['# 常驻世界书和记忆', ...topCards.map(c => `## ${c.title}\n${c.content}`)].join('\n\n')
    : '';

  // 对角色卡和提示词模块展开宏
  const expandedCharacterCard = expandCharacterCard(characterCard, macroContext);
  const expandedPersona = expandPersona(persona, macroContext);
  const expandedGroupMembers = expandGroupMembers(groupMembers, macroContext);
  const expandedPromptModules = renderedPromptModules.map((m) => ({ ...m, content: expandMacros(m.content, macroContext) }));
  const promptPlacement = organizePromptModules(expandedPromptModules);

  const systemSections = [
    narrativeControlPrompt,
    agentProfilePrompt,
    authoringLedgerPrompt,
    renderCharacterCard(expandedCharacterCard),
    renderGroupMembers(expandedGroupMembers),
    renderPersona(expandedPersona),
    renderCharacterPerformanceContract(expandedCharacterCard, expandedGroupMembers),
    renderPromptModules(promptPlacement.systemModules),
    renderWorldState(memory?.worldState),
    simulationPrompt,
    renderRollingSummary(memory?.rollingSummary),
    topCardsText,
    renderVectorMemory(vectorHits),
    renderSpeakerInstruction({ groupMembers, targetSpeaker, characterCard }),
    renderRecommendationInstruction(),
    renderRoleplayPresentationContract(),
    actionProtocolPrompt,
    mvuPatchPrompt
  ].filter(Boolean);

  const recentMessages = safeMessages
    .filter((message) => !message.excluded)
    .slice(-recentPairs * 2)
    .map((message) => ({
      role: message.role,
      content: message.speaker ? `[${message.speaker}] ${String(message.content || '')}` : String(message.content || '')
    }));

  // 对最新用户消息展开宏
  const expandedUserMessage = expandMacros(String(userMessage || ''), macroContext);
  const historyWithUser = [...recentMessages, { role: 'user', content: expandedUserMessage }];
  const totalHistory = historyWithUser.length;

  const injections = [];
  let injectionSequence = 0;
  for (const [depth, cards] of cardsByDepth.entries()) {
    const text = [`# 触发的世界书与记忆 (Depth ${depth})`, ...cards.map(c => `## ${c.title}\n${c.content}`)].join('\n\n');
    let insertIndex = totalHistory - depth;
    if (insertIndex < 0) insertIndex = 0;
    insertIndex = Math.min(insertIndex, Math.max(0, totalHistory - 1));
    injections.push({
      index: insertIndex,
      order: 0,
      sequence: injectionSequence++,
      message: { role: 'system', content: text }
    });
  }

  promptPlacement.inChatModules.forEach((module) => {
    const depth = normalizeDepth(module.depth);
    let insertIndex = totalHistory - depth;
    if (insertIndex < 0) insertIndex = 0;
    insertIndex = Math.min(insertIndex, Math.max(0, totalHistory - 1));
    injections.push({
      index: insertIndex,
      order: normalizePromptOrder(module.order),
      sequence: injectionSequence++,
      message: {
        role: normalizePromptRole(module.role),
        content: String(module.content || '').trim()
      }
    });
  });

  injections.sort((a, b) => (
    a.index - b.index
    || a.order - b.order
    || a.sequence - b.sequence
  ));

  const interleavedHistory = [];
  let currentHistoryIndex = 0;

  for (const injection of injections) {
    while (currentHistoryIndex < injection.index) {
      interleavedHistory.push(historyWithUser[currentHistoryIndex]);
      currentHistoryIndex++;
    }
    interleavedHistory.push(injection.message);
  }

  while (currentHistoryIndex < totalHistory) {
    interleavedHistory.push(historyWithUser[currentHistoryIndex]);
    currentHistoryIndex++;
  }

  const finalUserMessage = interleavedHistory.pop();

  const assembledMessages = [
    { role: 'system', content: systemSections.join('\n\n') },
    ...promptPlacement.relativeMessages.map((module) => ({
      role: normalizePromptRole(module.role),
      content: String(module.content || '').trim()
    })),
    ...interleavedHistory
  ];

  if (expandedCharacterCard && expandedCharacterCard.enabled !== false && expandedCharacterCard.postHistoryInstructions) {
    assembledMessages.push({ role: 'system', content: expandMacros(expandedCharacterCard.postHistoryInstructions, macroContext) });
  }

  const characterSourcePriority = renderCharacterSourcePriorityAnchor(expandedCharacterCard);
  if (characterSourcePriority) {
    assembledMessages.push({ role: 'system', content: characterSourcePriority });
  }

  const authorNote = expandMacros(String(options.authorNote || '').trim(), macroContext);
  if (authorNote) {
    assembledMessages.push({ role: 'system', content: `# 作者注释\n${authorNote}` });
  }

  if (finalUserMessage) {
    assembledMessages.push(finalUserMessage);
  }

  const tokenEstimate = estimateTokens(assembledMessages.map((message) => `${message.role}: ${message.content}`).join('\n'));
  return {
    messages: assembledMessages,
    tokenEstimate,
    injectedCards,
    sections: {
      promptModules: renderedPromptModules.map((module) => module.id),
      promptPlacement: {
        system: promptPlacement.systemModules.map((module) => module.id),
        relative: promptPlacement.relativeMessages.map((module) => module.id),
        inChat: promptPlacement.inChatModules.map((module) => module.id)
      },
      hasCharacterCard: Boolean(characterCard?.enabled !== false && String(characterCard?.name || '').trim()),
      hasCharacterSourcePriority: Boolean(characterSourcePriority),
      hasWorldState: Boolean(memory?.worldState),
      hasRollingSummary: Boolean(memory?.rollingSummary),
      narrativeMode: narrativeContext.mode,
      narrativeGenre: narrativeContext.genre,
      narrativeArc: narrativeContext.activeArc,
      agentProfileId,
      hasAuthoringLedger: Boolean(authoringLedgerPrompt),
      simulationRevision: Number(memory?.simulation?.revision || 0),
      simulationActorCount: Array.isArray(memory?.simulation?.actors) ? memory.simulation.actors.length : 0,
      injectedCardIds: injectedCards.map((card) => card.id)
    }
  };
}

function expandCharacterCard(card, ctx) {
  if (!card) return card;
  const fields = [
    'name',
    'role',
    'description',
    'personality',
    'scenario',
    'firstMessage',
    'systemPrompt',
    'postHistoryInstructions',
    'speechStyle',
    'knowledge',
    'goals',
    'relationships'
  ];
  const expanded = { ...card };
  fields.forEach((f) => {
    if (typeof expanded[f] === 'string') expanded[f] = expandMacros(expanded[f], ctx);
  });
  if (Array.isArray(expanded.alternateGreetings)) {
    expanded.alternateGreetings = expanded.alternateGreetings.map((g) => expandMacros(String(g || ''), ctx));
  }
  if (Array.isArray(expanded.exampleDialog)) {
    expanded.exampleDialog = expanded.exampleDialog.map((d) => expandMacros(String(d || ''), ctx));
  }
  if (expanded.extensions && typeof expanded.extensions === 'object') {
    expanded.extensions = Object.fromEntries(Object.entries(expanded.extensions).map(([key, value]) => [
      key,
      typeof value === 'string' ? expandMacros(value, ctx) : value
    ]));
  }
  return expanded;
}

function expandPersona(persona, ctx) {
  if (!persona) return persona;
  const fields = ['name', 'description', 'background', 'personality'];
  const expanded = { ...persona };
  fields.forEach((f) => {
    if (typeof expanded[f] === 'string') expanded[f] = expandMacros(expanded[f], ctx);
  });
  return expanded;
}

function expandGroupMembers(groupMembers, ctx) {
  if (!Array.isArray(groupMembers)) return groupMembers;
  const fields = ['name', 'role', 'description', 'personality', 'systemPrompt', 'speechStyle', 'knowledge', 'goals', 'relationships'];
  return groupMembers.map((m) => {
    if (!m) return m;
    const expanded = { ...m };
    fields.forEach((f) => {
      if (typeof expanded[f] === 'string') expanded[f] = expandMacros(expanded[f], ctx);
    });
    if (Array.isArray(expanded.exampleDialog)) {
      expanded.exampleDialog = expanded.exampleDialog.map((dialog) => expandMacros(String(dialog || ''), ctx));
    }
    return expanded;
  });
}

function renderCharacterCard(card) {
  if (!card || card.enabled === false) return '';
  const lines = [
    '# 角色卡',
    `姓名：${card.name || '未命名主角'}`,
    `身份：${card.role || ''}`,
    `描述：${card.description || ''}`,
    `性格：${card.personality || ''}`,
    `当前情境：${card.scenario || ''}`
  ];
  if (card.firstMessage) lines.push(`开场语：${card.firstMessage}`);
  if (card.systemPrompt) lines.push(`角色系统提示：${card.systemPrompt}`);
  if (Array.isArray(card.alternateGreetings) && card.alternateGreetings.length) {
    lines.push(`备用开场：\n${card.alternateGreetings.join('\n')}`);
  }
  if (Array.isArray(card.exampleDialog) && card.exampleDialog.length) {
    lines.push(`示例对话：\n${card.exampleDialog.join('\n')}`);
  }
  const speechStyle = firstProfileValue(card.speechStyle, card.extensions?.speech, card.extensions?.speechStyle, card.extensions?.speech_style);
  if (speechStyle) lines.push(`语言风格：${speechStyle}`);
  const goals = firstProfileValue(card.goals, card.extensions?.goals);
  if (goals) lines.push(`当前目标：${goals}`);
  const knowledge = firstProfileValue(card.knowledge, card.extensions?.knowledge, card.extensions?.knownInformation);
  if (knowledge) lines.push(`已知与盲区：${knowledge}`);
  const relationships = firstProfileValue(card.relationships, card.extensions?.relationships);
  if (relationships) lines.push(`关系边界：${relationships}`);
  if (Array.isArray(card.tags) && card.tags.length) lines.push(`标签：${card.tags.join('、')}`);
  return lines.filter((line) => !line.endsWith('：')).join('\n');
}

function renderPersona(persona) {
  if (!persona || persona.enabled !== true) return '';
  const lines = ['# 用户人设'];
  if (persona.name) lines.push(`姓名：${persona.name}`);
  if (persona.description) lines.push(`描述：${persona.description}`);
  if (persona.background) lines.push(`背景：${persona.background}`);
  if (persona.personality) lines.push(`性格：${persona.personality}`);
  return lines.length > 1 ? lines.join('\n') : '';
}

function renderGroupMembers(groupMembers) {
  const members = Array.isArray(groupMembers) ? groupMembers.filter((m) => m && m.enabled !== false && String(m.name || '').trim()) : [];
  if (!members.length) return '';
  const lines = ['# 群聊参与角色'];
  members.forEach((m, idx) => {
    const segments = [`## ${m.name}`];
    if (m.role) segments.push(`身份：${m.role}`);
    if (m.description) segments.push(`描述：${m.description}`);
    if (m.personality) segments.push(`性格：${m.personality}`);
    const speechStyle = firstProfileValue(m.speechStyle, m.extensions?.speech, m.extensions?.speechStyle);
    if (speechStyle) segments.push(`语言风格：${speechStyle}`);
    if (Array.isArray(m.exampleDialog) && m.exampleDialog.length) segments.push(`示例对话：\n${m.exampleDialog.join('\n')}`);
    const knowledge = firstProfileValue(m.knowledge, m.extensions?.knowledge);
    if (knowledge) segments.push(`已知与盲区：${knowledge}`);
    const goals = firstProfileValue(m.goals, m.extensions?.goals);
    if (goals) segments.push(`当前目标：${goals}`);
    const relationships = firstProfileValue(m.relationships, m.relationship, m.extensions?.relationships);
    if (relationships) segments.push(`关系边界：${relationships}`);
    if (m.systemPrompt) segments.push(`专属指令：${m.systemPrompt}`);
    lines.push(segments.join('\n'));
  });
  lines.push('对话可由任一参与角色发起，回复正文开头请用「【角色名】」标注当前发言者。');
  return lines.join('\n\n');
}

function renderCharacterPerformanceContract(characterCard, groupMembers) {
  const namedCharacters = [
    characterCard?.enabled === false ? '' : characterCard?.name,
    ...(Array.isArray(groupMembers) ? groupMembers.filter((member) => member?.enabled !== false).map((member) => member?.name) : [])
  ].filter(Boolean);
  if (!namedCharacters.length) return '';
  return [
    '# 角色演绎契约',
    `本轮可用角色：${namedCharacters.join('、')}。`,
    '角色发言必须同时受身份、性格、当前目标、关系阶段与已知信息约束；不能为了推进剧情而让所有人物使用同一种口吻。',
    '优先从“语言风格”和“示例对话”提取句长、称谓、语气、回避方式与情绪表达。只模仿风格特征，不逐句复述示例。',
    '角色只能依据其亲历、被告知或合理推断的信息行动；不知道的秘密应表现为误判、试探、追问或沉默，不得获得全知视角。',
    '旁白负责环境、动作和可观察反应；角色对白使用其自身措辞。不要解释提示词、扮演规则或以“AI助手”的口吻总结人物。',
    '关系变化必须由本轮具体事件触发，并与此前关系阶段连续，禁止无缘由地骤然亲密、忠诚或敌对。'
  ].join('\n');
}

function renderCharacterSourcePriorityAnchor(characterCard) {
  if (!isImportedCharacterCard(characterCard)) return '';
  return [
    '# 本轮导入角色卡优先级',
    `当前导入角色卡为「${characterCard.name || '未命名角色'}」。角色卡及其同批导入的 Character Book / 世界书，是人物身份、NPC 性格、关系、地点、故事前提、对白方式和行文风格的首要依据。`,
    '内容包只提供通用题材规则、力量体系与格式兜底，不得用内容包自带的专属人物、地点、开局事件或固定主线替换导入卡设定。',
    '若两者冲突，人物、关系、地点、开场与叙事风格以导入角色卡和同批世界书为准；不要继续与当前导入卡无关的基线剧情。',
    '保持已经在本会话中明确发生的事实连续，但不要仅因旧内容包存在而新增其专属名词或剧情。'
  ].join('\n');
}

function isImportedCharacterCard(characterCard) {
  if (!characterCard || characterCard.enabled === false) return false;
  const extensions = characterCard.extensions && typeof characterCard.extensions === 'object'
    ? characterCard.extensions
    : {};
  return Boolean(
    characterCard.sourceSpec
    || characterCard.raw
    || extensions.tavern_helper
    || extensions.regex_scripts
    || extensions.world
    || extensions.chub
  );
}

function firstProfileValue(...values) {
  for (const value of values) {
    if (Array.isArray(value) && value.length) return value.map((item) => String(item || '').trim()).filter(Boolean).join('、');
    if (value && typeof value === 'object') {
      const rendered = Object.entries(value)
        .map(([key, item]) => `${key}：${Array.isArray(item) ? item.join('、') : String(item || '').trim()}`)
        .filter((item) => !item.endsWith('：'))
        .join('；');
      if (rendered) return rendered;
    }
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function renderSpeakerInstruction({ groupMembers, targetSpeaker, characterCard }) {
  const members = Array.isArray(groupMembers) ? groupMembers.filter((m) => m && m.enabled !== false && String(m.name || '').trim()) : [];
  const hasGroup = members.length > 0;
  if (!hasGroup && !targetSpeaker) return '';
  if (targetSpeaker) {
    const isMember = members.some((m) => m.name === targetSpeaker);
    const isMain = characterCard && characterCard.name === targetSpeaker;
    if (!isMember && !isMain) return '';
    return `# 当前发言角色\n本轮请由「${targetSpeaker}」发言，回复正文以「【${targetSpeaker}】」开头，体现其身份、性格与语气。`;
  }
  return '# 发言规则\n可在每轮自然轮换发言者，回复正文以「【角色名】」开头标注当前发言者。';
}

function renderPromptModules(promptModules = []) {
  if (!promptModules.length) return '';
  return ['# Prompt 模块', ...promptModules.map((module) => `## ${module.title}\n${module.content}`)].join('\n\n');
}

function getRenderablePromptModules(promptModules = []) {
  return promptModules.filter((module) => module.enabled !== false && String(module.content || '').trim());
}

function organizePromptModules(promptModules = []) {
  const ordered = [...promptModules].sort(comparePromptModuleSequence);
  const systemModules = [];
  const relativeMessages = [];
  const inChatModules = [];

  ordered.forEach((module) => {
    if (module.position === 'in_chat') {
      inChatModules.push(module);
      return;
    }
    if (normalizePromptRole(module.role) !== 'system') {
      relativeMessages.push(module);
      return;
    }
    systemModules.push(module);
  });

  return { systemModules, relativeMessages, inChatModules };
}

function comparePromptModuleSequence(left, right) {
  const leftPreset = left?.extensions?.sillyTavernPreset;
  const rightPreset = right?.extensions?.sillyTavernPreset;
  const samePreset = leftPreset
    && rightPreset
    && leftPreset.presetTitle === rightPreset.presetTitle
    && leftPreset.sourceFormat === rightPreset.sourceFormat;
  if (!samePreset) return 0;
  return normalizePromptSequence(leftPreset.sequence ?? leftPreset.originalIndex)
    - normalizePromptSequence(rightPreset.sequence ?? rightPreset.originalIndex);
}

function normalizePromptRole(role) {
  const normalized = String(role || 'system').trim().toLowerCase();
  return ['system', 'user', 'assistant'].includes(normalized) ? normalized : 'system';
}

function normalizePromptOrder(order) {
  const number = Number(order);
  return Number.isFinite(number) ? number : 0;
}

function normalizePromptSequence(sequence) {
  const number = Number(sequence);
  return Number.isFinite(number) ? number : Number.MAX_SAFE_INTEGER;
}

function renderWorldState(worldState) {
  if (!worldState) return '';
  return `# 结构化世界状态\n${JSON.stringify(worldState, null, 2)}`;
}

function renderRollingSummary(summary) {
  if (!String(summary || '').trim()) return '';
  return `# 滚动摘要\n${summary}`;
}

function renderVectorMemory(hits) {
  const safeHits = Array.isArray(hits) ? hits.filter((h) => h && h.content && typeof h.content === 'string' && h.content.trim()) : [];
  if (!safeHits.length) return '';
  const lines = ['# 相关历史片段（向量检索）'];
  safeHits.forEach((hit, idx) => {
    const role = String(hit.role || 'user');
    lines.push(`## 片段 ${idx + 1} [${role}]\n${String(hit.content).trim()}`);
  });
  lines.push('以上为基于当前输入检索到的历史相关片段，可用于参考但不要直接复制。');
  return lines.join('\n\n');
}

function normalizeDepth(depth) {
  const number = Number(depth);
  if (!Number.isFinite(number) || number < 0) return 4;
  return Math.floor(number);
}

function renderRecommendationInstruction() {
  return [
    '# 推荐选项输出规则',
    '每次回复正文之后，额外给出 2-4 个用户下一步行动建议。',
    '建议必须适合作为用户下一轮输入，简短、可点击、不要包含解释。',
    '请用如下独立标签输出，标签之外仍是正常回复正文：',
    '<recommended_actions>',
    '["行动选项一", "行动选项二", "行动选项三"]',
    '</recommended_actions>'
  ].join('\n');
}

function renderRoleplayPresentationContract() {
  return [
    '# 沉浸式呈现契约',
    '用户可见正文放在 <plot> 标签中，按自然段组织场景、动作、感官与对白；不要把状态表、导演分析或 XML 标签写进正文。',
    '正文之后用 <normal_status> 记录时间、地点、在场人物和当前任务；用 <relationship_status> 只记录本轮实际发生变化的关系。',
    '用 <special_status> 分角色记录主角及本幕关键人物的当前档案。每个角色以『角色名状态』开头，按需包含：身份、外貌/穿着、性格、身体状况、境界/能力、物品、姿势、神情和当前目标。字段必须是“名称：内容”的单行格式，未知项写“未知”，不要编造。',
    '用 <NextCharacterPanel> 简短记录下一幕建议登场或退场的角色与原因。这些控制区不会显示在正文中，内容应简洁、可更新。',
    '不要输出内部推理过程。正文结尾必须留下用户可行动的局面，再按推荐选项协议给出 2-4 个互有差异的行动。'
  ].join('\n');
}
