import crypto from 'node:crypto';

const VOLATILE_FIELDS = new Set([
  'id',
  'assetId',
  'portrait',
  'updatedAt',
  'createdAt',
  'importedAt',
  'raw'
]);

export class ResourceConflictService {
  findConflicts(candidate, existingResources = [], { excludeId = '' } = {}) {
    const fingerprint = createFingerprint(candidate.payload);
    const conflicts = existingResources
      .filter((item) => item.id !== excludeId && item.kind === candidate.kind)
      .filter((item) => item.fingerprint === fingerprint || normalizeTitle(item.title) === normalizeTitle(candidate.title))
      .map((item) => ({
        type: resolveResourceConflictType({ candidate, existing: item, fingerprint }),
        resourceId: item.id,
        title: item.title
      }));
    return { fingerprint, conflicts };
  }
}

export function resolveResourceConflictType({ candidate, existing, fingerprint }) {
  if (existing.fingerprint !== fingerprint) return 'same-title';
  const portraitUrl = candidate.kind === 'character' ? candidate.payload?.portrait?.url : '';
  if (
    candidate.kind === 'character'
    && (
      (portraitUrl && portraitUrl !== existing.payload?.portrait?.url)
      || (!portraitUrl && candidate.hasEmbeddedPortrait === true)
    )
  ) {
    return 'portrait-update';
  }
  return 'exact-duplicate';
}

export function createFingerprint(value) {
  const semanticValue = stripVolatileFields(value);
  return crypto.createHash('sha256').update(stableStringify(semanticValue)).digest('hex');
}

export function normalizeTitle(value) {
  return String(value || '').trim().toLowerCase();
}

function stripVolatileFields(value) {
  if (Array.isArray(value)) return value.map(stripVolatileFields);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !VOLATILE_FIELDS.has(key))
    .map(([key, item]) => [key, stripVolatileFields(item)]));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
