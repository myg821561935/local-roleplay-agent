const NAME_PATTERN = '[\\u3400-\\u9fffA-Za-z][\\u3400-\\u9fffA-Za-z0-9·・]{0,15}';
const INDIRECT_PATTERN = /未露面|尚未(?:直接)?(?:见面|接触|登场)|间接关联|只闻其名|传闻|待登场/;

export function collectImmersiveCharacterMembers({
  configured = [],
  relationships = [],
  characters = [],
  messages = [],
  interactiveStatus = '',
  relationshipStatus = '',
  castContent = '',
  protagonistNames = []
} = {}) {
  const configuredRecords = Array.isArray(configured) ? configured : [];
  const messageRecords = Array.isArray(messages) ? messages : [];
  const protagonists = new Set(protagonistNames.map(normalizeName).filter(Boolean));
  const records = new Map();
  const encounteredNames = new Set();
  const panelTexts = [
    ...messageRecords.flatMap((message) => {
      const panels = message?.roleplayPanels || {};
      return [panels.characterStatus, panels.relationshipStatus, panels.sceneStatus];
    }),
    interactiveStatus,
    relationshipStatus
  ].filter(Boolean).map(String);

  panelTexts.forEach((text) => collectPanelNames(text).forEach((name) => encounteredNames.add(name)));

  const addMember = (member, { requireEncounter = false } = {}) => {
    const name = normalizeName(member?.name || member?.character || member?.target);
    if (!name || protagonists.has(name)) return;
    const evidence = [
      member?.status,
      member?.state,
      member?.description,
      member?.relationship,
      member?.relation,
      member?.detail,
      member?.notes
    ].filter(Boolean).join(' ');
    const encountered = member?.encountered === true
      || encounteredNames.has(name)
      || (member?.encountered !== false && !INDIRECT_PATTERN.test(evidence));
    if (requireEncounter && !encountered) return;
    const previous = records.get(name) || {};
    records.set(name, {
      ...previous,
      ...member,
      name,
      role: member?.role || member?.identity || member?.title || previous.role || '互动角色',
      description: member?.description || member?.detail || member?.notes || previous.description || '',
      relationship: member?.relationship || member?.relation || member?.status || previous.relationship || '',
      encountered: Boolean(previous.encountered || encountered)
    });
  };

  configuredRecords
    .filter((member) => member?.enabled !== false)
    .forEach((member) => addMember(member));
  (Array.isArray(characters) ? characters : []).forEach((member) => addMember(member, { requireEncounter: true }));
  (Array.isArray(relationships) ? relationships : []).forEach((member) => addMember(member, { requireEncounter: true }));

  collectCatalogMembers(castContent).forEach((member) => {
    if (encounteredNames.has(member.name) || !panelTexts.length) addMember(member);
  });
  encounteredNames.forEach((name) => addMember({ name, role: '本幕角色', encountered: true }));

  return [...records.values()]
    .filter((member) => member.encountered || configuredRecords.some((item) => normalizeName(item?.name) === member.name))
    .slice(0, 24);
}

export function buildImmersiveRelationshipGraph({
  protagonistName = '主角',
  graphProjection = null,
  relationships = [],
  factions = [],
  relationshipStatus = ''
} = {}) {
  const protagonist = normalizeName(protagonistName) || '主角';
  const nodes = new Map([[protagonist, { id: protagonist, label: protagonist, type: 'protagonist', direct: true }]]);
  const edges = [];
  const edgeKeys = new Set();
  const addNode = (name, extra = {}) => {
    const normalized = normalizeName(name);
    if (!normalized) return '';
    nodes.set(normalized, { ...(nodes.get(normalized) || {}), id: normalized, label: normalized, ...extra });
    return normalized;
  };
  const addEdge = (source, target, label = '', indirect = false) => {
    const from = addNode(source);
    const to = addNode(target);
    if (!from || !to || from === to) return;
    const key = [from, to].sort().join('::');
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ source: from, target: to, label: cleanLabel(label), indirect });
  };

  const projectedNodes = (Array.isArray(graphProjection?.nodes) ? graphProjection.nodes : [])
    .filter((node) => ['Character', 'Faction'].includes(node?.type));
  const projectedEdges = Array.isArray(graphProjection?.edges) ? graphProjection.edges : [];
  projectedNodes.forEach((node) => {
    const properties = node?.properties || {};
    const type = properties.protagonist
      ? 'protagonist'
      : node?.type === 'Faction'
        ? 'faction'
        : node?.type === 'Character'
          ? 'character'
          : 'knowledge';
    addNode(node?.label || node?.name, {
      type,
      direct: properties.indirect !== true && properties.encountered !== false,
      detail: cleanLabel(properties.description || ''),
      role: properties.role || ''
    });
  });
  const projectedNames = new Map(projectedNodes.map((node) => [node.id, node.label || node.name]));
  projectedEdges.forEach((edge) => {
    const source = projectedNames.get(edge.source);
    const target = projectedNames.get(edge.target);
    if (!source || !target) return;
    addEdge(source, target, edge.label || relationTypeLabel(edge.type), edge.properties?.indirect === true);
  });

  (Array.isArray(relationships) ? relationships : []).slice(0, 24).forEach((record) => {
    const name = normalizeName(record?.name || record?.character || record?.target);
    if (!name || name === protagonist) return;
    const detail = [record?.relationship, record?.relation, record?.status, record?.detail, record?.notes]
      .filter(Boolean).join(' ');
    const indirect = record?.encountered === false || INDIRECT_PATTERN.test(detail);
    addNode(name, {
      type: 'character',
      direct: !indirect,
      detail: cleanLabel(detail),
      role: record?.role || record?.identity || record?.title || ''
    });
    addEdge(protagonist, name, detail || record?.role || '已建立联系', indirect);
  });

  extractRelationshipEdges(relationshipStatus).forEach((edge) => {
    addNode(edge.source, { type: edge.source === protagonist ? 'protagonist' : 'character', direct: true });
    addNode(edge.target, { type: edge.target === protagonist ? 'protagonist' : 'character', direct: true });
    addEdge(edge.source, edge.target, edge.label, false);
  });

  (Array.isArray(factions) ? factions : []).slice(0, 10).forEach((record) => {
    const name = normalizeName(record?.name || record?.title || record?.faction);
    if (!name) return;
    addNode(name, {
      type: 'faction',
      direct: true,
      detail: cleanLabel(record?.detail || record?.description || record?.status || ''),
      role: '势力'
    });
    const related = normalizeName(record?.character || record?.leader || record?.owner);
    if (related && nodes.has(related)) addEdge(related, name, record?.relationship || '所属', false);
  });

  return { protagonist, nodes: [...nodes.values()].slice(0, 25), edges: edges.slice(0, 36) };
}

function relationTypeLabel(type) {
  return ({
    INTERACTED_WITH: '已互动',
    KNOWS: '知晓',
    TRUSTS: '信任',
    HOSTILE_TO: '敌对',
    MEMBER_OF: '所属',
    OWES: '亏欠',
    LOCATED_AT: '位于',
    RELATED_TO: '关联'
  })[type] || String(type || '关联');
}

export function renderImmersiveRelationshipGraph(container, graph, { documentObject = globalThis.document } = {}) {
  if (!container || !documentObject) return null;
  const root = documentObject.createElement('section');
  root.className = 'immersive-relationship-graph';
  const heading = documentObject.createElement('header');
  heading.className = 'immersive-relationship-graph-heading';
  const title = documentObject.createElement('h4');
  title.textContent = '人物关系图';
  const hint = documentObject.createElement('span');
  hint.textContent = '实线为已接触 · 虚线为间接关联';
  heading.append(title, hint);
  root.append(heading);

  if (!graph?.nodes?.length || graph.nodes.length <= 1) {
    const empty = documentObject.createElement('p');
    empty.className = 'immersive-relationship-graph-empty';
    empty.textContent = '尚未形成可绘制的人物联系。角色实际登场后会在这里建立节点。';
    root.append(empty);
    container.append(root);
    return root;
  }

  const width = 680;
  const height = Math.max(360, Math.min(520, 300 + graph.nodes.length * 10));
  const center = { x: width / 2, y: height / 2 };
  const svg = createSvgElement(documentObject, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', '当前人物与势力关系图');
  const positions = layoutGraph(graph.nodes, center, width, height);

  graph.edges.forEach((edge) => {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (!source || !target) return;
    const line = createSvgElement(documentObject, 'line');
    line.setAttribute('x1', source.x);
    line.setAttribute('y1', source.y);
    line.setAttribute('x2', target.x);
    line.setAttribute('y2', target.y);
    line.classList?.add('immersive-graph-edge');
    if (edge.indirect) line.classList?.add('is-indirect');
    const lineTitle = createSvgElement(documentObject, 'title');
    lineTitle.textContent = `${edge.source} 与 ${edge.target}${edge.label ? `：${edge.label}` : ''}`;
    line.append(lineTitle);
    svg.append(line);
  });

  const detail = documentObject.createElement('div');
  detail.className = 'immersive-relationship-graph-detail';
  detail.textContent = '选择节点可查看身份与关系摘要。';
  graph.nodes.forEach((node) => {
    const point = positions.get(node.id);
    if (!point) return;
    const group = createSvgElement(documentObject, 'g');
    group.classList?.add('immersive-graph-node', `is-${node.type || 'character'}`);
    if (node.direct === false) group.classList?.add('is-indirect');
    group.setAttribute('transform', `translate(${point.x} ${point.y})`);
    group.setAttribute('tabindex', '0');
    group.setAttribute('role', 'button');
    group.setAttribute('aria-label', `${node.label}${node.role ? `，${node.role}` : ''}`);
    const shape = createSvgElement(documentObject, node.type === 'faction' ? 'rect' : 'circle');
    if (node.type === 'faction') {
      shape.setAttribute('x', '-50');
      shape.setAttribute('y', '-22');
      shape.setAttribute('width', '100');
      shape.setAttribute('height', '44');
      shape.setAttribute('rx', '9');
    } else {
      shape.setAttribute('r', node.type === 'protagonist' ? '31' : '25');
    }
    const label = createSvgElement(documentObject, 'text');
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('dominant-baseline', 'central');
    label.textContent = truncateLabel(node.label, node.type === 'faction' ? 8 : 6);
    group.append(shape, label);
    const showDetail = () => {
      const related = graph.edges
        .filter((edge) => edge.source === node.id || edge.target === node.id)
        .map((edge) => `${edge.source === node.id ? edge.target : edge.source}${edge.label ? ` · ${edge.label}` : ''}`)
        .join('；');
      detail.textContent = [node.label, node.role, node.detail, related].filter(Boolean).join('｜') || node.label;
    };
    group.addEventListener?.('click', showDetail);
    group.addEventListener?.('focus', showDetail);
    svg.append(group);
  });

  root.append(svg, detail);
  container.append(root);
  return root;
}

function collectPanelNames(text) {
  const names = new Set();
  const source = String(text || '');
  const statusPattern = new RegExp(`[『【\\[]\\s*(${NAME_PATTERN}?)(?:[·\\s]*(?:(?:主角|角色)[·\\s]*)?(?:状态|档案))\\s*[』】\\]]`, 'g');
  let match;
  while ((match = statusPattern.exec(source)) !== null) names.add(normalizeName(match[1]));
  extractRelationshipEdges(source).forEach((edge) => {
    names.add(edge.source);
    names.add(edge.target);
  });
  const presentMatch = source.match(/在场人物\s*[:：]\s*([^\n]+)/);
  if (presentMatch) {
    presentMatch[1].split(/[、，,／/与和]/).map(normalizeName).filter(Boolean).forEach((name) => names.add(name));
  }
  return [...names].filter(Boolean);
}

function collectCatalogMembers(value) {
  const members = [];
  const pattern = /(?:^|[。；;\n])\s*([\u3400-\u9fffA-Za-z·]{2,16})\s*[：:]\s*([^。；;\n]{2,160})/g;
  let match;
  while ((match = pattern.exec(String(value || ''))) !== null) {
    members.push({ name: normalizeName(match[1]), role: '设定角色', description: match[2].trim() });
  }
  return members;
}

function extractRelationshipEdges(value) {
  const edges = [];
  const pattern = new RegExp(`(${NAME_PATTERN})\\s*(↔|→|←|--?>)\\s*(${NAME_PATTERN})\\s*[:：]?\\s*([^\\n；;]{0,80})`, 'g');
  let match;
  while ((match = pattern.exec(String(value || ''))) !== null) {
    const left = normalizeName(match[1]);
    const right = normalizeName(match[3]);
    edges.push({
      source: match[2] === '←' ? right : left,
      target: match[2] === '←' ? left : right,
      label: cleanLabel(match[4])
    });
  }
  return edges;
}

function layoutGraph(nodes, center, width, height) {
  const positions = new Map();
  const protagonist = nodes.find((node) => node.type === 'protagonist') || nodes[0];
  positions.set(protagonist.id, center);
  const satellites = nodes.filter((node) => node !== protagonist);
  satellites.forEach((node, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(1, satellites.length);
    const ring = index % 2 === 0 ? 0.78 : 1;
    positions.set(node.id, {
      x: center.x + Math.cos(angle) * Math.min(width * 0.39, 265) * ring,
      y: center.y + Math.sin(angle) * Math.min(height * 0.36, 170) * ring
    });
  });
  return positions;
}

function createSvgElement(documentObject, name) {
  return documentObject.createElementNS
    ? documentObject.createElementNS('http://www.w3.org/2000/svg', name)
    : documentObject.createElement(name);
}

function normalizeName(value) {
  return String(value || '').replace(/^[『【\[「“'\s]+|[』】\]」”'\s]+$/g, '').trim();
}

function cleanLabel(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 180);
}

function truncateLabel(value, maxLength) {
  const text = String(value || '');
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
