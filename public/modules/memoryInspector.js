const FORBIDDEN_RULE_PATH_PARTS = new Set(['__proto__', 'prototype', 'constructor']);

export function formatMemoryDisplayValue(value, fallback = '未记录') {
  if (Array.isArray(value)) {
    return value.filter(Boolean).slice(0, 6).join('、') || fallback;
  }
  if (value && typeof value === 'object') {
    const text = Object.entries(value)
      .slice(0, 6)
      .map(([key, item]) => `${key}: ${Array.isArray(item) ? item.join('、') : String(item)}`)
      .join(' · ');
    return text || fallback;
  }
  return String(value ?? '').trim() || fallback;
}

export function resolveCurrentLocation(worldState = {}, narrativeState = {}) {
  const location = worldState.location;
  if (location && typeof location === 'object' && !Array.isArray(location)) {
    return location.current || location.name || location.title
      || worldState.currentLocation
      || narrativeState.currentLocation;
  }
  return location || worldState.currentLocation || narrativeState.currentLocation;
}

export function getRulePathValue(context, pathValue) {
  const parts = String(pathValue || '').split('.').filter(Boolean);
  if (!parts.length) return undefined;
  let cursor = context;
  for (const part of parts) {
    if (FORBIDDEN_RULE_PATH_PARTS.has(part)) return undefined;
    if (cursor == null || typeof cursor !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(cursor, part)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

export function formatRuleRecord(record) {
  if (!record || typeof record !== 'object') return String(record ?? '');
  const title = record.title || record.name || record.time || record.id || '';
  const detail = record.status || record.stance || record.state || record.event || record.content || '';
  if (title && detail) return `${title}：${detail}`;
  if (title) return String(title);
  if (detail) return String(detail);
  return Object.entries(record)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}:${Array.isArray(value) ? value.join('、') : value}`)
    .join('，') || '-';
}

export function formatRuleFieldValue(value, type) {
  if (value == null || value === '') return '-';
  if (Array.isArray(value)) {
    if (!value.length) return '-';
    if (type === 'records' || value.some((item) => item && typeof item === 'object')) {
      return value.map(formatRuleRecord).join('；');
    }
    return value.map((item) => String(item)).join('、');
  }
  if (typeof value === 'object') return formatRuleRecord(value);
  return String(value);
}

export function createMemoryInspectorController({
  state = {},
  els = {},
  documentObject = globalThis.document
} = {}) {
  function clearElement(element) {
    if (typeof element?.replaceChildren === 'function') {
      element.replaceChildren();
    } else if (element) {
      element.textContent = '';
    }
  }

  function createMetric(label, value) {
    const metric = documentObject.createElement('div');
    metric.className = 'memory-metric';
    const number = documentObject.createElement('strong');
    number.textContent = String(value);
    const caption = documentObject.createElement('span');
    caption.textContent = label;
    metric.append(number, caption);
    return metric;
  }

  function createContextRow(label, value) {
    const row = documentObject.createElement('div');
    row.className = 'memory-context-row';
    const caption = documentObject.createElement('span');
    caption.textContent = label;
    const content = documentObject.createElement('strong');
    content.textContent = formatMemoryDisplayValue(value);
    content.title = content.textContent;
    row.append(caption, content);
    return row;
  }

  function renderMemoryOverview() {
    if (!els.memoryOverview) return;
    const memory = state.session?.memory || {};
    const worldState = memory.worldState || {};
    const narrativeState = memory.narrativeState || {};
    const protagonist = worldState.protagonist || {};
    const memoryCards = Array.isArray(memory.memoryCards) ? memory.memoryCards : [];
    const summary = String(memory.rollingSummary || '').trim();
    const episodicMemory = memory.episodicMemory || {};
    const activeEpisodes = (Array.isArray(episodicMemory.episodes) ? episodicMemory.episodes : [])
      .filter((item) => item?.status === 'confirmed');
    const activeScenes = (Array.isArray(episodicMemory.summaries?.scenes) ? episodicMemory.summaries.scenes : [])
      .filter((item) => item?.status === 'confirmed');
    const activeChapters = (Array.isArray(episodicMemory.summaries?.chapters) ? episodicMemory.summaries.chapters : [])
      .filter((item) => item?.status === 'confirmed');
    const activeArcs = (Array.isArray(episodicMemory.summaries?.arcs) ? episodicMemory.summaries.arcs : [])
      .filter((item) => item?.status === 'confirmed');

    clearElement(els.memoryOverview);

    const heading = documentObject.createElement('header');
    heading.className = 'memory-overview-heading';
    const title = documentObject.createElement('div');
    const eyebrow = documentObject.createElement('span');
    eyebrow.textContent = '长期叙事记忆';
    const headingText = documentObject.createElement('strong');
    headingText.textContent = '当前会话记忆总览';
    title.append(eyebrow, headingText);
    const badge = documentObject.createElement('span');
    badge.className = 'memory-pending-badge';
    const pendingTurns = Number(memory.unsummarizedTurnCount || 0);
    badge.textContent = pendingTurns ? `${pendingTurns} 回合待整理` : '已同步';
    heading.append(title, badge);
    els.memoryOverview.append(heading);

    const metrics = documentObject.createElement('div');
    metrics.className = 'memory-metrics';
    metrics.append(
      createMetric('摘要字数', summary.length),
      createMetric('事实卡', memoryCards.length),
      createMetric('情节记忆', activeEpisodes.length),
      createMetric('场景/章/弧', `${activeScenes.length}/${activeChapters.length}/${activeArcs.length}`),
      createMetric('状态域', Object.keys(worldState).length)
    );
    els.memoryOverview.append(metrics);

    const summaryCard = documentObject.createElement('section');
    summaryCard.className = 'memory-overview-card memory-summary-card';
    const summaryTitle = documentObject.createElement('strong');
    summaryTitle.textContent = '滚动摘要';
    const summaryText = documentObject.createElement('p');
    summaryText.textContent = summary || '尚未形成滚动摘要。对话达到总结阈值后，系统会在这里沉淀长期情节。';
    summaryCard.append(summaryTitle, summaryText);
    els.memoryOverview.append(summaryCard);

    const contextCard = documentObject.createElement('section');
    contextCard.className = 'memory-overview-card';
    const contextTitle = documentObject.createElement('strong');
    contextTitle.textContent = '当前叙事坐标';
    const contextGrid = documentObject.createElement('div');
    contextGrid.className = 'memory-context-grid';
    contextGrid.append(
      createContextRow('题材', worldState.flags?.genre || memory.ruleSystem?.title),
      createContextRow('主角', protagonist.name || state.config?.characterCard?.name),
      createContextRow('地点', resolveCurrentLocation(worldState, narrativeState)),
      createContextRow('时间', worldState.time || worldState.date || narrativeState.currentTime),
      createContextRow('主线', narrativeState.activeArc || narrativeState.currentArc),
      createContextRow('随身物品', worldState.inventory || protagonist.inventory)
    );
    contextCard.append(contextTitle, contextGrid);
    els.memoryOverview.append(contextCard);

    const hierarchy = [...activeArcs, ...activeChapters, ...activeScenes]
      .sort((left, right) => Number(right.validFromTurn || 0) - Number(left.validFromTurn || 0))
      .slice(0, 6);
    if (hierarchy.length) {
      const hierarchyCard = documentObject.createElement('section');
      hierarchyCard.className = 'memory-overview-card';
      const hierarchyTitle = documentObject.createElement('strong');
      hierarchyTitle.textContent = '分层情节记忆';
      const hierarchyList = documentObject.createElement('div');
      hierarchyList.className = 'memory-recent-facts memory-hierarchy-list';
      hierarchy.forEach((item) => {
        const row = documentObject.createElement('div');
        const itemTitle = documentObject.createElement('span');
        const level = item.summaryLevel === 'arc' ? '故事弧' : item.summaryLevel === 'chapter' ? '章节' : '场景';
        itemTitle.textContent = `${level} · ${item.title || '未命名摘要'}`;
        const content = documentObject.createElement('p');
        content.textContent = item.summary || '等待补充内容';
        row.append(itemTitle, content);
        hierarchyList.append(row);
      });
      hierarchyCard.append(hierarchyTitle, hierarchyList);
      els.memoryOverview.append(hierarchyCard);
    }

    if (memoryCards.length) {
      const factCard = documentObject.createElement('section');
      factCard.className = 'memory-overview-card';
      const factTitle = documentObject.createElement('strong');
      factTitle.textContent = '最近提取的事实';
      const factList = documentObject.createElement('div');
      factList.className = 'memory-recent-facts';
      memoryCards.slice(0, 4).forEach((fact) => {
        const item = documentObject.createElement('div');
        const itemTitle = documentObject.createElement('span');
        itemTitle.textContent = fact.title || fact.subject || '叙事事实';
        const itemContent = documentObject.createElement('p');
        itemContent.textContent = fact.content || fact.fact
          || [fact.subject, fact.predicate, fact.object].filter(Boolean).join(' ')
          || '等待补充内容';
        item.append(itemTitle, itemContent);
        factList.append(item);
      });
      factCard.append(factTitle, factList);
      els.memoryOverview.append(factCard);
    }
  }

  function renderRuleStatus() {
    if (!els.ruleStatusView) return;
    const memory = state.session?.memory || {};
    const ruleSystem = memory.ruleSystem;
    clearElement(els.ruleStatusView);

    if (!ruleSystem || !Array.isArray(ruleSystem.panels)) {
      const empty = documentObject.createElement('div');
      empty.className = 'compact-empty';
      empty.textContent = '当前会话没有绑定规则系统。应用题材内容包后会自动生成对应状态面板。';
      els.ruleStatusView.append(empty);
      return;
    }

    const context = {
      memory,
      worldState: memory.worldState || {},
      characterCard: state.config?.characterCard || {},
      config: state.config || {}
    };

    const header = documentObject.createElement('section');
    header.className = 'rule-system-header';
    const heading = documentObject.createElement('div');
    const title = documentObject.createElement('strong');
    title.textContent = ruleSystem.title || '规则系统';
    const contentPackId = documentObject.createElement('span');
    contentPackId.textContent = ruleSystem.contentPackId || 'custom';
    heading.append(title, contentPackId);
    const boundary = documentObject.createElement('p');
    boundary.textContent = ruleSystem.boundary || '规则面板只展示当前内容包声明的状态。';
    header.append(heading, boundary);
    els.ruleStatusView.append(header);

    for (const panel of ruleSystem.panels) {
      if (!panel || typeof panel !== 'object' || Array.isArray(panel)) continue;
      const card = documentObject.createElement('section');
      card.className = 'rule-panel';
      const panelHeading = documentObject.createElement('div');
      panelHeading.className = 'rule-panel-heading';
      const panelTitle = documentObject.createElement('strong');
      panelTitle.textContent = panel.title || panel.id || '状态';
      panelHeading.append(panelTitle);
      if (panel.note) {
        const panelNote = documentObject.createElement('span');
        panelNote.textContent = panel.note;
        panelHeading.append(panelNote);
      }

      const grid = documentObject.createElement('div');
      grid.className = 'rule-field-grid';
      const fields = Array.isArray(panel.fields) ? panel.fields : [];
      for (const field of fields) {
        if (!field || typeof field !== 'object' || Array.isArray(field)) continue;
        const value = getRulePathValue(context, field.path);
        const row = documentObject.createElement('div');
        row.className = 'rule-field';
        const label = documentObject.createElement('span');
        label.textContent = field.label || field.path || '字段';
        const content = documentObject.createElement('strong');
        content.textContent = formatRuleFieldValue(value, field.type);
        row.append(label, content);
        grid.append(row);
      }
      card.append(panelHeading, grid);
      els.ruleStatusView.append(card);
    }
  }

  return { renderMemoryOverview, renderRuleStatus };
}
