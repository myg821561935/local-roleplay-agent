import crypto from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { migrateData } from '../data/migrations.js';
import { APP_NAME, APP_VERSION, DATA_SCHEMA_VERSION } from '../releaseInfo.js';

const BACKUP_FORMAT = 'local-roleplay-agent-backup';
const BACKUP_FORMAT_VERSION = 1;
const MAX_BACKUP_BYTES = 256 * 1024 * 1024;
const MAX_BACKUP_FILES = 10_000;
const BACKUP_ID_PATTERN = /^backup-[0-9TZ]+-[a-f0-9]{8}$/;

export class BackupError extends Error {
  constructor(code, statusCode = 400) {
    super(code);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class BackupService {
  constructor({ rootDir = process.cwd(), now = () => new Date() } = {}) {
    this.rootDir = path.resolve(rootDir);
    this.dataDir = path.join(this.rootDir, 'data');
    this.backupDir = path.join(this.rootDir, 'backups');
    this.now = now;
    this.busy = false;
  }

  async listBackups() {
    await mkdir(this.backupDir, { recursive: true });
    const names = await readdir(this.backupDir);
    const backups = [];
    let invalidCount = 0;

    for (const name of names.filter((value) => value.endsWith('.json'))) {
      try {
        const payload = JSON.parse(await readFile(path.join(this.backupDir, name), 'utf8'));
        validateBackupPayload(payload, { verifyContents: false });
        backups.push(summarizeBackup(payload));
      } catch {
        invalidCount += 1;
      }
    }

    backups.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return { backups, invalidCount };
  }

  async createBackup({ reason = 'manual', includePaths } = {}) {
    return this.runExclusive(() => this.createBackupInternal({ reason, includePaths }));
  }

  async restoreBackup(backupId) {
    return this.runExclusive(async () => {
      const payload = await this.readBackup(backupId);
      if (backupScope(payload) === 'selected') {
        return this.restoreSelectedBackupInternal(payload, backupId);
      }
      const safetyBackup = await this.createBackupInternal({ reason: `pre-restore:${backupId}` });
      const restoreId = crypto.randomUUID();
      const stagingRoot = path.join(this.rootDir, `.data-restore-${restoreId}`);
      const stagingDataDir = path.join(stagingRoot, 'data');
      const rollbackDir = path.join(this.rootDir, `.data-rollback-${restoreId}`);
      let currentMoved = false;
      let restoredMoved = false;

      try {
        await writeBackupFiles(stagingDataDir, payload.files);
        const migration = await migrateData({ rootDir: stagingRoot, now: this.now });

        if (await pathExists(this.dataDir)) {
          await rename(this.dataDir, rollbackDir);
          currentMoved = true;
        }
        await rename(stagingDataDir, this.dataDir);
        restoredMoved = true;
        const result = {
          restored: summarizeBackup(payload),
          safetyBackup,
          dataSchemaVersion: migration.currentVersion,
          restartRecommended: true
        };

        if (currentMoved) await rm(rollbackDir, { recursive: true, force: true }).catch(() => {});
        await rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
        return result;
      } catch (error) {
        if (restoredMoved) await rm(this.dataDir, { recursive: true, force: true }).catch(() => {});
        if (currentMoved) await rename(rollbackDir, this.dataDir).catch(() => {});
        await rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
        if (error instanceof BackupError) throw error;
        throw new BackupError('BACKUP_RESTORE_FAILED', 500);
      }
    });
  }

  async restoreSelectedBackupInternal(payload, backupId) {
    if (Number(payload.dataSchemaVersion || 0) !== DATA_SCHEMA_VERSION) {
      throw new BackupError('BACKUP_SCOPED_SCHEMA_MISMATCH');
    }
    const targetPaths = selectedBackupPaths(payload);
    const safetyBackup = await this.createBackupInternal({
      reason: `pre-restore:${backupId}`,
      includePaths: targetPaths
    });
    const rollback = await captureCurrentFiles(this.dataDir, targetPaths);

    try {
      await applySelectedBackup(this.dataDir, payload);
      return {
        restored: summarizeBackup(payload),
        safetyBackup,
        dataSchemaVersion: DATA_SCHEMA_VERSION,
        restartRecommended: true
      };
    } catch (error) {
      await restoreCapturedFiles(this.dataDir, rollback).catch(() => {});
      if (error instanceof BackupError) throw error;
      throw new BackupError('BACKUP_RESTORE_FAILED', 500);
    }
  }

  async getBackupFile(backupId) {
    const payload = await this.readBackup(backupId);
    return {
      filePath: this.backupPath(backupId),
      fileName: `${payload.id}.json`,
      summary: summarizeBackup(payload)
    };
  }

  async createBackupInternal({ reason, includePaths } = {}) {
    await migrateData({ rootDir: this.rootDir, now: this.now });
    await mkdir(this.backupDir, { recursive: true });
    const scope = Array.isArray(includePaths) ? 'selected' : 'full';
    const { files, missingPaths } = await collectBackupFiles(this.dataDir, includePaths);
    const createdAt = this.now().toISOString();
    const id = createBackupId(createdAt);
    const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
    const payload = {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      id,
      app: APP_NAME,
      appVersion: APP_VERSION,
      dataSchemaVersion: DATA_SCHEMA_VERSION,
      createdAt,
      reason: String(reason || 'manual').slice(0, 120),
      scope,
      fileCount: files.length,
      totalBytes,
      containsSecrets: files.some((file) => file.path === 'config/providers.local.json'),
      checksum: backupChecksum(files),
      ...(scope === 'selected' ? {
        missingPaths,
        selectionChecksum: selectedBackupChecksum(files, missingPaths)
      } : {}),
      files
    };
    validateBackupPayload(payload);
    await writeAtomic(this.backupPath(id), `${JSON.stringify(payload, null, 2)}\n`);
    return summarizeBackup(payload);
  }

  async readBackup(backupId) {
    const filePath = this.backupPath(backupId);
    let payload;
    try {
      payload = JSON.parse(await readFile(filePath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') throw new BackupError('BACKUP_NOT_FOUND', 404);
      if (error instanceof SyntaxError) throw new BackupError('BACKUP_INVALID_JSON');
      throw error;
    }
    validateBackupPayload(payload);
    if (payload.id !== backupId) throw new BackupError('BACKUP_ID_MISMATCH');
    return payload;
  }

  backupPath(backupId) {
    const id = String(backupId || '');
    if (!BACKUP_ID_PATTERN.test(id)) throw new BackupError('BACKUP_INVALID_ID');
    return path.join(this.backupDir, `${id}.json`);
  }

  async runExclusive(action) {
    if (this.busy) throw new BackupError('BACKUP_OPERATION_IN_PROGRESS', 409);
    this.busy = true;
    try {
      return await action();
    } finally {
      this.busy = false;
    }
  }
}

async function collectBackupFiles(dataDir, includePaths) {
  const files = [];
  const missingPaths = [];
  const collectFile = async (filePath) => {
    if (filePath.endsWith('.tmp')) return;
    const content = await readFile(filePath);
    const relativePath = toPortablePath(path.relative(dataDir, filePath));
    files.push({
      path: relativePath,
      bytes: content.byteLength,
      sha256: sha256(content),
      contentBase64: content.toString('base64')
    });
  };

  if (Array.isArray(includePaths)) {
    const selectedPaths = uniqueRelativePaths(includePaths);
    if (!selectedPaths.length) throw new BackupError('BACKUP_EMPTY_SCOPE');
    for (const relativePath of selectedPaths) {
      const filePath = path.resolve(dataDir, relativePath);
      if (!isPathInside(filePath, dataDir)) throw new BackupError('BACKUP_PATH_TRAVERSAL');
      try {
        const fileStat = await stat(filePath);
        if (!fileStat.isFile()) throw new BackupError('BACKUP_SCOPE_FILE_REQUIRED');
        await collectFile(filePath);
      } catch (error) {
        if (error.code === 'ENOENT') missingPaths.push(relativePath);
        else throw error;
      }
    }
  } else {
    await walk(dataDir, collectFile);
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  missingPaths.sort((left, right) => left.localeCompare(right));
  enforceBackupLimits(files);
  return { files, missingPaths };
}

async function walk(directory, visitFile) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(filePath, visitFile);
    else if (entry.isFile()) await visitFile(filePath);
    else if (entry.isSymbolicLink()) throw new BackupError('BACKUP_SYMLINK_UNSUPPORTED');
  }
}

function validateBackupPayload(payload, { verifyContents = true } = {}) {
  if (!payload || payload.format !== BACKUP_FORMAT || payload.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new BackupError('BACKUP_FORMAT_UNSUPPORTED');
  }
  if (!BACKUP_ID_PATTERN.test(String(payload.id || ''))) throw new BackupError('BACKUP_INVALID_ID');
  if (!Array.isArray(payload.files)) throw new BackupError('BACKUP_FILES_INVALID');
  const scope = backupScope(payload);
  if (!['full', 'selected'].includes(scope)) throw new BackupError('BACKUP_SCOPE_INVALID');
  if (Number(payload.dataSchemaVersion || 0) > DATA_SCHEMA_VERSION) {
    throw new BackupError('BACKUP_SCHEMA_NEWER_THAN_APP');
  }

  const seen = new Set();
  let totalBytes = 0;
  for (const file of payload.files) {
    const relativePath = validateRelativePath(file?.path);
    if (seen.has(relativePath)) throw new BackupError('BACKUP_DUPLICATE_PATH');
    seen.add(relativePath);
    const bytes = Number(file.bytes);
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new BackupError('BACKUP_FILE_SIZE_INVALID');
    totalBytes += bytes;
    if (verifyContents) {
      const content = Buffer.from(String(file.contentBase64 || ''), 'base64');
      if (content.byteLength !== bytes || sha256(content) !== file.sha256) {
        throw new BackupError('BACKUP_CHECKSUM_MISMATCH');
      }
    }
  }
  const missingPaths = Array.isArray(payload.missingPaths)
    ? uniqueRelativePaths(payload.missingPaths)
    : [];
  if (scope === 'selected') {
    if (missingPaths.length !== (payload.missingPaths || []).length) {
      throw new BackupError('BACKUP_SCOPE_PATHS_INVALID');
    }
    if (missingPaths.some((relativePath) => seen.has(relativePath))) {
      throw new BackupError('BACKUP_SCOPE_PATHS_INVALID');
    }
    if (selectedBackupChecksum(payload.files, missingPaths) !== payload.selectionChecksum) {
      throw new BackupError('BACKUP_CHECKSUM_MISMATCH');
    }
  } else if (missingPaths.length) {
    throw new BackupError('BACKUP_SCOPE_PATHS_INVALID');
  }
  enforceBackupLimits(payload.files, totalBytes);
  if (Number(payload.fileCount) !== payload.files.length || Number(payload.totalBytes) !== totalBytes) {
    throw new BackupError('BACKUP_MANIFEST_MISMATCH');
  }
  if (backupChecksum(payload.files) !== payload.checksum) throw new BackupError('BACKUP_CHECKSUM_MISMATCH');
}

async function writeBackupFiles(dataDir, files) {
  await mkdir(dataDir, { recursive: true });
  for (const file of files) {
    const relativePath = validateRelativePath(file.path);
    const targetPath = path.resolve(dataDir, relativePath);
    if (!isPathInside(targetPath, dataDir)) throw new BackupError('BACKUP_PATH_TRAVERSAL');
    const content = Buffer.from(file.contentBase64, 'base64');
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content);
  }
}

function summarizeBackup(payload) {
  return {
    id: payload.id,
    appVersion: payload.appVersion,
    dataSchemaVersion: Number(payload.dataSchemaVersion || 0),
    createdAt: payload.createdAt,
    reason: payload.reason,
    scope: backupScope(payload),
    fileCount: Number(payload.fileCount || 0),
    totalBytes: Number(payload.totalBytes || 0),
    containsSecrets: payload.containsSecrets === true,
    checksum: payload.checksum
  };
}

function createBackupId(createdAt) {
  const timestamp = createdAt.replace(/[-:.]/g, '');
  return `backup-${timestamp}-${crypto.randomUUID().slice(0, 8)}`;
}

function validateRelativePath(value) {
  const relativePath = toPortablePath(String(value || ''));
  if (!relativePath || relativePath.startsWith('/') || relativePath.includes('\0') || relativePath.includes('\\')) {
    throw new BackupError('BACKUP_PATH_INVALID');
  }
  const normalized = path.posix.normalize(relativePath);
  if (normalized === '..' || normalized.startsWith('../') || normalized !== relativePath) {
    throw new BackupError('BACKUP_PATH_TRAVERSAL');
  }
  return relativePath;
}

function backupChecksum(files) {
  const manifest = files.map((file) => ({
    path: file.path,
    bytes: Number(file.bytes),
    sha256: file.sha256
  }));
  return sha256(Buffer.from(JSON.stringify(manifest)));
}

function selectedBackupChecksum(files, missingPaths) {
  return sha256(Buffer.from(JSON.stringify({
    checksum: backupChecksum(files),
    missingPaths
  })));
}

function backupScope(payload) {
  return payload?.scope === undefined ? 'full' : String(payload.scope);
}

function selectedBackupPaths(payload) {
  return uniqueRelativePaths([
    ...(payload.files || []).map((file) => file.path),
    ...(payload.missingPaths || [])
  ]);
}

function uniqueRelativePaths(values) {
  return [...new Set((values || []).map(validateRelativePath))]
    .sort((left, right) => left.localeCompare(right));
}

async function captureCurrentFiles(dataDir, relativePaths) {
  const captured = new Map();
  for (const relativePath of uniqueRelativePaths(relativePaths)) {
    const filePath = path.resolve(dataDir, relativePath);
    if (!isPathInside(filePath, dataDir)) throw new BackupError('BACKUP_PATH_TRAVERSAL');
    try {
      captured.set(relativePath, await readFile(filePath));
    } catch (error) {
      if (error.code === 'ENOENT') captured.set(relativePath, null);
      else throw error;
    }
  }
  return captured;
}

async function restoreCapturedFiles(dataDir, captured) {
  for (const [relativePath, content] of captured) {
    const targetPath = path.resolve(dataDir, relativePath);
    if (content === null) await rm(targetPath, { force: true });
    else await writeAtomic(targetPath, content);
  }
}

async function applySelectedBackup(dataDir, payload) {
  for (const file of payload.files) {
    const relativePath = validateRelativePath(file.path);
    const targetPath = path.resolve(dataDir, relativePath);
    if (!isPathInside(targetPath, dataDir)) throw new BackupError('BACKUP_PATH_TRAVERSAL');
    await writeAtomic(targetPath, Buffer.from(file.contentBase64, 'base64'));
  }
  for (const relativePath of payload.missingPaths || []) {
    const targetPath = path.resolve(dataDir, validateRelativePath(relativePath));
    if (!isPathInside(targetPath, dataDir)) throw new BackupError('BACKUP_PATH_TRAVERSAL');
    await rm(targetPath, { force: true });
  }
}

function enforceBackupLimits(files, knownTotal) {
  if (files.length > MAX_BACKUP_FILES) throw new BackupError('BACKUP_TOO_MANY_FILES');
  const total = knownTotal ?? files.reduce((sum, file) => sum + Number(file.bytes || 0), 0);
  if (total > MAX_BACKUP_BYTES) throw new BackupError('BACKUP_TOO_LARGE');
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function toPortablePath(value) {
  return String(value).split(path.sep).join('/');
}

function isPathInside(filePath, parentDir) {
  const relative = path.relative(parentDir, filePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function writeAtomic(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  await writeFile(tempPath, content, Buffer.isBuffer(content) ? undefined : 'utf8');
  await rename(tempPath, filePath);
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
