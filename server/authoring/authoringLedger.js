const PROMISE_STATUSES = new Set(['open', 'advanced', 'fulfilled', 'abandoned']);
const PROMISE_IMPORTANCE = new Set(['minor', 'major', 'core']);
const DECISION_STATUSES = new Set(['active', 'superseded', 'reversed']);

export function createAuthoringLedger() {
  return {
    spec: 'lra.authoring-ledger/v1',
    scene: {
      title: '',
      objective: '',
      pov: '',
      location: '',
      time: '',
      tone: '',
      mustReveal: [],
      mustHide: [],
      forbidden: [],
      endingHook: ''
    },
    promises: [],
    decisions: [],
    updatedAt: ''
  };
}

export function normalizeAuthoringLedger(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const fallback = createAuthoringLedger();
  const scene = source.scene && typeof source.scene === 'object' && !Array.isArray(source.scene)
    ? source.scene
    : {};
  return {
    spec: fallback.spec,
    scene: {
      title: cleanText(scene.title, 120),
      objective: cleanText(scene.objective, 1000),
      pov: cleanText(scene.pov, 120),
      location: cleanText(scene.location, 160),
      time: cleanText(scene.time, 160),
      tone: cleanText(scene.tone, 300),
      mustReveal: cleanTextList(scene.mustReveal, 20, 300),
      mustHide: cleanTextList(scene.mustHide, 20, 300),
      forbidden: cleanTextList(scene.forbidden, 20, 300),
      endingHook: cleanText(scene.endingHook, 600)
    },
    promises: (Array.isArray(source.promises) ? source.promises : [])
      .slice(0, 100)
      .map((promise, index) => normalizePromise(promise, index)),
    decisions: (Array.isArray(source.decisions) ? source.decisions : [])
      .slice(0, 100)
      .map((decision, index) => normalizeDecision(decision, index)),
    updatedAt: cleanText(source.updatedAt, 60)
  };
}

export function renderAuthoringLedgerPrompt(input) {
  const ledger = normalizeAuthoringLedger(input);
  const scene = ledger.scene;
  const hasScene = Object.entries(scene).some(([, value]) => Array.isArray(value) ? value.length : Boolean(value));
  const activePromises = ledger.promises.filter((item) => ['open', 'advanced'].includes(item.status));
  const activeDecisions = ledger.decisions.filter((item) => item.status === 'active');
  if (!hasScene && !activePromises.length && !activeDecisions.length) return '';

  const sections = ['# 创作账本（作者约束）'];
  if (hasScene) {
    const lines = ['## 当前场景章纲'];
    appendLine(lines, '场景', scene.title);
    appendLine(lines, '目标', scene.objective);
    appendLine(lines, '视角', scene.pov);
    appendLine(lines, '地点', scene.location);
    appendLine(lines, '时间', scene.time);
    appendLine(lines, '氛围与行文', scene.tone);
    appendList(lines, '本场必须呈现', scene.mustReveal);
    appendList(lines, '本场必须隐藏', scene.mustHide);
    appendList(lines, '禁止偏离', scene.forbidden);
    appendLine(lines, '收束钩子', scene.endingHook);
    sections.push(lines.join('\n'));
  }

  if (activePromises.length) {
    sections.push([
      '## 尚未完成的叙事承诺',
      ...activePromises.slice(0, 12).map((item) => {
        const target = item.target ? `；预期节点：${item.target}` : '';
        const note = item.note ? `；说明：${item.note}` : '';
        return `- [${item.importance}/${item.status}] ${item.title}${target}${note}`;
      }),
      '除非当前场景目标明确要求，否则本轮最多推进一项承诺，不要擅自标记兑现。'
    ].join('\n'));
  }

  if (activeDecisions.length) {
    sections.push([
      '## 生效中的创作决策',
      ...activeDecisions.slice(-12).map((item) => {
        const motivation = item.motivation ? `；理由：${item.motivation}` : '';
        const risk = item.risk ? `；风险：${item.risk}` : '';
        return `- ${item.title}：${item.decision}${motivation}${risk}`;
      }),
      '这些决策是作者已经确认的方向，不得在正文中静默推翻。'
    ].join('\n'));
  }

  return sections.join('\n\n');
}

export function summarizeAuthoringLedger(input) {
  const ledger = normalizeAuthoringLedger(input);
  return {
    sceneTitle: ledger.scene.title,
    sceneObjective: ledger.scene.objective,
    openPromises: ledger.promises.filter((item) => ['open', 'advanced'].includes(item.status)).length,
    activeDecisions: ledger.decisions.filter((item) => item.status === 'active').length,
    hiddenFacts: ledger.scene.mustHide.length,
    updatedAt: ledger.updatedAt
  };
}

function normalizePromise(input, index) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    id: cleanText(source.id, 160) || `promise-${index + 1}`,
    title: cleanText(source.title, 200) || `未命名承诺 ${index + 1}`,
    status: PROMISE_STATUSES.has(source.status) ? source.status : 'open',
    importance: PROMISE_IMPORTANCE.has(source.importance) ? source.importance : 'major',
    target: cleanText(source.target, 200),
    note: cleanText(source.note, 1000),
    introducedAt: cleanText(source.introducedAt, 160),
    lastAdvancedAt: cleanText(source.lastAdvancedAt, 160)
  };
}

function normalizeDecision(input, index) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    id: cleanText(source.id, 160) || `decision-${index + 1}`,
    title: cleanText(source.title, 200) || `未命名决策 ${index + 1}`,
    decision: cleanText(source.decision, 1600),
    motivation: cleanText(source.motivation, 1000),
    risk: cleanText(source.risk, 1000),
    status: DECISION_STATUSES.has(source.status) ? source.status : 'active',
    createdAt: cleanText(source.createdAt, 160)
  };
}

function appendLine(lines, label, value) {
  if (value) lines.push(`${label}：${value}`);
}

function appendList(lines, label, values) {
  if (values.length) lines.push(`${label}：${values.join('；')}`);
}

function cleanTextList(value, maxItems, maxLength) {
  const source = Array.isArray(value)
    ? value
    : String(value || '').split(/[\n,，;；]+/);
  return Array.from(new Set(source.map((item) => cleanText(item, maxLength)).filter(Boolean))).slice(0, maxItems);
}

function cleanText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}
