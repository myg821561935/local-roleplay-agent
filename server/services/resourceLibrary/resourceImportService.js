import crypto from 'node:crypto';

export class ResourceImportService {
  constructor({ conflictService, evaluationService, now }) {
    this.conflictService = conflictService;
    this.evaluationService = evaluationService;
    this.now = now;
  }

  inspectCandidates(candidates, existing, { source = {}, adapter = {} } = {}) {
    const resources = candidates.map((candidate) => {
      const { fingerprint, conflicts } = this.conflictService.findConflicts(candidate, existing);
      return {
        kind: candidate.kind,
        title: candidate.title,
        fingerprint,
        diagnostics: this.evaluationService.evaluate(candidate, {
          conflicts,
          source,
          adapter
        })
      };
    });
    return {
      ...this.evaluationService.aggregate(resources.map((item) => item.diagnostics)),
      resources
    };
  }

  createImportContext(source = {}) {
    const importedAt = this.now().toISOString();
    const importBatchId = String(source.importBatchId || crypto.randomUUID());
    return {
      importedAt,
      source: { ...source, importBatchId }
    };
  }

  createResourceRecord(candidate, inspected, adapter, source, importedAt) {
    const id = crypto.randomUUID();
    return {
      id,
      kind: candidate.kind,
      title: candidate.title,
      summary: candidate.summary,
      tags: uniqueStrings(candidate.tags),
      collections: uniqueStrings(candidate.collections),
      favorite: false,
      format: adapter.id,
      fingerprint: inspected.fingerprint,
      source: normalizeSource(source, candidate, importedAt),
      diagnostics: inspected.diagnostics,
      payload: structuredClone(candidate.payload),
      createdAt: importedAt,
      updatedAt: importedAt
    };
  }
}

function normalizeSource(source, candidate, importedAt) {
  return {
    adapterId: String(source.adapterId || '').trim(),
    community: String(source.community || '').trim(),
    site: String(source.site || source.sourceId || 'local-file').trim(),
    url: String(source.url || '').trim(),
    author: String(source.author || '').trim(),
    license: String(source.license || '未声明').trim(),
    version: String(source.version || candidate.version || '').trim(),
    fileName: String(source.fileName || '').trim(),
    importBatchId: String(source.importBatchId || '').trim(),
    importedAt,
    originalHash: String(source.originalHash || '').trim()
  };
}

function uniqueStrings(values) {
  const list = Array.isArray(values) ? values : values === undefined || values === null ? [] : [values];
  return [...new Set(list.map((value) => String(value || '').trim()).filter(Boolean))];
}
