import { estimateTokens } from './token.js';
import { buildResponseContractPrompt, normalizeResponseLengthMode } from './responseContract.js';
import { normalizeFactCards } from './factCards.js';
import {
  activateWorldBookEntries,
  finalizeWorldBookActivation
} from './worldBookActivator.js';
import { expandMacros } from './macroEngine.js';
import { buildNarrativeControlPrompt, resolveNarrativeContext } from './narrativeControl.js';
import { buildRoleplayModePrompt, normalizeRoleplayMode } from './roleplayMode.js';
import { buildActionProtocolPrompt } from '../simulation/actionProtocol.js';
import { renderSimulationPrompt } from '../simulation/npcSimulation.js';
import { buildAgentProfilePrompt, normalizeAgentProfileId } from '../authoring/agentProfiles.js';
import { renderAuthoringLedgerPrompt } from '../authoring/authoringLedger.js';
import { buildMvuPatchPrompt } from '../compat/mvuProtocol.js';
import { applyPromptTransforms } from '../compat/lightFrontendRuntime.js';
import { applyConditionalDirectives } from '../compat/conditionalDirective.js';
import {
  budgetWorldBookEntries,
  compareWorldBookBudgetPriority,
  compilePlayableWorldBook
} from '../resources/playableResourceCompiler.js';
import {
  compactWorldStateForPrompt,
  compilePromptModulesForRuntime,
  enforcePromptMessageBudget,
  limitTextToTokenBudget,
  promptModuleRuntimePriority,
  selectRecentMessagesForPrompt
} from './promptBudget.js';

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
  memoryContext,
  lightFrontend,
  activationContext = {},
  options = {}
}) {
  const safePromptModules = Array.isArray(promptModules) ? promptModules : [];
  const sourceWorldBook = Array.isArray(worldBook) ? worldBook : [];
  const requestedPromptTokens = Number(options.maxPromptTokens);
  const maxPromptTokens = Number.isFinite(requestedPromptTokens) && requestedPromptTokens > 0
    ? Math.floor(requestedPromptTokens)
    : null;
  const playableWorldBook = compilePlayableWorldBook(sourceWorldBook);
  // 应用 @@if 条件指令：根据当前 MVU 状态过滤条件为假的世界书条目，剥离 @@if 前缀
  const conditionalResult = applyConditionalDirectives(playableWorldBook.entries, memory?.lightFrontendState || {});
  const safeWorldBook = conditionalResult.entries;
  const characterContentMode = resolveCharacterContentMode(characterCard, safeWorldBook);
  const safeMessages = Array.isArray(messages) ? messages : [];
  const recentPairs = Number(options.recentPairs ?? 8);
  const maxInjectedCards = Number(options.maxInjectedCards ?? 15);
  const maxRecursionDepth = Number(options.maxRecursionDepth ?? 1);
  const memoryCards = normalizeFactCards(Array.isArray(memory?.memoryCards) ? memory.memoryCards : []);
  const worldBookActivation = activateWorldBookEntries({
    worldBook: safeWorldBook,
    memoryCards,
    messages: safeMessages,
    userMessage,
    maxCards: maxInjectedCards,
    maxRecursionDepth,
    defaultScanDepth: Number(options.worldBookScanDepth ?? recentPairs * 2),
    minActivations: Number(options.worldBookMinActivations ?? 0),
    minActivationsDepthMax: Number(options.worldBookMinActivationsDepthMax ?? 0),
    includeNames: options.worldBookIncludeNames !== false,
    caseSensitive: options.worldBookCaseSensitive === true,
    matchWholeWords: options.worldBookMatchWholeWords === true,
    userName: persona?.enabled ? (persona.name || '用户') : '用户',
    characterName: characterCard?.name || 'assistant',
    generationType: activationContext.generationType,
    characterCard,
    persona,
    groupMembers,
    targetSpeaker,
    seed: activationContext.seed ?? options.worldBookActivationSeed ?? ''
  });
  const activeCards = worldBookActivation.entries;
  // 常驻条目按作者声明的优先级与插入顺序进入预算，不能让导入数组的偶然顺序
  // 抢占世界法则、世界观等更靠前的事实源。
  const constantCards = activeCards
    .filter((card) => card.constant === true)
    .sort(compareWorldBookBudgetPriority);
  const triggeredCards = activeCards.filter((card) => card.constant !== true);
  const requestedWorldBookTokens = Number(options.maxWorldBookTokens ?? 6000);
  const totalWorldBookCap = maxPromptTokens ? Math.max(600, Math.floor(maxPromptTokens * 0.3)) : null;
  const configuredWorldBookTokens = Number.isFinite(requestedWorldBookTokens) && requestedWorldBookTokens > 0
    ? Math.floor(requestedWorldBookTokens)
    : 6000;
  const maxWorldBookTokens = totalWorldBookCap
    ? Math.min(configuredWorldBookTokens, totalWorldBookCap)
    : configuredWorldBookTokens;
  const constantBudget = budgetWorldBookEntries(constantCards, {
    maxTokens: Math.max(1, Math.floor(maxWorldBookTokens * 0.4)),
    maxEntryTokens: Number(options.maxConstantWorldBookEntryTokens ?? Math.max(240, Math.floor(maxWorldBookTokens * 0.23)))
  });
  const triggeredBudget = budgetWorldBookEntries(triggeredCards, {
    maxTokens: Math.max(1, maxWorldBookTokens - constantBudget.report.usedTokens),
    maxEntryTokens: Number(options.maxWorldBookEntryTokens ?? Math.max(320, Math.floor(maxWorldBookTokens * 0.3)))
  });
  const worldBookAnchorKeys = new Set([
    ...triggeredBudget.entries,
    ...constantBudget.entries
  ].map(worldBookCardKey));
  // 本轮直接/递归触发的条目优先于常驻背景进入最终预算，避免角色条目被整组背景挤出。
  const injectedCards = [...triggeredBudget.entries, ...constantBudget.entries];
  const worldBookBudget = {
    maxTokens: maxWorldBookTokens,
    usedTokens: constantBudget.report.usedTokens + triggeredBudget.report.usedTokens,
    constant: constantBudget.report,
    triggered: triggeredBudget.report,
    playableCompilation: playableWorldBook.report
  };
  const renderablePromptModules = getRenderablePromptModules(safePromptModules)
    .sort(comparePromptModuleSequence);
  const hasCommunityPresetBundle = renderablePromptModules.some((module) => (
    Boolean(module?.extensions?.sillyTavernPreset?.presetTitle)
  ));
  const promptModuleBudget = maxPromptTokens
    ? Math.max(800, Math.floor(maxPromptTokens * 0.3))
    : null;
  const promptModuleCompilation = compilePromptModulesForRuntime(renderablePromptModules, {
    worldBook: safeWorldBook,
    maxTokens: promptModuleBudget,
    maxModules: hasCommunityPresetBundle
      ? Number(options.maxCommunityPromptModules ?? 18)
      : null
  });
  const renderedPromptModules = promptModuleCompilation.modules;
  const narrativeContext = resolveNarrativeContext({ memory, mode: options.narrativeMode });
  const narrativeControlPrompt = buildNarrativeControlPrompt({ memory, mode: narrativeContext.mode });
  const roleplayMode = normalizeRoleplayMode(options.roleplayMode);
  const roleplayModePrompt = buildRoleplayModePrompt(roleplayMode);
  const rawSimulationPrompt = renderSimulationPrompt(memory, { targetSpeaker });
  const simulationPrompt = maxPromptTokens
    ? limitTextToTokenBudget(rawSimulationPrompt, Math.max(480, Math.floor(maxPromptTokens * 0.14)))
    : rawSimulationPrompt;
  const actionProtocolPrompt = buildActionProtocolPrompt({ memory, targetSpeaker });
  const mvuPatchPrompt = buildMvuPatchPrompt({ memory });
  const agentProfileId = normalizeAgentProfileId(options.activeAgentProfileId);
  const agentProfilePrompt = buildAgentProfilePrompt(agentProfileId);
  const authoringLedgerPrompt = renderAuthoringLedgerPrompt(authoring);

  // 宏展开上下文
  const promptVariables = {};
  const promptVariableAudit = [];
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
    lightFrontendState: memory?.lightFrontendState || {},
    promptVariables
  };
  const regexContext = {
    user: macroContext.user,
    char: characterCard?.name || '',
    characterCard,
    persona,
    lightFrontendState: macroContext.lightFrontendState
  };
  const regexTransforms = Array.isArray(lightFrontend?.regexTransforms)
    ? lightFrontend.regexTransforms
    : [];

  // SillyTavern 预设中的 setvar/getvar 在本轮临时作用域内按顺序执行；不持久化、不执行脚本。
  const expandedPromptModules = [...renderedPromptModules]
    .sort(comparePromptModuleSequence)
    .map((module) => ({
      ...module,
      content: expandMacros(module.content, {
        ...macroContext,
        allowVariableWrites: true,
        promptVariableAudit
      })
    }))
    // setvar/trim/comment-only modules still participate in the ordered macro pass,
    // but after they have written their temporary values they must not become empty
    // provider messages or consume one of the final prompt placements.
    .filter((module) => String(module.content || '').trim());
  const promptPlacement = organizePromptModules(expandedPromptModules);

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

  // 对角色卡展开宏；可读取本轮预设已声明的临时变量。
  const expandedCharacterCard = expandCharacterCard(characterCard, macroContext);
  const expandedPersona = expandPersona(persona, macroContext);
  const expandedGroupMembers = expandGroupMembers(groupMembers, macroContext);
  const worldStateCompilation = compactWorldStateForPrompt(memory?.worldState, {
    maxTokens: maxPromptTokens ? Math.max(320, Math.floor(maxPromptTokens * 0.09)) : null
  });
  const rollingSummary = maxPromptTokens
    ? limitTextToTokenBudget(memory?.rollingSummary, Math.max(160, Math.floor(maxPromptTokens * 0.05)))
    : memory?.rollingSummary;

  const systemSections = [
    narrativeControlPrompt,
    roleplayModePrompt,
    agentProfilePrompt,
    authoringLedgerPrompt,
    limitTextToTokenBudget(
      renderCharacterCard(expandedCharacterCard, {
        includeOpening: safeMessages.length === 0,
        contentMode: characterContentMode
      }),
      maxPromptTokens ? Math.max(480, Math.floor(maxPromptTokens * 0.14)) : null
    ),
    renderGroupMembers(expandedGroupMembers),
    renderPersona(expandedPersona),
    renderCharacterPerformanceContract(expandedCharacterCard, expandedGroupMembers, {
      contentMode: characterContentMode,
      activeCards: injectedCards
    }),
    renderWorldState(worldStateCompilation.worldState),
    limitTextToTokenBudget(renderKnowledgeGraph(memory?.knowledgeGraph), maxPromptTokens ? 320 : null),
    renderRollingSummary(rollingSummary),
    limitTextToTokenBudget(renderEpisodicMemory(memoryContext), maxPromptTokens ? 480 : null),
    renderVectorMemory(vectorHits),
    simulationPrompt,
    renderSpeakerInstruction({ groupMembers, targetSpeaker, characterCard }),
    renderRecommendationInstruction(),
    renderRoleplayPresentationContract(),
    actionProtocolPrompt,
    mvuPatchPrompt
  ].filter(Boolean);

  const historyCompilation = selectRecentMessagesForPrompt(safeMessages, {
    maxMessages: recentPairs * 2,
    maxTokens: maxPromptTokens ? Math.max(640, Math.floor(maxPromptTokens * 0.18)) : null,
    minCompleteTurns: 2
  });
  const recentMessageSource = historyCompilation.messages;
  const recentMessages = recentMessageSource
    .map((message, index) => {
      const transformed = applyPromptTransforms(String(message.content || ''), regexTransforms, {
        role: normalizePromptRole(message.role),
        context: regexContext,
        depth: recentMessageSource.length - 1 - index
      });
      return {
        role: message.role,
        content: message.speaker ? `[${message.speaker}] ${transformed}` : transformed,
        _promptKind: message._promptProtected ? 'history-recent' : 'history'
      };
    });

  // 对最新用户消息展开宏
  const expandedUserMessage = applyPromptTransforms(
    expandMacros(String(userMessage || ''), macroContext),
    regexTransforms,
    { role: 'user', context: regexContext, depth: 0 }
  );
  const historyWithUser = [...recentMessages, { role: 'user', content: expandedUserMessage, _promptKind: 'current-user' }];
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
      message: {
        role: 'system',
        content: text,
        _promptKind: cards.some((card) => worldBookAnchorKeys.has(worldBookCardKey(card)))
          ? 'worldbook-anchor'
          : 'worldbook'
      }
    });
  }

  promptPlacement.inChatModules.forEach((module, moduleIndex) => {
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
        content: String(module.content || '').trim(),
        _promptKind: promptMessageKind(module, 'preset-in-chat', moduleIndex, promptPlacement.inChatModules.length),
        _promptPriority: promptModuleRuntimePriority(module, moduleIndex, promptPlacement.inChatModules.length),
        _promptModuleId: module.id
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
    { role: 'system', content: systemSections.join('\n\n'), _promptKind: 'core-system' },
    ...(topCardsText ? [{
      role: 'system',
      content: topCardsText,
      _promptKind: topCards.some((card) => worldBookAnchorKeys.has(worldBookCardKey(card)))
        ? 'worldbook-anchor'
        : 'worldbook'
    }] : []),
    ...promptPlacement.systemModules.map((module, index) => ({
      role: 'system',
      content: renderPromptModule(module),
      _promptKind: promptMessageKind(module, 'preset-system', index, promptPlacement.systemModules.length),
      _promptPriority: promptModuleRuntimePriority(module, index, promptPlacement.systemModules.length),
      _promptModuleId: module.id
    })),
    ...promptPlacement.relativeMessages.map((module, index) => ({
      role: normalizePromptRole(module.role),
      content: String(module.content || '').trim(),
      _promptKind: promptMessageKind(module, 'preset-relative', index, promptPlacement.relativeMessages.length),
      _promptPriority: promptModuleRuntimePriority(module, index, promptPlacement.relativeMessages.length),
      _promptModuleId: module.id
    })),
    ...interleavedHistory
  ];

  if (expandedCharacterCard && expandedCharacterCard.enabled !== false && expandedCharacterCard.postHistoryInstructions) {
    assembledMessages.push({
      role: 'system',
      content: expandMacros(expandedCharacterCard.postHistoryInstructions, macroContext),
      _promptKind: 'character-anchor'
    });
  }

  const responseLengthMode = normalizeResponseLengthMode(options.responseLength);
  assembledMessages.push({
    role: 'system',
    content: buildResponseContractPrompt(responseLengthMode),
    _promptKind: 'response-contract'
  });

  const characterSourcePriority = renderCharacterSourcePriorityAnchor(expandedCharacterCard, {
    contentMode: characterContentMode
  });
  if (characterSourcePriority) {
    assembledMessages.push({ role: 'system', content: characterSourcePriority, _promptKind: 'character-anchor' });
  }

  const authorNote = expandMacros(String(options.authorNote || '').trim(), macroContext);
  if (authorNote) {
    assembledMessages.push({ role: 'system', content: `# 作者注释\n${authorNote}`, _promptKind: 'author-note' });
  }

  if (finalUserMessage) {
    assembledMessages.push(finalUserMessage);
  }

  const promptBudgetCompilation = enforcePromptMessageBudget(assembledMessages, { maxTokens: maxPromptTokens });
  const budgetedMessages = promptBudgetCompilation.messages;
  const finalPromptText = budgetedMessages.map((message) => String(message.content || '')).join('\n');
  const retainedInjectedCardIds = injectedCards
    .filter((card) => finalPromptText.includes(`## ${card.title}`))
    .map((card) => card.id);
  const retainedInjectedCardIdSet = new Set(retainedInjectedCardIds);
  const finalizedWorldBookActivation = finalizeWorldBookActivation(
    worldBookActivation.snapshot,
    retainedInjectedCardIds
  );
  const tokenEstimate = estimateTokens(budgetedMessages.map((message) => `${message.role}: ${message.content}`).join('\n'));
  return {
    messages: budgetedMessages,
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
      characterContentMode: characterContentMode.kind,
      hasCharacterSourcePriority: Boolean(characterSourcePriority),
      hasWorldState: Boolean(memory?.worldState),
      hasKnowledgeGraph: Boolean(memory?.knowledgeGraph?.edges?.length),
      hasRollingSummary: Boolean(memory?.rollingSummary),
      memoryRetrieval: memoryContext?.audit || {
        episodicCount: 0,
        summaryCount: 0,
        vectorCount: Array.isArray(vectorHits) ? vectorHits.length : 0,
        graphRevision: Number(memory?.knowledgeGraph?.revision || 0)
      },
      narrativeMode: narrativeContext.mode,
      roleplayMode,
      narrativeGenre: narrativeContext.genre,
      narrativeArc: narrativeContext.activeArc,
      agentProfileId,
      hasAuthoringLedger: Boolean(authoringLedgerPrompt),
      responseLengthMode,
      promptModuleBudget: promptModuleCompilation.report,
      promptVariableWrites: {
        appliedCount: promptVariableAudit.length,
        unresolvedCount: expandedPromptModules.reduce((count, module) => (
          count + (String(module.content || '').match(/\{\{\s*(setvar|addvar|incvar|decvar)\s*::/gi) || []).length
        ), 0)
      },
      worldStateBudget: worldStateCompilation.report,
      historyBudget: historyCompilation.report,
      totalPromptBudget: promptBudgetCompilation.report,
      retainedPromptModuleIds: promptBudgetCompilation.report.retainedPromptModuleIds,
      omittedPromptModuleIds: promptBudgetCompilation.report.omittedPromptModuleIds,
      simulationRevision: Number(memory?.simulation?.revision || 0),
      simulationActorCount: Array.isArray(memory?.simulation?.actors) ? memory.simulation.actors.length : 0,
      injectedCardIds: injectedCards.map((card) => card.id),
      retainedInjectedCardIds,
      omittedInjectedCardIds: injectedCards
        .map((card) => card.id)
        .filter((id) => !retainedInjectedCardIdSet.has(id)),
      worldBookActivation: finalizedWorldBookActivation,
      worldBookBudget,
      promptRegexTransforms: regexTransforms
        .filter((rule) => rule?.enabled !== false && rule?.promptOnly === true)
        .map((rule) => rule.id)
    }
  };
}

function renderKnowledgeGraph(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  if (!edges.length) return '';
  const names = new Map(nodes.map((node) => [node.id, node.label || node.name || node.id]));
  const lines = [
    '# 当前场景关系子图',
    '以下关系来自已校验的本地知识图谱。角色卡和世界书仍具有最高事实优先级；不得凭空改写。'
  ];
  edges.slice(0, 24).forEach((edge) => {
    const source = names.get(edge.source) || edge.source;
    const target = names.get(edge.target) || edge.target;
    const label = edge.label || edge.type || '关联';
    lines.push(`- ${source} → ${target}：${label}`);
  });
  return lines.join('\n');
}

function renderEpisodicMemory(memoryContext) {
  const episodes = Array.isArray(memoryContext?.episodicHits) ? memoryContext.episodicHits : [];
  const summaries = Array.isArray(memoryContext?.summaryHits) ? memoryContext.summaryHits : [];
  const decisions = Array.isArray(memoryContext?.decisionRecords) ? memoryContext.decisionRecords : [];
  if (!episodes.length && !summaries.length && !decisions.length) return '';
  const lines = [
    '# 召回的长期情节记忆',
    '这些内容是带来源的历史剧情摘要，不是模型思维链。若与角色卡、世界书或当前正文冲突，以更高权威且有直接证据的来源为准。'
  ];
  summaries.slice(0, 6).forEach((summary) => {
    const level = summary.summaryLevel === 'arc'
      ? '故事弧'
      : summary.summaryLevel === 'chapter' ? '章节' : '场景';
    const evidence = Array.isArray(summary.sourceMessageIds) && summary.sourceMessageIds.length
      ? ` [证据:${summary.sourceMessageIds.join(',')}]`
      : '';
    lines.push(`- ${level}摘要·${summary.title || '未命名'}：${summary.summary}${evidence}`);
  });
  episodes.slice(0, 6).forEach((episode) => {
    const evidence = Array.isArray(episode.sourceMessageIds) && episode.sourceMessageIds.length
      ? ` [证据:${episode.sourceMessageIds.join(',')}]`
      : '';
    const scene = episode.scene ? `（${episode.scene}）` : '';
    lines.push(`- ${episode.title || '历史片段'}${scene}：${episode.summary}${evidence}`);
  });
  decisions.slice(-4).forEach((record) => {
    const evidence = Array.isArray(record.evidenceMessageIds) && record.evidenceMessageIds.length
      ? ` [证据:${record.evidenceMessageIds.join(',')}]`
      : '';
    lines.push(`- 已确认决策：${record.decision}${record.policy ? `；规则：${record.policy}` : ''}${evidence}`);
  });
  return lines.join('\n');
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

function resolveCharacterContentMode(characterCard, worldBookEntries) {
  const declared = characterCard?.extensions?.local_roleplay_agent?.contentMode;
  const declaredKind = typeof declared === 'string' ? declared : declared?.kind;
  if (declaredKind === 'scenario-container') return { kind: declaredKind, source: 'declared' };

  const names = collectWorldBookCharacterNames(worldBookEntries);
  const cardName = String(characterCard?.name || '').trim();
  const cardIsNamedCharacter = names.some((name) => name === cardName);
  const genericScenarioName = /(?:世界|剧本|故事|物语|仙宗|宗门|之家|学院|公寓|庄园|录|志|症|模拟器|模组)$/u.test(cardName);
  const generatedFields = new Set(
    characterCard?.extensions?.local_roleplay_agent?.enrichment?.generatedFields || []
  );
  const inheritedNpcFields = ['personality', 'scenario', 'exampleDialog']
    .filter((field) => generatedFields.has(field)).length;
  if (!cardIsNamedCharacter && (
    names.length >= 3
    || (names.length >= 2 && genericScenarioName)
    || (names.length >= 2 && inheritedNpcFields >= 2)
  )) {
    return { kind: 'scenario-container', source: 'worldbook', characterNames: names };
  }
  return { kind: 'character', source: 'default', characterNames: names };
}

function collectWorldBookCharacterNames(entries = []) {
  const names = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const title = String(entry?.title || entry?.name || '').trim();
    const match = title.match(/^(.{1,50}?)[_·\s-]+(?:基础信息|二次解释|性格调色盘|人物档案|角色档案|人物设定|角色设定)(?:[_·\s-]|$)/u);
    const name = String(match?.[1] || '').trim();
    if (name && !names.includes(name)) names.push(name);
    if (names.length >= 12) break;
  }
  return names;
}

function worldBookCardKey(card) {
  const id = String(card?.id || '').trim();
  if (id) return `id:${id}`;
  return `title:${String(card?.title || card?.name || '').trim()}`;
}

function renderCharacterCard(card, { includeOpening = false, contentMode = { kind: 'character' } } = {}) {
  if (!card || card.enabled === false) return '';
  if (contentMode.kind === 'scenario-container') {
    const generatedFields = new Set(
      card.extensions?.local_roleplay_agent?.enrichment?.generatedFields || []
    );
    const lines = [
      '# 多角色场景卡',
      `场景包：${card.name || '未命名场景'}`,
      '定位：该根卡是承载多名 NPC、世界规则与开局的场景容器，不是可直接发言的单一角色。',
      'NPC 的身份、外貌、性格、境界、关系和语言风格必须分别取自当前触发的世界书人物条目；禁止把根卡字段或任一 NPC 的字段复制给其他人物。'
    ];
    if (card.description && !generatedFields.has('description')) lines.push(`场景说明：${card.description}`);
    if (card.scenario && !generatedFields.has('scenario')) lines.push(`开局条件：${card.scenario}`);
    if (includeOpening && card.firstMessage) {
      lines.push(`开场语：${limitTextToTokenBudget(card.firstMessage, 320)}`);
    }
    if (card.systemPrompt) lines.push(`场景系统提示：${card.systemPrompt}`);
    if (Array.isArray(card.tags) && card.tags.length) lines.push(`标签：${card.tags.join('、')}`);
    return lines.join('\n');
  }
  const lines = [
    '# 角色卡',
    `姓名：${card.name || '未命名主角'}`,
    `身份：${card.role || ''}`,
    `描述：${card.description || ''}`,
    `性格：${card.personality || ''}`,
    `当前情境：${card.scenario || ''}`
  ];
  if (includeOpening && card.firstMessage) {
    lines.push(`开场语：${limitTextToTokenBudget(card.firstMessage, 320)}`);
  }
  if (card.systemPrompt) lines.push(`角色系统提示：${card.systemPrompt}`);
  if (Array.isArray(card.exampleDialog) && card.exampleDialog.length) {
    lines.push(`示例对话：\n${limitTextToTokenBudget(card.exampleDialog.join('\n'), 320)}`);
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

function renderCharacterPerformanceContract(characterCard, groupMembers, {
  contentMode = { kind: 'character' },
  activeCards = []
} = {}) {
  const worldBookCharacters = contentMode.kind === 'scenario-container'
    ? collectWorldBookCharacterNames(activeCards)
    : [];
  const namedCharacters = [
    contentMode.kind === 'scenario-container' || characterCard?.enabled === false ? '' : characterCard?.name,
    ...worldBookCharacters,
    ...(Array.isArray(groupMembers) ? groupMembers.filter((member) => member?.enabled !== false).map((member) => member?.name) : [])
  ].filter(Boolean).filter((name, index, values) => values.indexOf(name) === index);
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

function renderCharacterSourcePriorityAnchor(characterCard, { contentMode = { kind: 'character' } } = {}) {
  if (!isImportedCharacterCard(characterCard)) return '';
  if (contentMode.kind === 'scenario-container') {
    return [
      '# 本轮多角色场景卡优先级',
      `当前导入内容「${characterCard.name || '未命名场景'}」是多角色剧本容器，不是名为“${characterCard.name || '该场景'}”的 NPC。`,
      '角色卡开场、已启用 Character Book / 世界书及用户已经确认的事实，是当前人物、关系、地点和剧情前提的首要依据。预设只负责通用写作方式，不能改写这些事实。',
      '每名 NPC 必须绑定自己的世界书人物条目；不得把从某一人物条目自动提取的性格、衣着、境界、目标或对白方式套到另一人物身上。',
      '事实优先级：①当前触发的人物世界书与根卡开场；②用户明确确认的事实与本轮行动；③不冲突的既有会话事实；④摘要、World State、预设补充和模型推断。',
      '若历史摘要或 World State 存在重复初遇、错误人物名、地点滞后或互斥指令，本轮必须以高优先级来源校正，不得继续传播。',
      '隐藏秘密和未公开信息只可用于导演侧约束，在剧情明确揭露前不得写成玩家已知事实。'
    ].join('\n');
  }
  return [
    '# 本轮导入角色卡优先级',
    `当前导入角色卡为「${characterCard.name || '未命名角色'}」。角色卡及当前已启用的 Character Book / 世界书，是人物身份、NPC 性格、关系、地点、故事前提、对白方式和行文风格的首要依据。`,
    '事实优先级必须按以下顺序执行：①角色卡与已启用世界书；②用户明确确认的事实与本轮行动；③不冲突的既有会话事实；④滚动摘要、World State、模型推断与预设补充。低优先级来源冲突时必须舍弃，不能保留两套互斥版本。',
    '内容包只提供通用题材规则、力量体系与格式兜底，不得用内容包自带的专属人物、地点、开局事件或固定主线替换导入卡设定。',
    '若两者冲突，人物、关系、地点、开场与叙事风格以导入角色卡和当前已启用世界书为准；不要继续与当前导入卡无关的基线剧情。',
    '保持已经在本会话中明确发生且不与角色卡、世界书冲突的事实连续；若摘要或 World State 与事实源冲突，以事实源校正当前描写，不要继续传播错误状态。',
    '角色卡或世界书中的隐藏秘密、幕后动机和未公开信息只能约束导演侧推演；在剧情明确揭露前，不得写入玩家可见正文、角色状态或主角已知事实。'
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

function renderPromptModule(module) {
  if (!module || !String(module.content || '').trim()) return '';
  return `# Prompt 模块\n## ${module.title}\n${module.content}`;
}

function promptMessageKind(module, fallbackKind, index, total) {
  return promptModuleRuntimePriority(module, index, total) >= 90
    ? 'preset-critical'
    : fallbackKind;
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
    '无论角色卡来自内置内容还是社区导入，角色卡与当前已启用世界书都是人物、关系、地点、世界规则和秘密边界的最高事实源；用户明确行动次之。摘要、World State、模型推断或预设补充发生冲突时必须服从事实源，不能保留两套互斥版本。',
    '用户可见正文放在 <plot> 标签中，按自然段组织场景、动作、感官与对白；不要把状态表、导演分析或 XML 标签写进正文。',
    '正文之后用 <normal_status> 记录时间、地点、在场人物和当前任务；用 <relationship_status> 只记录本轮实际发生变化的关系。',
    '用 <special_status> 分角色记录主角及本幕关键人物的当前档案。本轮实际登场、对话或与主角发生互动的每个具名人物都必须登记，并使用角色卡或世界书中的规范名称。每个角色以『角色名·状态』开头，按需包含：身份、外貌/穿着、性格、身体状况、境界/能力、物品、姿势、神情和当前目标。字段必须是“名称：内容”的单行格式，未知项写“未知”，不要编造；隐藏秘密不得写入玩家可见状态。',
    '用 <relationship_status> 记录本轮实际形成或变化的联系，优先采用“角色A→角色B：变化与依据”的格式；未见面、仅听闻的角色要明确标为间接关联。',
    '用 <NextCharacterPanel> 简短记录下一幕建议登场或退场的角色与原因。这些控制区不会显示在正文中，内容应简洁、可更新。',
    '同一回复只能推进一条连续叙事，不得在后半段重新从同一起点出发、改写另一套人物或地点版本。',
    '不要输出内部推理过程。正文结尾必须留下用户可行动的局面，再按推荐选项协议给出 2-4 个互有差异的行动。'
  ].join('\n');
}
