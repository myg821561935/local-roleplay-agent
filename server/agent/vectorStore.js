/**
 * 纯 JS 内存向量数据库（cosine similarity, brute-force）
 * 不持久化，应用启动时从消息历史重建。
 */

export class VectorStore {
  constructor() {
    /** @type {Array<{id: string, vector: number[], metadata: any}>} */
    this.records = [];
  }

  /**
   * @param {string} id
   * @param {number[]} vector
   * @param {any} metadata
   */
  add(id, vector, metadata = {}) {
    if (!Array.isArray(vector) || vector.length === 0) return;
    const existingIndex = this.records.findIndex((r) => r.id === id);
    const record = { id, vector, metadata };
    if (existingIndex >= 0) {
      this.records[existingIndex] = record;
    } else {
      this.records.push(record);
    }
  }

  has(id) {
    return this.records.some((r) => r.id === id);
  }

  remove(id) {
    const index = this.records.findIndex((r) => r.id === id);
    if (index >= 0) this.records.splice(index, 1);
  }

  clear() {
    this.records = [];
  }

  get size() {
    return this.records.length;
  }

  /**
   * 暴力余弦相似度检索 top-K
   * @param {number[]} queryVector
   * @param {number} topK
   * @param {(metadata: any) => boolean} [filter]
   * @returns {Array<{id: string, score: number, metadata: any}>}
   */
  search(queryVector, topK = 5, filter) {
    if (!Array.isArray(queryVector) || queryVector.length === 0 || this.records.length === 0) {
      return [];
    }
    const queryNorm = norm(queryVector);
    if (queryNorm === 0) return [];

    const scored = [];
    for (const record of this.records) {
      if (filter && !filter(record.metadata)) continue;
      const score = cosine(queryVector, queryNorm, record.vector);
      if (score > 0) scored.push({ id: record.id, score, metadata: record.metadata });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.max(0, topK));
  }

  /**
   * 序列化为可持久化数据（虽然默认不持久化，但保留接口）
   */
  toJSON() {
    return this.records;
  }

  loadFromJSON(records) {
    if (!Array.isArray(records)) return;
    this.records = records.filter((r) => r && typeof r.id === 'string' && Array.isArray(r.vector));
  }
}

function norm(vec) {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
  return Math.sqrt(sum);
}

function cosine(queryVec, queryNorm, targetVec) {
  if (queryVec.length !== targetVec.length) return 0;
  let targetNorm = 0;
  let dot = 0;
  for (let i = 0; i < targetVec.length; i++) {
    dot += queryVec[i] * targetVec[i];
    targetNorm += targetVec[i] * targetVec[i];
  }
  targetNorm = Math.sqrt(targetNorm);
  if (targetNorm === 0) return 0;
  return dot / (queryNorm * targetNorm);
}
