import crypto from 'node:crypto';
import path from 'node:path';

const MAX_FILE_COUNT = 2000;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set([
  '.html', '.htm', '.js', '.mjs', '.cjs', '.css', '.json', '.map', '.md', '.txt',
  '.xml', '.svg', '.yaml', '.yml', '.csv', '.webmanifest', '.manifest'
]);
const ALLOWED_EXTENSIONS = new Set([
  ...TEXT_EXTENSIONS,
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.bmp',
  '.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.mp4', '.webm',
  '.woff', '.woff2', '.ttf', '.otf', '.wasm', '.bin'
]);

const RISK_RULES = [
  {
    id: 'api-credential-storage',
    severity: 'critical',
    title: '浏览器端 API 密钥或凭据存储',
    explanation: '代码包含 apiKey、Authorization 或凭据持久化逻辑；托管运行时会覆盖接口配置且不会下发真实密钥。',
    pattern: /(?:localStorage|indexedDB)[\s\S]{0,240}(?:api[_-]?key|authorization|bearer|token)|(?:api[_-]?key|authorization|bearer)[\s\S]{0,240}(?:localStorage|indexedDB)/ig
  },
  {
    id: 'remote-cors-proxy',
    severity: 'critical',
    title: '外部 CORS 代理',
    explanation: '代码可能把模型请求转发到第三方代理；隔离运行时仅允许访问本地受控网关。',
    pattern: /cors[_-]?proxy|workers\.dev|\?target=/ig
  },
  {
    id: 'dynamic-code',
    severity: 'critical',
    title: '动态代码执行',
    explanation: '检测到 eval、Function 构造器或字符串定时器，需要逐段人工审核。',
    pattern: /\beval\s*\(|\bnew\s+Function\s*\(|\bFunction\s*\(\s*["'`]|set(?:Timeout|Interval)\s*\(\s*["'`]/ig
  },
  {
    id: 'external-network',
    severity: 'high',
    title: '外部网络请求或远程资源',
    explanation: '检测到外部 URL、fetch、XHR、WebSocket 或 EventSource；默认 CSP 会阻断非本地连接。',
    pattern: /https?:\/\/[^\s"'`<>]+|\bfetch\s*\(|XMLHttpRequest|WebSocket\s*\(|EventSource\s*\(/ig
  },
  {
    id: 'service-worker',
    severity: 'high',
    title: 'Service Worker / Worker',
    explanation: '后台脚本可能扩大生命周期或网络能力；v1 运行策略默认禁用 Worker。',
    pattern: /serviceWorker|new\s+(?:Shared)?Worker\s*\(/ig
  },
  {
    id: 'navigation-or-popup',
    severity: 'high',
    title: '弹窗、下载或页面跳转',
    explanation: '检测到 popup、顶层导航或主动下载；iframe sandbox 不授予这些能力。',
    pattern: /window\.open\s*\(|top\.location|parent\.location|(?:window\.)?location\.(?:assign|replace)\s*\(|(?:window\.)?location\.(?:href|pathname)\s*=|<meta[^>]+http-equiv\s*=\s*["']?refresh|\.download\s*=|download\s*=/ig
  },
  {
    id: 'device-or-clipboard',
    severity: 'high',
    title: '设备或剪贴板访问',
    explanation: '检测到摄像头、麦克风、地理位置或剪贴板 API；运行 iframe 不授予相应权限。',
    pattern: /getUserMedia|mediaDevices|geolocation|navigator\.clipboard|clipboardData/ig
  },
  {
    id: 'browser-storage',
    severity: 'medium',
    title: '浏览器本地存储',
    explanation: '应用使用 localStorage 或 IndexedDB 保存状态；数据隔离在独立包域名下。',
    pattern: /localStorage|sessionStorage|indexedDB/ig
  },
  {
    id: 'embedded-frame',
    severity: 'medium',
    title: '嵌套 iframe / object',
    explanation: '应用尝试嵌入其他页面；v1 CSP 默认禁止 frame、object 与 embed。',
    pattern: /<\s*(?:iframe|object|embed)\b|createElement\s*\(\s*["']iframe["']/ig
  }
];

export function prepareHeavyFrontendBundle(input = {}) {
  const sourceFiles = Array.isArray(input.files) ? input.files : [];
  if (!sourceFiles.length) throw createBundleError('HEAVY_FRONTEND_FILES_REQUIRED');
  if (sourceFiles.length > MAX_FILE_COUNT) throw createBundleError('HEAVY_FRONTEND_TOO_MANY_FILES');

  const files = sourceFiles.map((file, index) => normalizeFile(file, index));
  const duplicate = findDuplicatePath(files);
  if (duplicate) throw createBundleError('HEAVY_FRONTEND_DUPLICATE_PATH', duplicate);

  const totalBytes = files.reduce((sum, file) => sum + file.buffer.length, 0);
  if (totalBytes > MAX_TOTAL_BYTES) throw createBundleError('HEAVY_FRONTEND_BUNDLE_TOO_LARGE');

  const entryPath = resolveEntryPath(input.entryPath, files);
  const textFiles = files
    .filter((file) => TEXT_EXTENSIONS.has(path.posix.extname(file.path).toLowerCase()))
    .map((file) => ({ path: file.path, text: file.buffer.toString('utf8') }));
  const findings = scanHeavyFrontendTextFiles(textFiles);
  const contentHash = hashBundle(files);

  return {
    title: cleanText(input.title || input.sourceName || path.posix.basename(entryPath), 120) || '未命名重前端',
    sourceName: cleanText(input.sourceName || input.title || 'local-package', 160) || 'local-package',
    entryPath,
    contentHash,
    totalBytes,
    fileCount: files.length,
    findings,
    files
  };
}

export function scanHeavyFrontendTextFiles(files = []) {
  return RISK_RULES.map((rule) => {
    const matches = [];
    for (const file of files) {
      rule.pattern.lastIndex = 0;
      let match;
      while ((match = rule.pattern.exec(file.text)) && matches.length < 12) {
        matches.push({
          path: file.path,
          excerpt: compactExcerpt(match[0])
        });
        if (match[0].length === 0) rule.pattern.lastIndex += 1;
      }
    }
    if (!matches.length) return null;
    return {
      id: rule.id,
      severity: rule.severity,
      title: rule.title,
      explanation: rule.explanation,
      count: matches.length,
      examples: matches.slice(0, 5)
    };
  }).filter(Boolean);
}

export function safeHeavyFrontendPath(value) {
  const raw = String(value || '').replaceAll('\\', '/').replace(/^\.\//, '');
  if (!raw || raw.includes('\0') || raw.startsWith('/') || /^[a-zA-Z]:\//.test(raw)) {
    throw createBundleError('HEAVY_FRONTEND_INVALID_PATH', raw);
  }
  const normalized = path.posix.normalize(raw);
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw createBundleError('HEAVY_FRONTEND_INVALID_PATH', raw);
  }
  return normalized;
}

function normalizeFile(file, index) {
  const filePath = safeHeavyFrontendPath(file?.path);
  const extension = path.posix.extname(filePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw createBundleError('HEAVY_FRONTEND_FILE_TYPE_NOT_ALLOWED', filePath);
  }
  if (typeof file?.dataBase64 !== 'string') {
    throw createBundleError('HEAVY_FRONTEND_FILE_DATA_REQUIRED', `${index}:${filePath}`);
  }
  const buffer = decodeBase64Strict(file.dataBase64, filePath);
  if (buffer.length > MAX_FILE_BYTES) throw createBundleError('HEAVY_FRONTEND_FILE_TOO_LARGE', filePath);
  return {
    path: filePath,
    mimeType: cleanText(file.mimeType, 120),
    sizeBytes: buffer.length,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    buffer
  };
}

function decodeBase64Strict(value, filePath) {
  const normalized = value.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw createBundleError('HEAVY_FRONTEND_INVALID_BASE64', filePath);
  }
  const buffer = Buffer.from(normalized, 'base64');
  if (buffer.toString('base64').replace(/=+$/, '') !== normalized.replace(/=+$/, '')) {
    throw createBundleError('HEAVY_FRONTEND_INVALID_BASE64', filePath);
  }
  return buffer;
}

function resolveEntryPath(requestedEntry, files) {
  const paths = new Set(files.map((file) => file.path));
  if (requestedEntry) {
    const normalized = safeHeavyFrontendPath(requestedEntry);
    if (!paths.has(normalized)) throw createBundleError('HEAVY_FRONTEND_ENTRY_NOT_FOUND', normalized);
    if (!/\.html?$/i.test(normalized)) throw createBundleError('HEAVY_FRONTEND_ENTRY_NOT_HTML', normalized);
    return normalized;
  }
  const candidates = [
    'start-screen-noST.html',
    'start-screen-nost.html',
    'index.html',
    'start.html'
  ];
  for (const candidate of candidates) {
    const exact = files.find((file) => file.path.toLowerCase() === candidate.toLowerCase());
    if (exact) return exact.path;
  }
  const htmlFiles = files.filter((file) => /\.html?$/i.test(file.path));
  if (htmlFiles.length === 1) return htmlFiles[0].path;
  throw createBundleError('HEAVY_FRONTEND_ENTRY_REQUIRED');
}

function findDuplicatePath(files) {
  const seen = new Set();
  for (const file of files) {
    const key = file.path.toLowerCase();
    if (seen.has(key)) return file.path;
    seen.add(key);
  }
  return '';
}

function hashBundle(files) {
  const hash = crypto.createHash('sha256');
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(file.path);
    hash.update('\0');
    hash.update(file.sha256);
    hash.update('\n');
  }
  return hash.digest('hex');
}

function cleanText(value, maxLength) {
  return String(value || '').trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maxLength);
}

function compactExcerpt(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 180);
}

function createBundleError(code, detail = '') {
  const error = new Error(code);
  error.code = code;
  error.detail = detail;
  return error;
}

export const HEAVY_FRONTEND_LIMITS = Object.freeze({
  maxFileCount: MAX_FILE_COUNT,
  maxTotalBytes: MAX_TOTAL_BYTES,
  maxFileBytes: MAX_FILE_BYTES
});
