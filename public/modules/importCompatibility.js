const STATUS_LABELS = {
  supported: '原生支持',
  degraded: '需转换',
  review: '待人工审核',
  missing: '运行时缺失'
};

const ACCEPTANCE_LABELS = {
  'full-mapping': '完整映射',
  'safe-degradation': '安全降级',
  'review-required': '待人工审核',
  blocked: '阻断运行'
};

export function createCommunityCompatibilitySection(report = {}, { storyImport = false } = {}) {
  const requirements = Array.isArray(report.requirements) ? report.requirements : [];
  if (!requirements.length) return null;

  const section = document.createElement('section');
  section.className = `import-community-compatibility is-${report.level || 'native'}`;

  const heading = document.createElement('div');
  heading.className = 'import-section-heading';
  const title = document.createElement('strong');
  title.textContent = '社区扩展兼容';
  const label = document.createElement('span');
  label.className = 'import-community-verdict';
  label.textContent = report.label || '待检查';
  heading.append(title, label);

  const playability = document.createElement('span');
  const outcome = report.acceptance?.outcome || '';
  const readyToPlay = report.acceptance
    ? report.acceptance.canRun === true
    : report.readyToPlay !== false && !Number(report.counts?.missing || 0);
  playability.className = [
    'import-community-playability',
    readyToPlay ? 'is-ready' : 'is-store-only',
    outcome ? `is-${outcome}` : ''
  ].filter(Boolean).join(' ');
  playability.textContent = ACCEPTANCE_LABELS[outcome]
    || (readyToPlay ? '可进入运行流程' : '安全保存，不代表完整可玩');

  const summary = document.createElement('p');
  summary.className = 'import-community-summary';
  summary.textContent = report.summary || '未发现明确的第三方扩展依赖。';

  const counters = document.createElement('div');
  counters.className = 'import-community-counts';
  [
    ['supported', '原生', report.counts?.supported],
    ['degraded', '转换', report.counts?.degraded],
    ['review', '待审核', report.counts?.review],
    ['missing', '缺失', report.counts?.missing]
  ].forEach(([status, text, value]) => {
    const item = document.createElement('span');
    item.className = `is-${status}`;
    item.textContent = `${text} ${Number(value || 0)}`;
    counters.append(item);
  });

  const list = document.createElement('div');
  list.className = 'import-community-list';
  requirements.forEach((item) => list.append(createRequirementRow(item)));

  const safety = document.createElement('p');
  safety.className = 'import-community-safety';
  safety.textContent = getCommunityCompatibilitySafetyText(report, { storyImport });

  section.append(heading, playability, summary, counters, list, safety);
  return section;
}

export function getCommunityCompatibilitySafetyText(report = {}, { storyImport = false } = {}) {
  const outcome = report.acceptance?.outcome || '';
  if (outcome === 'blocked') {
    const reason = report.acceptance?.blockers?.[0]?.label || '资源依赖不受控运行时';
    return `已阻断运行：${reason}。原件可保存审阅，但不会执行第三方 JavaScript、DOM 或 iframe。`;
  }
  if (outcome === 'safe-degradation') {
    const differenceCount = Number(report.acceptance?.differences?.length || 0);
    return `已保留静态内容并禁用不安全部分，共 ${differenceCount} 项差异；导入后请按差异清单审阅。`;
  }
  if (outcome === 'review-required') {
    const reviewCount = Number(report.acceptance?.reviews?.length || report.counts?.review || 0);
    return `检测到 ${reviewCount} 项脚本能力，当前保持禁用；完成人工审核、内容哈希绑定与本地审计后，受支持脚本才可进入隔离沙箱。`;
  }
  return report.counts?.missing
    ? `${storyImport ? '可以保存并创建待完善副本，但' : '可以安全保存原件，但'}缺失能力不会因此恢复；未知 JavaScript 始终保持禁用。`
    : '主要交互语义已映射；静态内容可直接入库，第三方脚本只有经人工审核、内容哈希绑定并写入本地审计后，才会进入隔离沙箱。';
}

function createRequirementRow(item = {}) {
  const row = document.createElement('article');
  row.className = `import-community-item is-${item.status || 'degraded'}`;

  const status = document.createElement('span');
  status.className = 'import-community-status';
  status.textContent = STATUS_LABELS[item.status] || '需审阅';

  const copy = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = item.label || item.id || '未命名能力';
  const impact = document.createElement('p');
  impact.textContent = item.impact || '';
  copy.append(title, impact);

  if (Array.isArray(item.evidence) && item.evidence.length) {
    const evidence = document.createElement('small');
    evidence.textContent = `依据：${item.evidence.slice(0, 3).join(' · ')}`;
    copy.append(evidence);
  }
  if (item.recommendation && item.status !== 'supported') {
    const recommendation = document.createElement('small');
    recommendation.className = 'import-community-recommendation';
    recommendation.textContent = `处理：${item.recommendation}`;
    copy.append(recommendation);
  }

  row.append(status, copy);
  return row;
}
