import { readFile } from 'node:fs/promises';
import path from 'node:path';

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8']
]);

export function createApp({ rootDir }) {
  return async function app(req, res) {
    try {
      if (req.url === '/api/health') {
        writeJson(res, 200, { ok: true, app: 'local-roleplay-agent' });
        return;
      }

      const url = new URL(req.url, 'http://localhost');
      const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
      const filePath = path.join(rootDir, 'public', pathname);
      const body = await readFile(filePath);
      const ext = path.extname(filePath);
      res.writeHead(200, { 'content-type': contentTypes.get(ext) || 'application/octet-stream' });
      res.end(body);
    } catch (error) {
      if (error.code === 'ENOENT') {
        writeJson(res, 404, { error: 'NOT_FOUND' });
        return;
      }
      writeJson(res, 500, { error: 'INTERNAL_ERROR', message: error.message });
    }
  };
}

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}
