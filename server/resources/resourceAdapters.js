import { BUILTIN_PLUGIN_MANIFESTS } from '../plugins/builtins.js';

export function listResourceAdapters(pluginRecords = BUILTIN_PLUGIN_MANIFESTS) {
  return (Array.isArray(pluginRecords) ? pluginRecords : [])
    .flatMap((record) => {
      const manifest = record?.manifest || record;
      const origin = record?.origin || 'core';
      const enabled = record?.enabled !== false;
      if (!enabled || !Array.isArray(manifest?.adapters)) return [];
      return manifest.adapters.map((adapter) => ({
        ...structuredClone(adapter),
        pluginId: manifest.id,
        pluginVersion: manifest.version,
        pluginName: manifest.name,
        origin
      }));
    })
    .sort((left, right) => Number(right.priority || 0) - Number(left.priority || 0));
}

export function resolveResourceAdapter({ preview, source = {}, adapters = listResourceAdapters() } = {}) {
  const available = Array.isArray(adapters) ? adapters : [];
  const requested = String(source.adapterId || '').trim();
  if (requested) {
    const adapter = available.find((item) => item.id === requested);
    if (adapter) return structuredClone(adapter);
  }

  const matched = available
    .filter((adapter) => adapterMatches(adapter, preview, source))
    .sort((left, right) => Number(right.priority || 0) - Number(left.priority || 0));
  const selected = matched.find((adapter) => adapter.match?.fallback !== true)
    || matched[0]
    || available.find((adapter) => adapter.id === 'text-yaml-resource');
  if (!selected) throw new Error('RESOURCE_ADAPTER_NOT_FOUND');
  return structuredClone(selected);
}

function adapterMatches(adapter, preview, source) {
  const match = adapter?.match || {};
  const previewKinds = Array.isArray(match.previewKinds) ? match.previewKinds : [];
  if (previewKinds.length && !previewKinds.includes(String(preview?.kind || ''))) return false;

  const sourceText = `${source.site || ''} ${source.community || ''} ${source.url || ''} ${source.sourceId || ''}`.toLowerCase();
  const sourceIncludes = Array.isArray(match.sourceIncludes) ? match.sourceIncludes : [];
  if (sourceIncludes.length && !sourceIncludes.some((needle) => sourceText.includes(String(needle).toLowerCase()))) return false;

  const sourceSpec = String(preview?.importData?.characterCard?.sourceSpec || '').toLowerCase();
  const sourceSpecIncludes = Array.isArray(match.sourceSpecIncludes) ? match.sourceSpecIncludes : [];
  if (sourceSpecIncludes.length && !sourceSpecIncludes.some((needle) => sourceSpec.includes(String(needle).toLowerCase()))) return false;
  return previewKinds.length > 0 || sourceIncludes.length > 0 || sourceSpecIncludes.length > 0 || match.fallback === true;
}
