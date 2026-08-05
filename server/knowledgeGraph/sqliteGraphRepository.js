import crypto from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  GRAPH_SCHEMA_VERSION,
  createGraphMutationProposal,
  normalizeGraphEdge,
  normalizeGraphNode
} from './graphContract.js';

const DEFAULT_NODE_LIMIT = 80;
const DEFAULT_EDGE_LIMIT = 160;

export class SQLiteGraphRepository {
  constructor({ filePath, now = () => new Date() } = {}) {
    if (!filePath) throw new TypeError('SQLite graph filePath is required');
    this.filePath = path.resolve(filePath);
    this.now = now;
    this.closed = false;
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.database = new DatabaseSync(this.filePath);
    this.database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL;');
    this.ensureSchema();
  }

  ensureSchema() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS graph_nodes (
        session_id TEXT NOT NULL,
        id TEXT NOT NULL,
        type TEXT NOT NULL,
        canonical_name TEXT NOT NULL,
        aliases_json TEXT NOT NULL DEFAULT '[]',
        properties_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        source_id TEXT NOT NULL DEFAULT '',
        authority INTEGER NOT NULL,
        visibility TEXT NOT NULL,
        confidence REAL NOT NULL,
        managed_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (session_id, id)
      );
      CREATE INDEX IF NOT EXISTS graph_nodes_name_idx
        ON graph_nodes(session_id, canonical_name, status);

      CREATE TABLE IF NOT EXISTS graph_edges (
        session_id TEXT NOT NULL,
        id TEXT NOT NULL,
        source_node_id TEXT NOT NULL,
        target_node_id TEXT NOT NULL,
        type TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        properties_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        evidence_source_id TEXT NOT NULL DEFAULT '',
        authority INTEGER NOT NULL,
        visibility TEXT NOT NULL,
        confidence REAL NOT NULL,
        valid_from_turn INTEGER NOT NULL DEFAULT 0,
        valid_to_turn INTEGER,
        managed_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (session_id, id),
        FOREIGN KEY (session_id, source_node_id) REFERENCES graph_nodes(session_id, id),
        FOREIGN KEY (session_id, target_node_id) REFERENCES graph_nodes(session_id, id)
      );
      CREATE INDEX IF NOT EXISTS graph_edges_source_idx
        ON graph_edges(session_id, source_node_id, status);
      CREATE INDEX IF NOT EXISTS graph_edges_target_idx
        ON graph_edges(session_id, target_node_id, status);

      CREATE TABLE IF NOT EXISTS graph_evidence (
        session_id TEXT NOT NULL,
        edge_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (session_id, edge_id, message_id),
        FOREIGN KEY (session_id, edge_id) REFERENCES graph_edges(session_id, id)
      );

      CREATE TABLE IF NOT EXISTS graph_mutations (
        session_id TEXT NOT NULL,
        id TEXT NOT NULL,
        operation TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        authority INTEGER NOT NULL,
        decision TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        proposal_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (session_id, id)
      );
      CREATE INDEX IF NOT EXISTS graph_mutations_session_idx
        ON graph_mutations(session_id, created_at);

      CREATE TABLE IF NOT EXISTS graph_sessions (
        session_id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL,
        fingerprint TEXT NOT NULL,
        protagonist_id TEXT NOT NULL DEFAULT '',
        revision INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
    `);
  }

  syncSnapshot(snapshot) {
    const sessionId = requiredSessionId(snapshot?.sessionId);
    const previous = this.getSessionMetadata(sessionId);
    if (previous?.fingerprint === snapshot.fingerprint) return previous;
    const timestamp = this.now().toISOString();

    this.transaction(() => {
      this.database.prepare(`
        UPDATE graph_edges
        SET status = 'superseded', valid_to_turn = ?, updated_at = ?
        WHERE session_id = ? AND managed_by = 'session_snapshot' AND status != 'superseded'
      `).run(snapshot.turn, timestamp, sessionId);
      this.database.prepare(`
        UPDATE graph_nodes
        SET status = 'superseded', updated_at = ?
        WHERE session_id = ? AND managed_by = 'session_snapshot' AND status != 'superseded'
      `).run(timestamp, sessionId);

      for (const input of snapshot.nodes || []) this.upsertNode(sessionId, input, timestamp);
      for (const input of snapshot.edges || []) this.upsertEdge(sessionId, input, timestamp);

      const revision = Number(previous?.revision || 0) + 1;
      this.database.prepare(`
        INSERT INTO graph_sessions (
          session_id, schema_version, fingerprint, protagonist_id, revision, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          schema_version = excluded.schema_version,
          fingerprint = excluded.fingerprint,
          protagonist_id = excluded.protagonist_id,
          revision = excluded.revision,
          updated_at = excluded.updated_at
      `).run(
        sessionId,
        GRAPH_SCHEMA_VERSION,
        snapshot.fingerprint,
        snapshot.protagonistId || '',
        revision,
        timestamp
      );
      this.recordMutation(sessionId, {
        id: crypto.randomUUID(),
        operation: 'sync_snapshot',
        sourceKind: 'migration',
        authority: 200,
        decision: 'committed',
        reason: previous ? 'session-state-changed' : 'legacy-session-migration',
        proposal: {
          fingerprint: snapshot.fingerprint,
          nodeCount: snapshot.nodes?.length || 0,
          edgeCount: snapshot.edges?.length || 0,
          turn: snapshot.turn || 0
        }
      }, timestamp);
    });
    return this.getSessionMetadata(sessionId);
  }

  applyProposal(sessionIdValue, input) {
    const sessionId = requiredSessionId(sessionIdValue);
    const proposal = createGraphMutationProposal(input);
    const timestamp = this.now().toISOString();
    let decision = 'committed';
    let reason = proposal.reason;

    this.transaction(() => {
      const table = proposal.operation.endsWith('_node') ? 'graph_nodes' : 'graph_edges';
      const existing = this.database.prepare(
        `SELECT authority FROM ${table} WHERE session_id = ? AND id = ?`
      ).get(sessionId, proposal.payload.id);
      if (existing && Number(existing.authority) > proposal.authority) {
        decision = 'rejected';
        reason = reason || 'higher-authority-fact-exists';
      } else if (proposal.operation === 'upsert_node') {
        this.upsertNode(sessionId, { ...proposal.payload, managedBy: 'mutation' }, timestamp);
      } else if (proposal.operation === 'upsert_edge') {
        this.upsertEdge(sessionId, { ...proposal.payload, managedBy: 'mutation' }, timestamp);
      } else {
        this.database.prepare(`
          UPDATE ${table} SET status = 'superseded', updated_at = ?
          WHERE session_id = ? AND id = ?
        `).run(timestamp, sessionId, proposal.payload.id);
      }
      this.recordMutation(sessionId, {
        ...proposal,
        decision,
        reason,
        proposal
      }, timestamp);
    });
    return { proposal, decision, reason };
  }

  queryNeighborhood(sessionIdValue, {
    focusNodeId = '',
    depth = 2,
    view = 'player',
    nodeLimit = DEFAULT_NODE_LIMIT,
    edgeLimit = DEFAULT_EDGE_LIMIT
  } = {}) {
    const sessionId = requiredSessionId(sessionIdValue);
    const safeDepth = clampInteger(depth, 0, 4, 2);
    const safeNodeLimit = clampInteger(nodeLimit, 1, 250, DEFAULT_NODE_LIMIT);
    const safeEdgeLimit = clampInteger(edgeLimit, 1, 500, DEFAULT_EDGE_LIMIT);
    const director = view === 'director';
    const visibilitySql = director ? '' : " AND visibility = 'player'";
    const edgeVisibilitySql = director ? '' : " AND e.visibility = 'player'";
    const focus = String(focusNodeId || '').trim();
    let nodeRows;

    if (focus) {
      nodeRows = this.database.prepare(`
        WITH RECURSIVE reachable(id, depth, path) AS (
          SELECT ?, 0, ',' || ? || ','
          UNION ALL
          SELECT
            CASE WHEN e.source_node_id = reachable.id THEN e.target_node_id ELSE e.source_node_id END,
            reachable.depth + 1,
            reachable.path || CASE WHEN e.source_node_id = reachable.id THEN e.target_node_id ELSE e.source_node_id END || ','
          FROM reachable
          JOIN graph_edges e
            ON e.session_id = ?
           AND e.status = 'confirmed'
           AND (e.source_node_id = reachable.id OR e.target_node_id = reachable.id)
           ${edgeVisibilitySql}
          WHERE reachable.depth < ?
            AND instr(
              reachable.path,
              ',' || CASE WHEN e.source_node_id = reachable.id THEN e.target_node_id ELSE e.source_node_id END || ','
            ) = 0
        )
        SELECT DISTINCT n.*
        FROM graph_nodes n
        JOIN reachable ON reachable.id = n.id
        WHERE n.session_id = ? AND n.status = 'confirmed'${visibilitySql}
        ORDER BY n.authority DESC, n.canonical_name ASC
        LIMIT ?
      `).all(focus, focus, sessionId, safeDepth, sessionId, safeNodeLimit);
    } else {
      nodeRows = this.database.prepare(`
        SELECT * FROM graph_nodes
        WHERE session_id = ? AND status = 'confirmed'${visibilitySql}
        ORDER BY authority DESC, canonical_name ASC
        LIMIT ?
      `).all(sessionId, safeNodeLimit);
    }

    const nodeIds = nodeRows.map((row) => row.id);
    let edgeRows = [];
    if (nodeIds.length) {
      const placeholders = nodeIds.map(() => '?').join(', ');
      edgeRows = this.database.prepare(`
        SELECT e.* FROM graph_edges e
        WHERE e.session_id = ?
          AND e.status = 'confirmed'
          ${edgeVisibilitySql}
          AND e.source_node_id IN (${placeholders})
          AND e.target_node_id IN (${placeholders})
        ORDER BY e.authority DESC, e.updated_at DESC
        LIMIT ?
      `).all(sessionId, ...nodeIds, ...nodeIds, safeEdgeLimit);
    }

    return {
      nodes: nodeRows.map(decodeNode),
      edges: edgeRows.map((row) => decodeEdge(row, this.listEvidence(sessionId, row.id)))
    };
  }

  getSessionMetadata(sessionIdValue) {
    const sessionId = requiredSessionId(sessionIdValue);
    const row = this.database.prepare('SELECT * FROM graph_sessions WHERE session_id = ?').get(sessionId);
    return row ? {
      schemaVersion: row.schema_version,
      fingerprint: row.fingerprint,
      protagonistId: row.protagonist_id,
      revision: row.revision,
      updatedAt: row.updated_at
    } : null;
  }

  listMutations(sessionIdValue, { limit = 100 } = {}) {
    const sessionId = requiredSessionId(sessionIdValue);
    return this.database.prepare(`
      SELECT * FROM graph_mutations
      WHERE session_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(sessionId, clampInteger(limit, 1, 500, 100)).map((row) => ({
      id: row.id,
      operation: row.operation,
      sourceKind: row.source_kind,
      authority: row.authority,
      decision: row.decision,
      reason: row.reason,
      proposal: parseJson(row.proposal_json, {}),
      createdAt: row.created_at
    }));
  }

  close() {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }

  upsertNode(sessionId, input, timestamp) {
    const node = normalizeGraphNode(input);
    this.database.prepare(`
      INSERT INTO graph_nodes (
        session_id, id, type, canonical_name, aliases_json, properties_json,
        status, source_kind, source_id, authority, visibility, confidence,
        managed_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, id) DO UPDATE SET
        type = CASE WHEN excluded.authority >= graph_nodes.authority THEN excluded.type ELSE graph_nodes.type END,
        canonical_name = CASE WHEN excluded.authority >= graph_nodes.authority THEN excluded.canonical_name ELSE graph_nodes.canonical_name END,
        aliases_json = CASE WHEN excluded.authority >= graph_nodes.authority THEN excluded.aliases_json ELSE graph_nodes.aliases_json END,
        properties_json = CASE WHEN excluded.authority >= graph_nodes.authority THEN excluded.properties_json ELSE graph_nodes.properties_json END,
        status = 'confirmed',
        source_kind = CASE WHEN excluded.authority >= graph_nodes.authority THEN excluded.source_kind ELSE graph_nodes.source_kind END,
        source_id = CASE WHEN excluded.authority >= graph_nodes.authority THEN excluded.source_id ELSE graph_nodes.source_id END,
        authority = max(graph_nodes.authority, excluded.authority),
        visibility = CASE WHEN excluded.authority >= graph_nodes.authority THEN excluded.visibility ELSE graph_nodes.visibility END,
        confidence = max(graph_nodes.confidence, excluded.confidence),
        managed_by = excluded.managed_by,
        updated_at = excluded.updated_at
    `).run(
      sessionId, node.id, node.type, node.name, JSON.stringify(node.aliases), JSON.stringify(node.properties),
      node.status, node.sourceKind, node.sourceId, node.authority, node.visibility, node.confidence,
      node.managedBy, timestamp, timestamp
    );
    return node;
  }

  upsertEdge(sessionId, input, timestamp) {
    const edge = normalizeGraphEdge(input);
    this.database.prepare(`
      INSERT INTO graph_edges (
        session_id, id, source_node_id, target_node_id, type, label, properties_json,
        status, source_kind, evidence_source_id, authority, visibility, confidence,
        valid_from_turn, valid_to_turn, managed_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, id) DO UPDATE SET
        source_node_id = excluded.source_node_id,
        target_node_id = excluded.target_node_id,
        type = CASE WHEN excluded.authority >= graph_edges.authority THEN excluded.type ELSE graph_edges.type END,
        label = CASE WHEN excluded.authority >= graph_edges.authority THEN excluded.label ELSE graph_edges.label END,
        properties_json = CASE WHEN excluded.authority >= graph_edges.authority THEN excluded.properties_json ELSE graph_edges.properties_json END,
        status = 'confirmed',
        source_kind = CASE WHEN excluded.authority >= graph_edges.authority THEN excluded.source_kind ELSE graph_edges.source_kind END,
        evidence_source_id = CASE WHEN excluded.authority >= graph_edges.authority THEN excluded.evidence_source_id ELSE graph_edges.evidence_source_id END,
        authority = max(graph_edges.authority, excluded.authority),
        visibility = CASE WHEN excluded.authority >= graph_edges.authority THEN excluded.visibility ELSE graph_edges.visibility END,
        confidence = max(graph_edges.confidence, excluded.confidence),
        valid_from_turn = min(graph_edges.valid_from_turn, excluded.valid_from_turn),
        valid_to_turn = excluded.valid_to_turn,
        managed_by = excluded.managed_by,
        updated_at = excluded.updated_at
    `).run(
      sessionId, edge.id, edge.sourceId, edge.targetId, edge.type, edge.label, JSON.stringify(edge.properties),
      edge.status, edge.sourceKind, edge.evidenceSourceId, edge.authority, edge.visibility, edge.confidence,
      edge.validFromTurn, edge.validToTurn, edge.managedBy, timestamp, timestamp
    );
    for (const messageId of edge.evidenceMessageIds) {
      this.database.prepare(`
        INSERT OR IGNORE INTO graph_evidence (session_id, edge_id, message_id, created_at)
        VALUES (?, ?, ?, ?)
      `).run(sessionId, edge.id, messageId, timestamp);
    }
    return edge;
  }

  listEvidence(sessionId, edgeId) {
    return this.database.prepare(`
      SELECT message_id FROM graph_evidence
      WHERE session_id = ? AND edge_id = ?
      ORDER BY created_at ASC
    `).all(sessionId, edgeId).map((row) => row.message_id);
  }

  recordMutation(sessionId, record, timestamp) {
    this.database.prepare(`
      INSERT INTO graph_mutations (
        session_id, id, operation, source_kind, authority, decision, reason, proposal_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      record.id || crypto.randomUUID(),
      record.operation,
      record.sourceKind,
      record.authority,
      record.decision,
      record.reason || '',
      JSON.stringify(record.proposal || {}),
      timestamp
    );
  }

  transaction(callback) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = callback();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

function decodeNode(row) {
  return {
    id: row.id,
    type: row.type,
    name: row.canonical_name,
    label: row.canonical_name,
    aliases: parseJson(row.aliases_json, []),
    properties: parseJson(row.properties_json, {}),
    status: row.status,
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    authority: row.authority,
    visibility: row.visibility,
    confidence: row.confidence,
    updatedAt: row.updated_at
  };
}

function decodeEdge(row, evidenceMessageIds) {
  return {
    id: row.id,
    type: row.type,
    source: row.source_node_id,
    target: row.target_node_id,
    label: row.label,
    properties: parseJson(row.properties_json, {}),
    status: row.status,
    sourceKind: row.source_kind,
    sourceId: row.evidence_source_id,
    authority: row.authority,
    visibility: row.visibility,
    confidence: row.confidence,
    validFromTurn: row.valid_from_turn,
    validToTurn: row.valid_to_turn,
    evidenceMessageIds,
    updatedAt: row.updated_at
  };
}

function requiredSessionId(value) {
  const sessionId = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) throw new Error('Invalid session id');
  return sessionId;
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : fallback;
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
