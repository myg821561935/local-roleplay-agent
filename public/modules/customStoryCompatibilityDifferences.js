export function createCompatibilityDifferencesNotice(differences = [], documentObject = globalThis.document) {
  const wrapper = createElement(documentObject, 'div');
  wrapper.className = 'story-custom-compatibility-differences';
  wrapper.append(
    createElement(documentObject, 'strong', '创建前需确认的兼容差异'),
    createElement(documentObject, 'p', '这些能力会按下列方式降级；确认只绑定当前素材版本与组装指纹。')
  );
  const list = createElement(documentObject, 'ul');
  differences.forEach((item) => {
    const row = createElement(documentObject, 'li');
    row.append(
      createElement(documentObject, 'strong', String(item.label || item.id || '未知能力')),
      createElement(documentObject, 'span', String(item.impact || '存在兼容差异'))
    );
    const evidence = Array.isArray(item.evidence) ? item.evidence.filter(Boolean) : [];
    if (evidence.length) row.append(createElement(documentObject, 'small', `依据：${evidence.join('；')}`));
    if (item.recommendation) row.append(createElement(documentObject, 'small', `处理：${item.recommendation}`));
    list.append(row);
  });
  wrapper.append(list);
  return wrapper;
}

function createElement(documentObject, tagName, text = '') {
  const node = documentObject.createElement(tagName);
  if (text) node.textContent = text;
  return node;
}
