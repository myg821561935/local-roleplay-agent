import crypto from 'node:crypto';

export const GRAPH_SCHEMA_VERSION = 1;

export const GRAPH_NODE_TYPES = Object.freeze({
  CHARACTER: 'Character',
  FACTION: 'Faction',
  LOCATION: 'Location',
  EVENT: 'Event',
  ITEM: 'Item',
  QUEST: 'Quest',
  KNOWLEDGE: 'Knowledge'
});

export const GRAPH_EDGE_TYPES = Object.freeze({
  INTERACTED_WITH: 'INTERACTED_WITH',
  KNOWS: 'KNOWS',
  TRUSTS: 'TRUSTS',
  HOSTILE_TO: 'HOSTILE_TO',
  MEMBER_OF: 'MEMBER_OF',
  OWES: 'OWES',
  LOCATED_AT: 'LOCATED_AT',
  WITNESSED: 'WITNESSED',
  KNOWS_SECRET: 'KNOWS_SECRET',
  RELATED_TO: 'RELATED_TO',
  INVOLVED_IN: 'INVOLVED_IN'
});

export const GRAPH_SOURCE_AUTHORITY = Object.freeze({
  role_card: 500,
  world_book: 500,
  user_confirmed: 400,
  dialogue: 300,
  world_state: 250,
  migration: 200,
  model_inference: 100
});

const NODE_TYPE_SET = new Set(Object.values(GRAPH_NODE_TYPES));
const EDGE_TYPE_SET = new Set(Object.values(GRAPH_EDGE_TYPES));
const SOURCE_KIND_SET = new Set(Object.keys(GRAPH_SOURCE_AUTHORITY));
const VISIBILITY_SET = new Set(['player', 'director']);
const STATUS_SET = new Set(['candidate', 'confirmed', 'superseded']);
const MUTATION_OPERATIONS = new Set(['upsert_node', 'upsert_edge', 'supersede_node', 'supersede_edge']);

export function normalizeEntityName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

export function graphNodeId(type, name) {
  const safeType = normalizeNodeType(type);
  const canonicalName = normalizeEntityName(name);
  if (!canonicalName) throw new GraphContractError('GRAPH_NODE_NAME_REQUIRED');
  return `${safeType.toLowerCase()}:${shortHash(`${safeType}:${canonicalKey(canonicalName)}`)}`;
}

export function graphEdgeId({ type, sourceId, targetId, discriminator = '' }) {
  const safeType = normalizeEdgeType(type);
  const source = requiredText(sourceId, 'GRAPH_EDGE_SOURCE_REQUIRED');
  const target = requiredText(targetId, 'GRAPH_EDGE_TARGET_REQUIRED');
  if (source === target) throw new GraphContractError('GRAPH_SELF_EDGE_UNSUPPORTED');
  return `edge:${shortHash([safeType, source, target, normalizeEntityName(discriminator)].join(':'))}`;
}

export function normalizeGraphNode(input = {}) {
  const type = normalizeNodeType(input.type);
  const name = normalizeEntityName(input.name || input.label || input.canonicalName);
  if (!name) throw new GraphContractError('GRAPH_NODE_NAME_REQUIRED');
  const sourceKind = normalizeSourceKind(input.sourceKind);
  return {
    id: String(input.id || graphNodeId(type, name)),
    type,
    name,
    aliases: uniqueStrings(input.aliases),
    properties: plainObject(input.properties),
    status: normalizeStatus(input.status),
    sourceKind,
    sourceId: normalizeEntityName(input.sourceId),
    authority: normalizeAuthority(input.authority, sourceKind),
    visibility: normalizeVisibility(input.visibility),
    confidence: normalizeConfidence(input.confidence),
    managedBy: normalizeEntityName(input.managedBy) || 'session_snapshot'
  };
}

export function normalizeGraphEdge(input = {}) {
  const type = normalizeEdgeType(input.type);
  const sourceId = requiredText(input.sourceId || input.from, 'GRAPH_EDGE_SOURCE_REQUIRED');
  const targetId = requiredText(input.targetId || input.to, 'GRAPH_EDGE_TARGET_REQUIRED');
  const sourceKind = normalizeSourceKind(input.sourceKind);
  return {
    id: String(input.id || graphEdgeId({
      type,
      sourceId,
      targetId,
      discriminator: input.discriminator || input.label
    })),
    type,
    sourceId,
    targetId,
    label: normalizeEntityName(input.label).slice(0, 240),
    properties: plainObject(input.properties),
    status: normalizeStatus(input.status),
    sourceKind,
    evidenceSourceId: normalizeEntityName(input.evidenceSourceId || input.sourceRecordId),
    authority: normalizeAuthority(input.authority, sourceKind),
    visibility: normalizeVisibility(input.visibility),
    confidence: normalizeConfidence(input.confidence),
    validFromTurn: normalizeTurn(input.validFromTurn),
    validToTurn: input.validToTurn === null || input.validToTurn === undefined
      ? null
      : normalizeTurn(input.validToTurn),
    evidenceMessageIds: uniqueStrings(input.evidenceMessageIds),
    managedBy: normalizeEntityName(input.managedBy) || 'session_snapshot'
  };
}

export function createGraphMutationProposal(input = {}) {
  const operation = String(input.operation || '').trim();
  if (!MUTATION_OPERATIONS.has(operation)) throw new GraphContractError('GRAPH_MUTATION_OPERATION_INVALID');
  const sourceKind = normalizeSourceKind(input.sourceKind);
  const payload = operation.endsWith('_node')
    ? normalizeGraphNode({ ...input.payload, sourceKind })
    : normalizeGraphEdge({ ...input.payload, sourceKind });
  return {
    id: String(input.id || crypto.randomUUID()),
    operation,
    sourceKind,
    authority: normalizeAuthority(input.authority, sourceKind),
    reason: normalizeEntityName(input.reason).slice(0, 240),
    proposedAt: normalizeIsoDate(input.proposedAt),
    payload
  };
}

export function buildSessionGraphSnapshot(session = {}, { now = () => new Date() } = {}) {
  const worldState = plainObject(session.memory?.worldState);
  const config = plainObject(session.config);
  const turn = Array.isArray(session.messages) ? session.messages.length : 0;
  const nodes = new Map();
  const edges = new Map();

  const addNode = (input) => {
    const node = normalizeGraphNode(input);
    const previous = nodes.get(node.id);
    if (!previous || node.authority >= previous.authority) {
      nodes.set(node.id, {
        ...previous,
        ...node,
        aliases: uniqueStrings([...(previous?.aliases || []), ...node.aliases]),
        properties: { ...(previous?.properties || {}), ...node.properties },
        visibility: previous?.visibility === 'player' || node.visibility === 'player' ? 'player' : 'director'
      });
    }
    return node.id;
  };
  const addEdge = (input) => {
    const edge = normalizeGraphEdge({ validFromTurn: turn, ...input });
    const previous = edges.get(edge.id);
    if (!previous || edge.authority >= previous.authority) edges.set(edge.id, edge);
    return edge.id;
  };

  const characterCard = plainObject(config.characterCard);
  const protagonistName = normalizeEntityName(
    worldState.protagonist?.name || characterCard.name || session.title || ''
  );
  let protagonistId = '';
  if (protagonistName) {
    protagonistId = addNode({
      type: GRAPH_NODE_TYPES.CHARACTER,
      name: protagonistName,
      sourceKind: characterCard.name ? 'role_card' : 'world_state',
      sourceId: characterCard.id || 'worldState.protagonist',
      properties: {
        protagonist: true,
        role: characterCard.role || worldState.protagonist?.role || '',
        realm: worldState.protagonist?.realm || '',
        traits: Array.isArray(worldState.protagonist?.traits) ? worldState.protagonist.traits : []
      }
    });
  }

  const characterIds = new Map();
  const addCharacter = (record, defaults = {}) => {
    const name = normalizeEntityName(record?.name || record?.character || record?.target);
    if (!name) return '';
    const id = addNode({
      type: GRAPH_NODE_TYPES.CHARACTER,
      name,
      aliases: record?.aliases,
      sourceKind: defaults.sourceKind || inferSourceKind(record),
      sourceId: record?.id || defaults.sourceId,
      visibility: record?.visibility,
      confidence: record?.confidence,
      properties: {
        role: record?.role || record?.identity || record?.title || '',
        description: record?.description || record?.detail || record?.notes || '',
        encountered: record?.encountered !== false,
        ...plainObject(defaults.properties)
      }
    });
    characterIds.set(canonicalKey(name), id);
    return id;
  };

  (Array.isArray(config.groupMembers) ? config.groupMembers : [])
    .filter((record) => record?.enabled !== false)
    .forEach((record) => addCharacter(record, { sourceKind: 'role_card', sourceId: record?.id || 'config.groupMembers' }));
  (Array.isArray(worldState.characters) ? worldState.characters : [])
    .forEach((record) => addCharacter(record));

  (Array.isArray(worldState.relationships) ? worldState.relationships : []).forEach((record) => {
    const targetId = addCharacter(record);
    if (!targetId || !protagonistId || targetId === protagonistId) return;
    const relationText = [record?.relationship, record?.relation, record?.status, record?.detail, record?.notes]
      .filter(Boolean).join(' ');
    const sourceKind = inferSourceKind(record);
    addEdge({
      type: inferRelationshipType(relationText, record?.encountered),
      sourceId: protagonistId,
      targetId,
      label: relationText || '已建立联系',
      sourceKind,
      evidenceSourceId: record?.id || 'worldState.relationships',
      visibility: record?.visibility,
      confidence: record?.confidence,
      evidenceMessageIds: record?.evidenceMessageIds || [record?.sourceMessageId].filter(Boolean),
      properties: { indirect: record?.encountered === false }
    });
  });

  (Array.isArray(worldState.factions) ? worldState.factions : []).forEach((record) => {
    const name = normalizeEntityName(record?.name || record?.title || record?.faction);
    if (!name) return;
    const factionId = addNode({
      type: GRAPH_NODE_TYPES.FACTION,
      name,
      sourceKind: inferSourceKind(record),
      sourceId: record?.id || 'worldState.factions',
      visibility: record?.visibility,
      properties: { description: record?.description || record?.detail || record?.status || '' }
    });
    const relatedName = normalizeEntityName(record?.character || record?.leader || record?.owner);
    const relatedId = characterIds.get(canonicalKey(relatedName))
      || (relatedName === protagonistName ? protagonistId : '');
    if (relatedId) {
      addEdge({
        type: GRAPH_EDGE_TYPES.MEMBER_OF,
        sourceId: relatedId,
        targetId: factionId,
        label: record?.relationship || '所属',
        sourceKind: inferSourceKind(record),
        evidenceSourceId: record?.id || 'worldState.factions',
        visibility: record?.visibility
      });
    }
  });

  const currentLocation = normalizeEntityName(worldState.location?.current);
  const knownPlaces = uniqueStrings([currentLocation, ...(worldState.location?.knownPlaces || [])]);
  knownPlaces.forEach((name) => addNode({
    type: GRAPH_NODE_TYPES.LOCATION,
    name,
    sourceKind: 'world_state',
    sourceId: 'worldState.location'
  }));
  if (protagonistId && currentLocation) {
    addEdge({
      type: GRAPH_EDGE_TYPES.LOCATED_AT,
      sourceId: protagonistId,
      targetId: graphNodeId(GRAPH_NODE_TYPES.LOCATION, currentLocation),
      label: '当前所在',
      sourceKind: 'world_state',
      evidenceSourceId: 'worldState.location'
    });
  }

  (Array.isArray(worldState.quests) ? worldState.quests : []).forEach((record) => {
    const name = normalizeEntityName(record?.title || record?.name || record?.id);
    if (!name) return;
    const questId = addNode({
      type: GRAPH_NODE_TYPES.QUEST,
      name,
      sourceKind: inferSourceKind(record),
      sourceId: record?.id || 'worldState.quests',
      visibility: record?.visibility,
      properties: plainObject(record)
    });
    if (protagonistId) addEdge({
      type: GRAPH_EDGE_TYPES.INVOLVED_IN,
      sourceId: protagonistId,
      targetId: questId,
      label: record?.status || '参与',
      sourceKind: inferSourceKind(record),
      evidenceSourceId: record?.id || 'worldState.quests',
      visibility: record?.visibility
    });
  });

  const normalizedNodes = [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id));
  const normalizedEdges = [...edges.values()].sort((left, right) => left.id.localeCompare(right.id));
  const fingerprint = crypto.createHash('sha256')
    .update(JSON.stringify({ nodes: normalizedNodes, edges: normalizedEdges }))
    .digest('hex');
  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    sessionId: requiredText(session.id || 'main', 'GRAPH_SESSION_ID_REQUIRED'),
    protagonistId,
    turn,
    generatedAt: now().toISOString(),
    fingerprint,
    nodes: normalizedNodes,
    edges: normalizedEdges
  };
}

export class GraphContractError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function inferRelationshipType(text, encountered) {
  const value = String(text || '');
  if (/敌|仇|敌对|追杀|憎恨/.test(value)) return GRAPH_EDGE_TYPES.HOSTILE_TO;
  if (/信任|信赖/.test(value)) return GRAPH_EDGE_TYPES.TRUSTS;
  if (/欠|债|恩情|人情/.test(value)) return GRAPH_EDGE_TYPES.OWES;
  if (/亲属|父|母|兄|弟|姐|妹|夫妻|恋人|血缘/.test(value)) return GRAPH_EDGE_TYPES.RELATED_TO;
  if (encountered === false) return GRAPH_EDGE_TYPES.KNOWS;
  return GRAPH_EDGE_TYPES.INTERACTED_WITH;
}

function inferSourceKind(record) {
  const raw = String(record?.sourceKind || record?.source || '').trim().toLowerCase().replaceAll('-', '_');
  if (SOURCE_KIND_SET.has(raw)) return raw;
  if (/role.?card|character.?card/.test(raw)) return 'role_card';
  if (/world.?book|lore/.test(raw)) return 'world_book';
  if (/user/.test(raw)) return 'user_confirmed';
  if (/model|extract|inference/.test(raw)) return 'model_inference';
  return 'world_state';
}

function normalizeNodeType(value) {
  const type = String(value || GRAPH_NODE_TYPES.KNOWLEDGE);
  if (!NODE_TYPE_SET.has(type)) throw new GraphContractError('GRAPH_NODE_TYPE_INVALID');
  return type;
}

function normalizeEdgeType(value) {
  const type = String(value || GRAPH_EDGE_TYPES.RELATED_TO).toUpperCase();
  if (!EDGE_TYPE_SET.has(type)) throw new GraphContractError('GRAPH_EDGE_TYPE_INVALID');
  return type;
}

function normalizeSourceKind(value) {
  const sourceKind = String(value || 'model_inference').trim().toLowerCase().replaceAll('-', '_');
  if (!SOURCE_KIND_SET.has(sourceKind)) throw new GraphContractError('GRAPH_SOURCE_KIND_INVALID');
  return sourceKind;
}

function normalizeAuthority(value, sourceKind) {
  const authority = Number(value);
  if (Number.isFinite(authority)) return Math.max(0, Math.min(1000, Math.floor(authority)));
  return GRAPH_SOURCE_AUTHORITY[sourceKind];
}

function normalizeVisibility(value) {
  const visibility = String(value || 'player').toLowerCase();
  return VISIBILITY_SET.has(visibility) ? visibility : 'player';
}

function normalizeStatus(value) {
  const status = String(value || 'confirmed').toLowerCase();
  return STATUS_SET.has(status) ? status : 'confirmed';
}

function normalizeConfidence(value) {
  const confidence = Number(value);
  return Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 1;
}

function normalizeTurn(value) {
  const turn = Number(value);
  return Number.isFinite(turn) ? Math.max(0, Math.floor(turn)) : 0;
}

function normalizeIsoDate(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function requiredText(value, code) {
  const text = String(value || '').trim();
  if (!text) throw new GraphContractError(code);
  return text;
}

function uniqueStrings(value) {
  const values = Array.isArray(value) ? value : [];
  return [...new Set(values.map(normalizeEntityName).filter(Boolean))].slice(0, 64);
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? structuredClone(value) : {};
}

function canonicalKey(value) {
  return normalizeEntityName(value).toLocaleLowerCase('zh-CN');
}

function shortHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24);
}
