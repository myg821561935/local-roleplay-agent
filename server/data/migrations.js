import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { APP_VERSION, DATA_SCHEMA_VERSION } from '../releaseInfo.js';
import { createDefaultMemory } from '../agent/memoryUpdater.js';
import { ensureSimulationMemory } from '../simulation/npcSimulation.js';

const SCHEMA_FILE = '.schema.json';

const migrations = [
  {
    id: '0001-v0.1-release-baseline',
    from: 0,
    to: 1,
    async up({ dataDir }) {
      await Promise.all([
        mkdir(path.join(dataDir, 'config'), { recursive: true }),
        mkdir(path.join(dataDir, 'sessions'), { recursive: true }),
        mkdir(path.join(dataDir, 'exports'), { recursive: true })
      ]);
      await validateJsonFiles(dataDir);
    }
  },
  {
    id: '0002-v0.2-resource-library',
    from: 1,
    to: 2,
    async up({ dataDir }) {
      await Promise.all([
        mkdir(path.join(dataDir, 'library', 'resources'), { recursive: true }),
        mkdir(path.join(dataDir, 'library', 'packs'), { recursive: true })
      ]);
      await validateJsonFiles(dataDir);
    }
  },
  {
    id: '0003-v0.4-world-simulation',
    from: 2,
    to: 3,
    async up({ dataDir }) {
      await validateJsonFiles(dataDir);
      const sessionDir = path.join(dataDir, 'sessions');
      let sessionFiles = [];
      try {
        sessionFiles = (await readdir(sessionDir, { withFileTypes: true }))
          .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
          .map((entry) => path.join(sessionDir, entry.name));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      for (const sessionFile of sessionFiles) {
        const session = JSON.parse(await readFile(sessionFile, 'utf8'));
        if (!isPlainObject(session)) throw new Error(`DATA_SESSION_INVALID:${path.basename(sessionFile)}`);
        const defaults = createDefaultMemory();
        const existingMemory = isPlainObject(session.memory) ? session.memory : {};
        session.memory = ensureSimulationMemory({
          ...defaults,
          ...existingMemory,
          worldState: isPlainObject(existingMemory.worldState)
            ? existingMemory.worldState
            : defaults.worldState,
          eventLedger: Array.isArray(existingMemory.eventLedger) ? existingMemory.eventLedger : []
        });
        session.memory.worldStateBaseline = isPlainObject(existingMemory.worldStateBaseline)
          ? structuredClone(existingMemory.worldStateBaseline)
          : structuredClone(session.memory.worldState);
        session.memory.simulationBaseline = isPlainObject(existingMemory.simulationBaseline)
          ? structuredClone(existingMemory.simulationBaseline)
          : structuredClone(session.memory.simulation);
        session.memory.actionCheckpointMessageId = String(existingMemory.actionCheckpointMessageId || '');
        await writeJsonAtomic(sessionFile, session);
      }
    }
  }
];

export async function migrateData({ rootDir = process.cwd(), now = () => new Date() } = {}) {
  const dataDir = path.resolve(rootDir, 'data');
  await mkdir(dataDir, { recursive: true });

  const existing = await readSchemaMetadata(dataDir);
  let currentVersion = normalizeVersion(existing.schemaVersion);
  if (currentVersion > DATA_SCHEMA_VERSION) {
    throw new Error(`DATA_SCHEMA_NEWER_THAN_APP:${currentVersion}>${DATA_SCHEMA_VERSION}`);
  }

  const history = Array.isArray(existing.migrations) ? [...existing.migrations] : [];
  const applied = [];
  while (currentVersion < DATA_SCHEMA_VERSION) {
    const migration = migrations.find((candidate) => candidate.from === currentVersion);
    if (!migration) throw new Error(`DATA_MIGRATION_PATH_MISSING:${currentVersion}`);

    await migration.up({ rootDir: path.resolve(rootDir), dataDir });
    const appliedAt = now().toISOString();
    history.push({ id: migration.id, from: migration.from, to: migration.to, appliedAt });
    applied.push(migration.id);
    currentVersion = migration.to;
    await writeSchemaMetadata(dataDir, {
      schemaVersion: currentVersion,
      appVersion: APP_VERSION,
      updatedAt: appliedAt,
      migrations: history
    });
  }

  return {
    currentVersion,
    targetVersion: DATA_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    applied
  };
}

export async function readDataSchemaStatus(rootDir = process.cwd()) {
  const dataDir = path.resolve(rootDir, 'data');
  const metadata = await readSchemaMetadata(dataDir);
  return {
    currentVersion: normalizeVersion(metadata.schemaVersion),
    targetVersion: DATA_SCHEMA_VERSION,
    appVersion: String(metadata.appVersion || ''),
    updatedAt: String(metadata.updatedAt || ''),
    ready: normalizeVersion(metadata.schemaVersion) === DATA_SCHEMA_VERSION
  };
}

async function readSchemaMetadata(dataDir) {
  try {
    const raw = await readFile(path.join(dataDir, SCHEMA_FILE), 'utf8');
    const value = JSON.parse(raw);
    if (!isPlainObject(value)) throw new Error('DATA_SCHEMA_METADATA_INVALID');
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    if (error instanceof SyntaxError) throw new Error('DATA_SCHEMA_METADATA_INVALID');
    throw error;
  }
}

async function writeSchemaMetadata(dataDir, value) {
  await writeJsonAtomic(path.join(dataDir, SCHEMA_FILE), value);
}

async function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tempPath, filePath);
}

async function validateJsonFiles(dataDir) {
  for (const filePath of await listFiles(dataDir)) {
    if (!filePath.endsWith('.json') || path.basename(filePath) === SCHEMA_FILE) continue;
    try {
      JSON.parse(await readFile(filePath, 'utf8'));
    } catch (error) {
      if (error instanceof SyntaxError) {
        const relativePath = path.relative(dataDir, filePath);
        throw new Error(`DATA_JSON_INVALID:${relativePath}`);
      }
      throw error;
    }
  }
}

async function listFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(filePath));
    else if (entry.isFile()) files.push(filePath);
    else if (entry.isSymbolicLink()) throw new Error(`DATA_SYMLINK_UNSUPPORTED:${filePath}`);
  }
  return files;
}

function normalizeVersion(value) {
  const number = Number(value || 0);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
