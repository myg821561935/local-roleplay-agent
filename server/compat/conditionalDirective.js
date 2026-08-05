// 世界书条目 @@if 条件指令解析器
// 语法（九渊卡等社区卡使用）：
//   @@if <JavaScript 条件表达式>
//   ---
//   <条件为真时输出的内容主体>
//
// 特征：
// - 单分支守卫：条件为真则整条加载，条件为假则整条不加载
// - 无 @@else / @@elif / @@endif（多分支通过多个互斥 @@if 条目实现）
// - 条件表达式为受限 JS：===, !==, &&, ||, !, ?.includes(), 字符串/数字/布尔字面量
// - 变量来自 MVU 状态（lightFrontendState.values），如 player_city、player_faction、current_region

const CONDITION_PREFIX = '@@if';
const SEPARATOR = '---';
const MAX_CONDITION_LENGTH = 300;

/**
 * 从条目 content 中提取 @@if 条件
 * @param {string} content - 世界书条目内容
 * @returns {{ condition: string, body: string } | null} - 条件和正文，无 @@if 则返回 null
 */
export function extractConditionalDirective(content) {
  const source = String(content || '');
  if (!source.startsWith(CONDITION_PREFIX)) return null;
  const firstNewline = source.indexOf('\n');
  if (firstNewline === -1) return null;
  const conditionLine = source.slice(CONDITION_PREFIX.length, firstNewline).trim();
  if (!conditionLine || conditionLine.length > MAX_CONDITION_LENGTH) return null;
  const rest = source.slice(firstNewline + 1);
  // 跳过第二行的 --- 分隔符（如果存在）
  const body = rest.startsWith(SEPARATOR)
    ? rest.slice(rest.indexOf('\n') + 1)
    : rest;
  return { condition: conditionLine, body: body.trim() };
}

/**
 * 安全求值 @@if 条件表达式
 * 仅支持受限语法：标识符、字面量、比较运算符、逻辑运算符、可选链调用、includes()
 * @param {string} condition - 条件表达式（如 "player_city === '白鹿原'"）
 * @param {object} values - MVU 变量值对象
 * @returns {boolean} - 条件是否为真；无法求值时返回 false（保守策略，不加载不确定的条目）
 */
export function evaluateCondition(condition, values = {}) {
  const expr = String(condition || '').trim();
  if (!expr || expr.length > MAX_CONDITION_LENGTH) return false;
  try {
    const fn = compileCondition(expr);
    if (!fn) return false;
    return Boolean(fn(values));
  } catch {
    return false;
  }
}

/**
 * 过滤世界书条目：应用 @@if 条件，条件为假的条目被剔除，条件为真的条目剥离 @@if 前缀
 * @param {Array} entries - 世界书条目数组
 * @param {object} lightFrontendState - 轻前端状态 { values: {...} }
 * @returns {{ entries: Array, skipped: Array }}
 */
export function applyConditionalDirectives(entries = [], lightFrontendState = {}) {
  const values = resolveMvuValues(lightFrontendState);
  const result = [];
  const skipped = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || typeof entry !== 'object') continue;
    const directive = extractConditionalDirective(entry.content);
    if (!directive) {
      result.push(entry);
      continue;
    }
    const passed = evaluateCondition(directive.condition, values);
    if (passed) {
      result.push({ ...entry, content: directive.body });
    } else {
      skipped.push({
        id: String(entry.id || ''),
        title: String(entry.title || ''),
        condition: directive.condition
      });
    }
  }
  return { entries: result, skipped };
}

function resolveMvuValues(state) {
  if (!state || typeof state !== 'object') return {};
  if (state.values && typeof state.values === 'object') return state.values;
  return state;
}

/**
 * 将条件表达式编译为求值函数
 * 使用受限的沙箱：仅暴露 MVU values 作为变量，禁止访问 globalThis/process/require 等
 */
function compileCondition(expr) {
  // 预处理：将裸变量名映射为 values.xxx
  // 支持的语法：标识符（含可选链 ?. 和 .includes()）、===, !==, ==, !=, &&, ||, !, 字面量
  const sanitized = sanitizeConditionExpression(expr);
  if (!sanitized) return null;
  try {
    // 使用 Function 构造（非 eval），仅暴露 values 参数，无 this/global 访问
    // eslint-disable-next-line no-new-func
    const fn = new Function('values', `"use strict"; return (${sanitized});`);
    return (values) => {
      try {
        return fn(values);
      } catch {
        return false;
      }
    };
  } catch {
    return null;
  }
}

/**
 * 净化条件表达式：将裸标识符替换为 values.xxx 引用
 * 保留运算符、字面量和方法调用
 */
function sanitizeConditionExpression(expr) {
  // 检测危险模式：拒绝访问全局对象、赋值、函数定义等
  if (/(?:globalThis|window|process|require|module|exports|constructor|prototype|__proto__|eval|Function|setTimeout|setInterval|fetch|XMLHttpRequest|import|document|this\b)/i.test(expr)) {
    return null;
  }
  if (/[;{}]|=>|\bnew\b|\bfunction\b|\bvar\b|\blet\b|\bconst\b/i.test(expr)) {
    return null;
  }

  // 将裸标识符（如 player_city）替换为 values.player_city
  // 保留：字符串字面量 'xxx'、"xxx"、数字、true/false/null/undefined、运算符、.includes(
  let result = expr;
  // 标识符映射：匹配不以 . 开头的裸标识符（避免重复替换已映射的 values.xxx）
  const identifierPattern = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g;
  const reserved = new Set(['true', 'false', 'null', 'undefined', 'includes', 'indexOf', 'startsWith', 'endsWith', 'slice', 'length', 'values', 'Math', 'Number', 'String', 'Boolean']);
  result = result.replace(identifierPattern, (match, name, offset, full) => {
    if (reserved.has(name)) return match;
    // 检查前一个字符是否是 .（即已经是属性访问的一部分）
    const prevChar = offset > 0 ? full[offset - 1] : '';
    if (prevChar === '.') return match;
    return `values.${name}`;
  });
  return result;
}
