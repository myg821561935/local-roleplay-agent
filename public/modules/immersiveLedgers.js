import {
  cleanImmersiveSidebarText,
  formatImmersiveMemoryMeta,
  getCustomOpeningProtagonistSnapshot,
  mergeImmersiveFacts,
  normalizeImmersiveRecords,
  parseImmersiveDocumentSections,
  parseImmersiveStatusFields,
  resolveLatestRoleplayPanels,
  toImmersiveWorldBookRecord
} from './immersiveDossier.js';
import {
  buildImmersiveRelationshipGraph,
  renderImmersiveRelationshipGraph
} from './relationshipGraph.js';

export function createImmersiveLedgerController({
  state = {},
  els = {},
  dossier = {},
  resolvePrologueTemplate = () => ({ tpl: {} }),
  getCurrentStoryPresentation = () => ({ title: '当前剧本', custom: false }),
  splitCharacterStatus = () => ({ protagonist: '', interactive: '' }),
  extractRoleplayPresentation = () => ({ content: '', panels: {} }),
  truncateText = (value) => String(value || ''),
  documentObject = globalThis.document
} = {}) {
  const {
    appendImmersiveDossierEmpty = () => {},
    appendImmersiveFactGrid = () => {},
    appendImmersiveLedgerSection = () => {},
    appendImmersiveMemoryRows = () => {},
    createImmersiveDossier = () => ({ root: null, body: null }),
    getImmersiveRecentTurns = () => []
  } = dossier;

  const getLatestPanels = () => resolveLatestRoleplayPanels(
    Array.isArray(state.session?.messages) ? state.session.messages : [],
    extractRoleplayPresentation
  );

  const toWorldBookRecord = (entry) => toImmersiveWorldBookRecord(entry, truncateText);

  function renderImmersiveIntelligenceLedger(label, tpl, genre) {
    if (!els.immersiveSidebarBody) return;
    const presentation = getCurrentStoryPresentation(tpl, genre);
    const memory = state.session?.memory || {};
    const worldState = memory.worldState || {};
    const panels = getLatestPanels();
    const crisisSections = presentation.custom
      ? []
      : parseImmersiveDocumentSections(tpl?.tabs?.currentCrisis?.content)
        .filter((section) => /线索|谜|调查|证据|异动|传闻/.test(`${section.title} ${section.body || ''}`));
    const quests = filterCustomStoryRecords(
      normalizeImmersiveRecords(worldState.quests, '待办事项'),
      presentation
    );
    const worldbookClues = buildImmersiveWorldBookRecords(/任务|主线|剧情|事件|线索|谜|证据|开局|传闻/, 6);
    const factRecords = filterCustomStoryRecords(
      normalizeImmersiveRecords(
        Array.isArray(memory.memoryCards)
          ? memory.memoryCards
          : Array.isArray(memory.facts) ? memory.facts : [],
        '事实'
      ),
      presentation
    ).filter((record) => /线索|证据|发现|调查|谜|秘密|异常|失踪|任务|承诺|去向/.test(`${record.title || ''} ${record.detail || ''}`));

    const view = createImmersiveDossier({
      kind: 'intelligence',
      eyebrow: `${presentation.title} · 局势卷宗`,
      title: label,
      summary: panels.sceneStatus
        ? cleanImmersiveSidebarText(panels.sceneStatus)
        : '只呈现当前剧本已经载入或在对话中实际形成的任务、证据与未解问题。人物关系与势力归入独立卷宗。',
      metrics: [
        ['任务', quests.length],
        ['底稿', worldbookClues.length],
        ['线索', factRecords.length]
      ]
    });

    if (crisisSections.length) {
      appendImmersiveLedgerSection(view.body, '未解异动', crisisSections, { tone: 'warning' });
    }
    if (quests.length) {
      appendImmersiveLedgerSection(view.body, '当前任务', quests, { numbered: true, tone: 'active' });
    }
    if (worldbookClues.length) {
      appendImmersiveLedgerSection(view.body, '剧本底稿', worldbookClues, { numbered: true });
    }
    if (factRecords.length) {
      appendImmersiveLedgerSection(view.body, '已获线索', factRecords, { numbered: true, tone: 'active' });
    }
    appendImmersiveDossierEmpty(view.body, '尚无公开线索。剧情推进后，这里会同步任务、证据与未解问题。');
    els.immersiveSidebarBody.replaceChildren(view.root);
  }

  function renderImmersiveRelationshipLedger(label, tpl, genre) {
    if (!els.immersiveSidebarBody) return;
    const presentation = getCurrentStoryPresentation(tpl, genre);
    const worldState = state.session?.memory?.worldState || {};
    const panels = getLatestPanels();
    const relationships = filterCustomStoryRecords(
      normalizeImmersiveRecords(worldState.relationships, '人物关系'),
      presentation
    );
    const factions = filterCustomStoryRecords(
      normalizeImmersiveRecords(worldState.factions, '势力动向'),
      presentation
    );
    const factionSections = presentation.custom
      ? []
      : parseImmersiveDocumentSections(tpl?.tabs?.factions?.content);
    const graph = buildImmersiveRelationshipGraph({
      protagonistName: worldState.protagonist?.name || state.config?.characterCard?.name || '主角',
      graphProjection: state.session?.memory?.knowledgeGraph,
      relationships: worldState.relationships,
      factions: worldState.factions,
      relationshipStatus: panels.relationshipStatus
    });
    const directCount = graph.nodes.filter((node) => node.type === 'character' && node.direct !== false).length;
    const view = createImmersiveDossier({
      kind: 'relationships',
      eyebrow: `${presentation.title} · 人物网络`,
      title: label,
      summary: '以已发生的接触和世界状态为依据绘制关系；虚线仅表示已知但尚未直接接触的关联。',
      metrics: [
        ['已接触', directCount],
        ['联系', graph.edges.length],
        ['势力', factions.length || factionSections.length]
      ]
    });
    renderImmersiveRelationshipGraph(view.body, graph, { documentObject });
    if (relationships.length) {
      appendImmersiveLedgerSection(view.body, '关系卷宗', relationships, { tone: 'active' });
    }
    if (factions.length) {
      appendImmersiveLedgerSection(view.body, '势力风向', factions, { tone: 'faction' });
    } else if (factionSections.length) {
      appendImmersiveLedgerSection(view.body, '势力风向', factionSections, { tone: 'faction' });
    }
    appendImmersiveDossierEmpty(view.body, '尚未建立人物或势力联系。实际接触后会在这里形成关系节点。');
    els.immersiveSidebarBody.replaceChildren(view.root);
  }

  function buildImmersiveWorldBookRecords(pattern, limit = 6) {
    return (Array.isArray(state.config?.worldBook) ? state.config.worldBook : [])
      .filter((entry) => entry && entry.enabled !== false)
      .filter((entry) => {
        const visibility = entry?.extensions?.visibility || entry?.visibility || 'player';
        return visibility !== 'gm' && entry?.extensions?.gmOnly !== true;
      })
      .filter((entry) => pattern.test(`${entry.title || ''} ${entry.content || ''}`))
      .sort((left, right) => Number(right.priority ?? 50) - Number(left.priority ?? 50))
      .slice(0, limit)
      .map(toWorldBookRecord);
  }

  function filterCustomStoryRecords(records, presentation) {
    if (!presentation?.custom) return records;
    const evidence = getCurrentCustomStoryEvidence(presentation);
    const inheritedSignatures = [
      '个人创作主角',
      '立足当前局势',
      '保住道心',
      '天命榜改写前',
      '寻找天道残缺',
      '补全本命功法',
      '落雷山脉秘境',
      '圣地与魔宗',
      '封魂玉简',
      '避劫雷木牌',
      '未开封秘境图',
      '破损飞剑',
      '青衣负剑',
      '雷火烧痕',
      '丹田雷纹',
      '金丹初期'
    ];
    return records.filter((record) => {
      const text = `${record.title || ''} ${record.detail || ''}`;
      if (inheritedSignatures.some((signature) => text.includes(signature) && !evidence.includes(signature))) {
        return false;
      }
      return true;
    });
  }

  function getCurrentCustomStoryEvidence(presentation) {
    if (!presentation?.custom) return '';
    const character = state.config?.characterCard || {};
    const worldBook = Array.isArray(state.config?.worldBook) ? state.config.worldBook : [];
    return [
      presentation.title,
      presentation.pack?.description,
      character.name,
      character.role,
      character.description,
      character.personality,
      character.scenario,
      character.firstMessage,
      ...worldBook.slice(0, 120).flatMap((entry) => [
        entry?.title,
        String(entry?.content || '').slice(0, 900)
      ])
    ].filter(Boolean).join('\n');
  }

  function renderImmersiveProgressLedger(label, tpl, genre) {
    if (!els.immersiveSidebarBody) return;
    const presentation = getCurrentStoryPresentation(tpl, genre);
    const opening = getCustomOpeningProtagonistSnapshot(tpl);
    const character = state.config?.characterCard || {};
    const memory = state.session?.memory || {};
    const worldState = memory.worldState || {};
    const protagonist = worldState.protagonist || {};
    const panels = getLatestPanels();
    const protagonistNames = [protagonist.name, character.name].filter(Boolean);
    const protagonistStatus = splitCharacterStatus(panels.characterStatus, protagonistNames).protagonist;
    const statusFields = parseImmersiveStatusFields(protagonistStatus);
    const ruleSections = presentation.custom
      ? []
      : parseImmersiveDocumentSections(tpl?.tabs?.rules?.content)
        .filter((section) => /修行|境界|功法|武学|神通|武器|法宝|心魔|天劫|战力/.test(section.title));
    const crisisSections = presentation.custom
      ? []
      : parseImmersiveDocumentSections(tpl?.tabs?.currentCrisis?.content)
        .filter((section) => /神通|造化|功法|境界|伤|劫|资源/.test(section.title));
    const resources = filterCustomStoryRecords(
      normalizeImmersiveRecords(
        worldState.resourceLedger?.length ? worldState.resourceLedger : protagonist.inventory || worldState.inventory,
        '随身资源'
      ),
      presentation
    );
    const injuries = filterCustomStoryRecords(
      normalizeImmersiveRecords(protagonist.injuries, '伤势与代价'),
      presentation
    );
    const facts = mergeImmersiveFacts([
      ['姓名', opening.name || protagonist.name || character.name],
      ['身份/境界', opening.role || protagonist.realm || character.role],
      ['性格/道心', opening.personality || protagonist.traits || character.personality],
      ['当前目标', opening.goal],
      ['关系模式', opening.relationshipStyle],
      ['当前位置', worldState.location?.current || worldState.location],
      ...statusFields.map(({ label: fieldLabel, value }) => [fieldLabel, value])
    ], 12);

    const view = createImmersiveDossier({
      kind: 'progress',
      eyebrow: `${presentation.title} · 成长档案`,
      title: label,
      summary: protagonist.realm && !opening.scenarioRole
        ? `${opening.name || protagonist.name || character.name || '主角'}当前处于${protagonist.realm}，修行所得与代价均以世界状态为准。`
        : '能力、资源与代价会随世界状态同步，不以单次模型描写覆盖既有设定。',
      metrics: [
        ['状态', facts.length],
        ['资源', resources.length],
        ['代价', injuries.length]
      ]
    });

    appendImmersiveFactGrid(view.body, facts, 'immersive-progress-facts');
    if (injuries.length) {
      appendImmersiveLedgerSection(view.body, '伤势与代价', injuries, { tone: 'warning' });
    }
    if (resources.length) {
      appendImmersiveLedgerSection(view.body, '资源储备', resources, { tone: 'resource' });
    }
    if (crisisSections.length) {
      appendImmersiveLedgerSection(view.body, '当前契机', crisisSections, { tone: 'active' });
    }
    if (ruleSections.length) {
      appendImmersiveLedgerSection(view.body, '体系与边界', ruleSections);
    }
    appendImmersiveDossierEmpty(view.body, '尚未建立成长记录。完成开局或推进一轮剧情后会自动补全。');
    els.immersiveSidebarBody.replaceChildren(view.root);
  }

  function renderImmersiveMemoryLedger(label, genre) {
    if (!els.immersiveSidebarBody) return;
    const { tpl } = resolvePrologueTemplate();
    const presentation = getCurrentStoryPresentation(tpl, genre);
    const memory = state.session?.memory || {};
    const worldState = memory.worldState || {};
    const timeline = filterCustomStoryRecords(
      normalizeImmersiveRecords(worldState.timeline, '剧情纪事'),
      presentation
    );
    const memoryCards = Array.isArray(memory.memoryCards)
      ? memory.memoryCards
      : Array.isArray(memory.facts) ? memory.facts : [];
    const recentFacts = filterCustomStoryRecords(
      memoryCards.slice(-12).reverse().map((fact, index) => ({
        title: fact.title || fact.subject || `事实 ${memoryCards.length - index}`,
        detail: fact.content || fact.fact || [fact.subject, fact.predicate, fact.object].filter(Boolean).join(' '),
        meta: formatImmersiveMemoryMeta(fact)
      })).filter((item) => item.detail),
      presentation
    ).slice(0, 7);
    const recentTurns = getImmersiveRecentTurns(state.session?.messages || []);
    const summary = cleanImmersiveSidebarText(memory.rollingSummary);

    const view = createImmersiveDossier({
      kind: 'memory',
      eyebrow: `${presentation.title} · 叙事记忆`,
      title: label,
      summary: '长期摘要负责守住章节因果，近期纪事负责保留刚刚发生、尚未沉淀的客观信息。',
      metrics: [
        ['长期摘要', summary ? 1 : 0],
        ['事实卡', memoryCards.length],
        ['待整理回合', Number(memory.unsummarizedTurnCount || 0)]
      ]
    });

    const longTerm = documentObject.createElement('section');
    longTerm.className = 'immersive-memory-block immersive-memory-long-term';
    const longTermTitle = documentObject.createElement('div');
    longTermTitle.className = 'immersive-memory-block-title';
    const longTermHeading = documentObject.createElement('h4');
    longTermHeading.textContent = '长期记忆';
    const longTermBadge = documentObject.createElement('span');
    longTermBadge.textContent = summary ? '已沉淀' : '等待总结';
    longTermTitle.append(longTermHeading, longTermBadge);
    const longTermText = documentObject.createElement('p');
    longTermText.textContent = summary || '尚未形成章节摘要。达到总结阈值后，系统会把稳定因果沉淀到这里。';
    longTerm.append(longTermTitle, longTermText);
    view.body.append(longTerm);

    if (recentFacts.length) {
      appendImmersiveMemoryRows(view.body, '短期事实', recentFacts);
    }
    if (timeline.length) {
      appendImmersiveMemoryRows(view.body, '剧情纪事', timeline.slice(-8).reverse());
    }
    if (recentTurns.length) {
      appendImmersiveMemoryRows(view.body, '最近对话', recentTurns);
    }
    els.immersiveSidebarBody.replaceChildren(view.root);
  }

  return {
    filterCustomStoryRecords,
    renderImmersiveIntelligenceLedger,
    renderImmersiveRelationshipLedger,
    renderImmersiveMemoryLedger,
    renderImmersiveProgressLedger
  };
}
