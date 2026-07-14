export function renderSafeMarkdown(value) {
  let text = String(value || '');
  text = escapeHtml(text);
  text = parseImmersiveOptions(text);
  text = applyInlineMarkdown(text);
  return text.replace(/\n/g, '<br>');
}

function parseImmersiveOptions(text) {
  // Matches optional blockquote "&gt; ", then "[天机选项：...]" followed by bullet points
  const optionRegex = /(?:&gt;\s*)?(?:\[|【)天机选项[：:](.*?)(?:\]|】)\n([\s\S]*?)(?=\n\n|$)/g;
  return text.replace(optionRegex, (match, title, optionsBlock) => {
    const optionsHtml = optionsBlock.split('\n').map(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith('- ')) {
        return `<div class="immersive-option-item">${trimmed.substring(2)}</div>`;
      }
      return line;
    }).join('');

    return `<div class="immersive-options-card">
      <div class="immersive-options-stamp">天机</div>
      <div class="immersive-options-title">天机选项：${title}</div>
      <div class="immersive-options-list">${optionsHtml}</div>
    </div>`;
  });
}

function applyInlineMarkdown(text) {
  return text
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
