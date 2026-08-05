import crypto from 'node:crypto';

const DEFAULT_MAX_UPLOAD_BYTES = 96 * 1024 * 1024;
const DEFAULT_TTL_MS = 20 * 60 * 1000;
const DEFAULT_MAX_PENDING = 6;

export class ImportUploadService {
  constructor({
    now = () => Date.now(),
    maxUploadBytes = DEFAULT_MAX_UPLOAD_BYTES,
    ttlMs = DEFAULT_TTL_MS,
    maxPending = DEFAULT_MAX_PENDING
  } = {}) {
    this.now = now;
    this.maxUploadBytes = maxUploadBytes;
    this.ttlMs = ttlMs;
    this.maxPending = maxPending;
    this.uploads = new Map();
  }

  stage({ fileName, mimeType, bytes, source = {} }) {
    const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
    if (!body.length) throw createUploadError('IMPORT_UPLOAD_EMPTY');
    if (body.length > this.maxUploadBytes) throw createUploadError('IMPORT_SOURCE_FILE_TOO_LARGE');

    this.cleanup();
    while (this.uploads.size >= this.maxPending) {
      const oldestId = this.uploads.keys().next().value;
      this.uploads.delete(oldestId);
    }

    const uploadId = crypto.randomUUID();
    const createdAt = this.now();
    const record = {
      uploadId,
      fileName: String(fileName || 'import.bin').slice(0, 240),
      mimeType: String(mimeType || 'application/octet-stream').slice(0, 120),
      bytes: Buffer.from(body),
      source: structuredClone(source || {}),
      size: body.length,
      createdAt,
      expiresAt: createdAt + this.ttlMs
    };
    this.uploads.set(uploadId, record);
    return summarizeUpload(record);
  }

  get(uploadId) {
    this.cleanup();
    const record = this.uploads.get(String(uploadId || ''));
    if (!record) return null;
    return {
      ...summarizeUpload(record),
      source: structuredClone(record.source),
      payload: {
        fileName: record.fileName,
        mimeType: record.mimeType,
        data: record.bytes
      }
    };
  }

  remove(uploadId) {
    return this.uploads.delete(String(uploadId || ''));
  }

  cleanup() {
    const timestamp = this.now();
    for (const [uploadId, record] of this.uploads.entries()) {
      if (record.expiresAt <= timestamp) this.uploads.delete(uploadId);
    }
  }
}

function summarizeUpload(record) {
  return {
    uploadId: record.uploadId,
    fileName: record.fileName,
    mimeType: record.mimeType,
    size: record.size,
    createdAt: new Date(record.createdAt).toISOString(),
    expiresAt: new Date(record.expiresAt).toISOString()
  };
}

function createUploadError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
