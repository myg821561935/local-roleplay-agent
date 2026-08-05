export function parseJsonFromTextarea(textarea, label) {
  try {
    return JSON.parse(textarea?.value || 'null');
  } catch {
    throw new Error(`${label} 解析失败`);
  }
}

export function setStatus(element, text, tone = '') {
  element.textContent = text;
  element.classList.remove('is-error', 'is-ok', 'is-busy', 'is-warning');
  if (tone === 'error') element.classList.add('is-error');
  if (tone === 'ok') element.classList.add('is-ok');
  if (tone === 'busy') element.classList.add('is-busy');
  if (tone === 'warning') element.classList.add('is-warning');
}

export function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}
