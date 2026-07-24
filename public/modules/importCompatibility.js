const STATUS_LABELS = {
  supported: '原生支持',
  degraded: '需转换',
  missing: '运行时缺失'
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
  const readyToPlay = report.readyToPlay !== false && !Number(report.counts?.missing || 0);
  playability.className = `import-community-playability ${readyToPlay ? 'is-ready' : 'is-store-only'}`;
  playability.textContent = readyToPlay ? '可进入运行流程' : '安全保存，不代表完整可玩';

  const summary = document.createElement('p');
  summary.className = 'import-community-summary';
  summary.textContent = report.summary || '未发现明确的第三方扩展依赖。';

  const counters = document.createElement('div');
  counters.className = 'import-community-counts';
  [
    ['supported', '原生', report.counts?.supported],
    ['degraded', '转换', report.counts?.degraded],
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
  safety.textContent = report.counts?.missing
    ? `${storyImport ? '可以保存并创建待完善副本，但' : '可以安全保存原件，但'}缺失能力不会因此恢复；未知 JavaScript 始终保持禁用。`
    : '导入只保存数据，不执行第三方 JavaScript。';

  section.append(heading, playability, summary, counters, list, safety);
  return section;
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
