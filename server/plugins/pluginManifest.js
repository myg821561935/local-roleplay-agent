import { compareSemver, normalizeSemver, satisfiesSemver } from '../lib/semver.js';
import { APP_VERSION } from '../releaseInfo.js';

export const PLUGIN_SPEC = 'lra.plugin/v1';
export const DEFAULT_PLUGIN_ENGINE_RANGE = '>=0.2.2 <1.0.0';

const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9.-]{2,79}$/;
const ADAPTER_ID_PATTERN = /^[a-z][a-z0-9-]{2,79}$/;
const SUPPORTED_KINDS = new Set(['character', 'worldbook', 'prompt', 'content-pack', 'plugin']);
const SUPPORTED_FORMATS = new Set(['png', 'json', 'txt', 'yaml', 'yml']);
const EXECUTABLE_FIELDS = ['entry', 'main', 'module', 'script', 'scripts', 'command', 'hooks'];

export function inspectPluginManifest(input = {}, {
  appVersion = APP_VERSION,
  installedPlugins = [],
  installedAdapters = [],
  corePluginIds = []
} = {}) {
  const blockingIssues = [];
  const warnings = [];
  const manifest = normalizeManifestShape(input, blockingIssues, warnings);

  if (!satisfiesSemver(appVersion, manifest.engine)) {
    blockingIssues.push(issue(
      'plugin-engine-incompatible',
      `插件要求引擎 ${manifest.engine}，当前版本为 ${appVersion}。`,
      'engine'
    ));
  }

  const dependencyReport = manifest.dependencies.map((dependency) => {
    const installed = installedPlugins.find((item) => pluginIdOf(item) === dependency.id);
    const installedVersion = pluginVersionOf(installed);
    const matched = Boolean(installedVersion && satisfiesSemver(installedVersion, dependency.range));
    const status = matched ? 'ready' : installedVersion ? 'version-mismatch' : 'missing';
    if (!matched) {
      const target = dependency.optional ? warnings : blockingIssues;
      target.push(issue(
        status === 'missing' ? 'plugin-dependency-missing' : 'plugin-dependency-version',
        `${dependency.id} 需要 ${dependency.range}${installedVersion ? `，当前为 ${installedVersion}` : '，当前未安装'}。`,
        `dependencies.${dependency.id}`
      ));
    }
    return { ...dependency, installedVersion, status };
  });

  const coreConflict = corePluginIds.includes(manifest.id);
  if (coreConflict) {
    blockingIssues.push(issue('plugin-core-conflict', '不能覆盖内置插件。', 'id'));
  }

  const existing = installedPlugins.find((item) => pluginIdOf(item) === manifest.id);
  let installAction = 'create';
  if (existing) {
    const existingVersion = pluginVersionOf(existing);
    if (existingVersion === manifest.version) {
      installAction = 'duplicate';
      warnings.push(issue('plugin-version-installed', `版本 ${manifest.version} 已安装。`, 'version'));
    } else if (existingVersion && compareSemver(manifest.version, existingVersion) < 0) {
      installAction = 'downgrade';
      blockingIssues.push(issue('plugin-downgrade-blocked', `已安装 ${existingVersion}，默认禁止降级到 ${manifest.version}。`, 'version'));
    } else {
      installAction = 'update';
    }
  }

  const knownAdapterIds = new Set(installedAdapters.map((item) => String(item.id || '')));
  for (const adapter of manifest.adapters) {
    if (knownAdapterIds.has(adapter.id)) {
      blockingIssues.push(issue('adapter-id-conflict', `适配器 ${adapter.id} 已由其他插件注册。`, `adapters.${adapter.id}`));
    }
  }

  const score = Math.max(0, 100 - (blockingIssues.length * 30) - (warnings.length * 6));
  const verdict = blockingIssues.length ? 'blocked' : warnings.length ? 'review' : 'recommended';
  return {
    manifest,
    score,
    grade: verdict === 'recommended' ? 'A' : verdict === 'review' ? 'B' : 'D',
    verdict,
    verdictLabel: verdict === 'recommended' ? '可安装' : verdict === 'review' ? '建议审阅' : '不可安装',
    summary: blockingIssues.length
      ? `发现 ${blockingIssues.length} 项阻断问题。`
      : `${manifest.adapters.length} 个声明式适配器通过检查。`,
    canInstall: blockingIssues.length === 0,
    canImport: blockingIssues.length === 0,
    installAction,
    dependencies: dependencyReport,
    blockingIssues,
    warnings,
    riskFlags: [],
    dimensions: [
      dimension('manifest', '清单结构', blockingIssues.some((item) => item.path !== 'engine') ? 40 : 100, '只接受声明式字段。'),
      dimension('engine', '引擎兼容', blockingIssues.some((item) => item.code === 'plugin-engine-incompatible') ? 0 : 100, manifest.engine),
      dimension('dependencies', '依赖完整', dependencyReport.some((item) => item.status !== 'ready' && !item.optional) ? 30 : 100, `${dependencyReport.length} 项依赖`),
      dimension('adapters', '适配能力', manifest.adapters.length ? 100 : 0, `${manifest.adapters.length} 个适配器`)
    ]
  };
}

export function normalizePluginManifest(input = {}, options = {}) {
  const inspection = inspectPluginManifest(input, options);
  if (!inspection.canInstall) {
    const error = new Error('PLUGIN_MANIFEST_INVALID');
    error.inspection = inspection;
    throw error;
  }
  return inspection.manifest;
}

function normalizeManifestShape(input, blockingIssues, warnings) {
  const source = isPlainObject(input?.manifest) ? input.manifest : input;
  const spec = String(source.spec || source.schema || '').trim();
  if (spec !== PLUGIN_SPEC) blockingIssues.push(issue('plugin-spec-invalid', `必须声明 spec: ${PLUGIN_SPEC}。`, 'spec'));

  for (const field of EXECUTABLE_FIELDS) {
    if (Object.hasOwn(source, field)) {
      blockingIssues.push(issue('executable-plugin-unsupported', `本地引擎不执行第三方 ${field} 字段。`, field));
    }
  }

  const id = String(source.id || '').trim().toLowerCase();
  if (!PLUGIN_ID_PATTERN.test(id)) blockingIssues.push(issue('plugin-id-invalid', '插件 ID 需使用小写字母、数字、点和短横线。', 'id'));
  const version = normalizeSemver(source.version);
  if (!version) blockingIssues.push(issue('plugin-version-invalid', '插件版本必须是 x.y.z。', 'version'));
  const name = String(source.name || source.title || id || '未命名插件').trim().slice(0, 80);
  const engine = String(source.engine || DEFAULT_PLUGIN_ENGINE_RANGE).trim();
  const adaptersInput = Array.isArray(source.adapters) ? source.adapters : [];
  if (!adaptersInput.length) blockingIssues.push(issue('plugin-adapters-empty', '插件至少声明一个资源适配器。', 'adapters'));

  const adapterIds = new Set();
  const adapters = adaptersInput.map((adapter, index) => normalizeAdapter(adapter, index, version, blockingIssues, warnings))
    .filter(Boolean)
    .filter((adapter) => {
      if (adapterIds.has(adapter.id)) {
        blockingIssues.push(issue('adapter-id-duplicate', `清单内重复声明适配器 ${adapter.id}。`, `adapters.${adapter.id}`));
        return false;
      }
      adapterIds.add(adapter.id);
      return true;
    });

  const dependencies = (Array.isArray(source.dependencies) ? source.dependencies : [])
    .map((dependency) => normalizeDependency(dependency, blockingIssues))
    .filter(Boolean);

  return {
    spec: PLUGIN_SPEC,
    id,
    version: version || '0.0.0',
    name,
    description: String(source.description || '').trim().slice(0, 300),
    author: String(source.author || '').trim().slice(0, 80),
    homepage: String(source.homepage || '').trim().slice(0, 300),
    license: String(source.license || '未声明').trim().slice(0, 80),
    engine,
    dependencies,
    adapters
  };
}

function normalizeAdapter(adapter, index, pluginVersion, blockingIssues, warnings) {
  if (!isPlainObject(adapter)) {
    blockingIssues.push(issue('adapter-invalid', `第 ${index + 1} 个适配器不是对象。`, `adapters.${index}`));
    return null;
  }
  for (const field of EXECUTABLE_FIELDS) {
    if (Object.hasOwn(adapter, field)) {
      blockingIssues.push(issue('adapter-executable-unsupported', `适配器不能声明 ${field}。`, `adapters.${index}.${field}`));
    }
  }
  const id = String(adapter.id || '').trim().toLowerCase();
  if (!ADAPTER_ID_PATTERN.test(id)) blockingIssues.push(issue('adapter-id-invalid', `适配器 ${index + 1} 的 ID 无效。`, `adapters.${index}.id`));
  const kinds = uniqueStrings(adapter.kinds).filter((kind) => SUPPORTED_KINDS.has(kind));
  const formats = uniqueStrings(adapter.formats).map((item) => item.toLowerCase()).filter((format) => SUPPORTED_FORMATS.has(format));
  if (!kinds.length) blockingIssues.push(issue('adapter-kinds-empty', `${id || `适配器 ${index + 1}`} 未声明有效资源类型。`, `adapters.${index}.kinds`));
  if (!formats.length) warnings.push(issue('adapter-formats-empty', `${id || `适配器 ${index + 1}`} 未声明文件格式。`, `adapters.${index}.formats`));
  const match = isPlainObject(adapter.match) ? adapter.match : {};
  return {
    id,
    version: normalizeSemver(adapter.version, pluginVersion || '0.0.0'),
    label: String(adapter.label || adapter.name || id || '未命名适配器').trim().slice(0, 80),
    description: String(adapter.description || '').trim().slice(0, 300),
    kinds,
    formats,
    priority: clampInteger(adapter.priority, 0, 1000, 10),
    capabilities: uniqueStrings(adapter.capabilities),
    match: {
      previewKinds: uniqueStrings(match.previewKinds),
      sourceIncludes: uniqueStrings(match.sourceIncludes).map((item) => item.toLowerCase()),
      sourceSpecIncludes: uniqueStrings(match.sourceSpecIncludes).map((item) => item.toLowerCase()),
      fallback: match.fallback === true
    }
  };
}

function normalizeDependency(input, blockingIssues) {
  if (!isPlainObject(input)) return null;
  const id = String(input.id || '').trim().toLowerCase();
  if (!PLUGIN_ID_PATTERN.test(id)) {
    blockingIssues.push(issue('plugin-dependency-id-invalid', '插件依赖 ID 无效。', 'dependencies'));
    return null;
  }
  return {
    id,
    range: String(input.range || '*').trim(),
    optional: input.optional === true
  };
}

function pluginIdOf(item) {
  return String(item?.manifest?.id || item?.id || '').trim().toLowerCase();
}

function pluginVersionOf(item) {
  return normalizeSemver(item?.manifest?.version || item?.version || '');
}

function issue(code, message, path = '') {
  return { code, message, path };
}

function dimension(id, label, score, summary) {
  return { id, label, score, summary, status: score >= 80 ? 'ready' : score >= 50 ? 'review' : 'blocked' };
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
