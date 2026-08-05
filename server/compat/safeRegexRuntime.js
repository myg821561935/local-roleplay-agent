// safe-regex-runtime: 将导入的 SillyTavern Regex 配套规则应用到会话的 lightFrontend 运行时。
// 该模块实现 `safe-regex-runtime` 能力：让 regex-preset 适配器声明的安全正则规则
// 真正参与到 prompt 组装流程（通过 applyPromptTransforms 在 promptAssembler 中执行）。
//
// 设计原则：
// - 只接受已通过 normalizeRegexTransform 安全校验的规则
// - 纯正则规则由 applyPromptTransforms 消费
// - 可执行 replacement 只进入受审核的浏览器沙箱，并绑定内容哈希
// - 规则合并到 session.config.lightFrontend.regexTransforms

import { extractLightFrontendRuntime, normalizeLightFrontendRuntime } from './lightFrontendRuntime.js';
import { attachScriptContentHashes } from '../security/scriptGovernance.js';

const MAX_SESSION_REGEX_RULES = 32;

/**
 * 从资源库资源（regex-preset 类型的 prompt 模块）中提取已规范化的安全正则规则。
 * @param {object} resource - 资源库资源，需包含 payload.extensions.regex_scripts
 * @returns {{ transforms: object[], diagnostics: object[], ruleCount: number }}
 */
export function extractRegexTransformsFromResource(resource) {
  const payload = resource?.payload || resource;
  const extensions = isPlainObject(payload?.extensions) ? payload.extensions : {};
  const rawRules = collectRegexRules(payload, extensions);
  if (!rawRules.length) return { transforms: [], diagnostics: [], ruleCount: 0 };

  const runtime = extractLightFrontendRuntime({ extensions: { regex_scripts: rawRules } });
  return {
    transforms: runtime.regexTransforms.slice(0, MAX_SESSION_REGEX_RULES),
    diagnostics: runtime.diagnostics || [],
    ruleCount: rawRules.length
  };
}

/**
 * 将安全正则规则应用到会话的 lightFrontend 运行时。
 * 默认合并模式：按 id 去重后追加；replace 模式：覆盖现有规则。
 * @param {object} session - 会话对象（会被原地修改）
 * @param {object[]} transforms - 已规范化的正则规则
 * @param {{ replace?: boolean }} options
 * @returns {{ applied: number, skipped: number, total: number }}
 */
export function applyRegexTransformsToSession(session, transforms, { replace = false } = {}) {
  if (!isPlainObject(session)) throw new Error('INVALID_SESSION');
  if (!isPlainObject(session.config)) session.config = {};
  if (!isPlainObject(session.config.lightFrontend)) session.config.lightFrontend = {};

  const incomingSource = Array.isArray(transforms) ? transforms.slice(0, MAX_SESSION_REGEX_RULES) : [];
  const incoming = attachScriptContentHashes(dedupeRules(incomingSource));
  const existing = attachScriptContentHashes(
    Array.isArray(session.config.lightFrontend.regexTransforms)
      ? session.config.lightFrontend.regexTransforms.slice(0, MAX_SESSION_REGEX_RULES)
      : []
  );

  let merged;
  let applied;
  if (replace) {
    merged = incoming;
    applied = incoming.length;
  } else {
    const seenIds = new Set(existing.map((rule) => rule.id).filter(Boolean));
    const additions = incoming
      .filter((rule) => !rule.id || !seenIds.has(rule.id))
      .slice(0, Math.max(0, MAX_SESSION_REGEX_RULES - existing.length));
    merged = [...existing, ...additions].slice(0, MAX_SESSION_REGEX_RULES);
    applied = additions.length;
  }

  session.config.lightFrontend.regexTransforms = merged;
  session.updatedAt = new Date().toISOString();
  return {
    applied,
    skipped: Math.max(0, incomingSource.length - applied),
    total: merged.length
  };
}

/**
 * 从资源库资源中提取原始 regex 规则（兼容多种字段命名）。
 */
function collectRegexRules(payload, extensions) {
  const candidates = [];
  const sources = [
    payload?.regex_scripts,
    payload?.regexScripts,
    payload?.regex,
    extensions?.regex_scripts,
    extensions?.regexScripts,
    extensions?.regex
  ];
  for (const value of sources) {
    if (Array.isArray(value)) candidates.push(...value);
  }
  return candidates.filter(isRegexRule).map((rule) => structuredClone(rule));
}

function isRegexRule(value) {
  if (!isPlainObject(value)) return false;
  const pattern = String(value.findRegex ?? value.pattern ?? value.regex ?? '').trim();
  if (!pattern) return false;
  return Boolean(
    value.scriptName
    || value.name
    || Object.hasOwn(value, 'replaceString')
    || Object.hasOwn(value, 'replacement')
    || Object.hasOwn(value, 'replace')
    || Object.hasOwn(value, 'placement')
  );
}

function dedupeRules(rules) {
  const seenIds = new Set();
  const deduped = [];
  for (const rule of Array.isArray(rules) ? rules : []) {
    if (!isPlainObject(rule)) continue;
    const id = String(rule.id || '').trim();
    if (id && seenIds.has(id)) continue;
    if (id) seenIds.add(id);
    deduped.push(rule);
  }
  return deduped;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
