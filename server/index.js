import { createServer } from 'node:http';
import { createApp } from './app.js';

const port = Number(process.env.PORT || 5177);
const app = createApp({ rootDir: process.cwd() });
const server = createServer(app);

server.listen(port, '127.0.0.1', () => {
  console.log(`Local roleplay agent running at http://127.0.0.1:${port}`);
});
