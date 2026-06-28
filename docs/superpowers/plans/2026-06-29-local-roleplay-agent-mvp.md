# 本地角色扮演 Agent MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个可在本地网页访问的角色扮演 agent MVP，支持外部 OpenAI-compatible API、可编辑 prompt/世界书、分层记忆、自动总结调度和会话存档。

**Architecture:** 使用零依赖 Node.js 本地服务承载静态网页、HTTP API、JSON 存储和 agent runtime。Agent runtime 负责组装 prompt、检索世界书/记忆、调用 provider、保存会话、更新事件账本，并在满足条件时触发滚动摘要。

**Tech Stack:** Node.js ESM、Node 内置 `http`、Node 内置 `node:test`、原生 HTML/CSS/JavaScript、本地 JSON 文件存储。

---

## 范围说明

这份计划实现第一版可运行 MVP。它不引入 React/Vite/数据库/向量检索，优先保证本地可运行、代码结构清晰、agent loop 可观察。

当前目录不是 git 仓库。Task 1 会初始化 git，这样后续任务可以按计划提交。

## 文件结构

```text
package.json                         项目脚本和 Node ESM 配置
.gitignore                           忽略本地密钥、会话数据和临时文件
server/index.js                      启动 HTTP 服务
server/app.js                        路由分发、JSON 解析、静态文件服务
server/lib/jsonStore.js              安全读写 JSON 文件
server/lib/http.js                   HTTP 辅助函数
server/config/defaults.js            默认 prompt、世界书、记忆配置
server/config/configService.js        provider/prompt/worldBook 配置读写
server/agent/token.js                token 粗略估算
server/agent/memoryRetriever.js       世界书和记忆卡片检索
server/agent/promptAssembler.js       prompt 组装
server/agent/summaryScheduler.js      自动总结触发判断和总结 prompt 构造
server/agent/memoryUpdater.js         事件账本和结构化状态更新
server/provider/openaiCompatible.js   OpenAI-compatible 请求构建和调用
server/services/sessionService.js     会话读写、快照导入导出
server/services/agentService.js       单轮 agent loop
public/index.html                    本地网页入口
public/styles.css                    页面样式
public/app.js                        浏览器端状态、API 调用和渲染
data/config/providers.local.json      本地 provider 配置，git 忽略
data/config/prompt-modules.json       可编辑 prompt 模块
data/config/world-book.json           可编辑世界书
data/sessions/*.json                 会话数据，git 忽略
tests/*.test.js                      Node 内置测试
```

---

### Task 1: 项目脚手架和测试命令

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `server/index.js`
- Create: `server/app.js`
- Create: `public/index.html`
- Create: `tests/smoke.test.js`

- [ ] **Step 1: 初始化 git 仓库**

Run:

```bash
git init
```

Expected: 输出包含 `Initialized empty Git repository` 或 `Reinitialized existing Git repository`。

- [ ] **Step 2: 写入最小项目文件**

Create `package.json`:

```json
{
  "name": "local-roleplay-agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node server/index.js",
    "start": "node server/index.js",
    "test": "node --test"
  },
  "engines": {
    "node": ">=20"
  }
}
```

Create `.gitignore`:

```gitignore
node_modules/
.DS_Store
data/config/providers.local.json
data/sessions/
data/exports/
.superpowers/
work/
```

Create `server/index.js`:

```js
import { createServer } from 'node:http';
import { createApp } from './app.js';

const port = Number(process.env.PORT || 5177);
const app = createApp({ rootDir: process.cwd() });
const server = createServer(app);

server.listen(port, '127.0.0.1', () => {
  console.log(`Local roleplay agent running at http://127.0.0.1:${port}`);
});
```

Create `server/app.js`:

```js
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
```

Create `public/index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>本地角色扮演 Agent</title>
  </head>
  <body>
    <main>
      <h1>本地角色扮演 Agent</h1>
      <p>服务已启动。</p>
    </main>
  </body>
</html>
```

Create `tests/smoke.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';

test('createApp returns a request handler', () => {
  const app = createApp({ rootDir: process.cwd() });
  assert.equal(typeof app, 'function');
});
```

- [ ] **Step 3: 运行测试**

Run:

```bash
npm test
```

Expected: `tests/smoke.test.js` PASS。

- [ ] **Step 4: 提交**

```bash
git add package.json .gitignore server public tests
git commit -m "chore: scaffold local roleplay agent"
```

Expected: commit 成功。

---

### Task 2: JSON 存储层

**Files:**
- Create: `server/lib/jsonStore.js`
- Test: `tests/jsonStore.test.js`

- [ ] **Step 1: 写失败测试**

Create `tests/jsonStore.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../server/lib/jsonStore.js';

test('JsonStore writes and reads JSON under the root directory', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-store-'));
  const store = new JsonStore(root);
  await store.write('config/example.json', { name: '神荒武界', count: 1 });
  const loaded = await store.read('config/example.json', {});
  assert.deepEqual(loaded, { name: '神荒武界', count: 1 });
});

test('JsonStore returns fallback when file is missing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-store-'));
  const store = new JsonStore(root);
  const loaded = await store.read('missing.json', { ok: true });
  assert.deepEqual(loaded, { ok: true });
});

test('JsonStore blocks path traversal', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-store-'));
  const store = new JsonStore(root);
  await assert.rejects(() => store.write('../escape.json', {}), /Path escapes store root/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm test -- tests/jsonStore.test.js
```

Expected: FAIL，错误包含 `Cannot find module '../server/lib/jsonStore.js'`。

- [ ] **Step 3: 实现 JSON 存储**

Create `server/lib/jsonStore.js`:

```js
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export class JsonStore {
  constructor(rootDir) {
    this.rootDir = path.resolve(rootDir);
  }

  resolve(relativePath) {
    const absolutePath = path.resolve(this.rootDir, relativePath);
    if (!absolutePath.startsWith(this.rootDir + path.sep) && absolutePath !== this.rootDir) {
      throw new Error(`Path escapes store root: ${relativePath}`);
    }
    return absolutePath;
  }

  async read(relativePath, fallbackValue) {
    try {
      const filePath = this.resolve(relativePath);
      const raw = await readFile(filePath, 'utf8');
      return JSON.parse(raw);
    } catch (error) {
      if (error.code === 'ENOENT') return structuredClone(fallbackValue);
      throw error;
    }
  }

  async write(relativePath, value) {
    const filePath = this.resolve(relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    const body = `${JSON.stringify(value, null, 2)}\n`;
    await writeFile(filePath, body, 'utf8');
    return value;
  }

  async list(relativeDir) {
    try {
      const dirPath = this.resolve(relativeDir);
      return await readdir(dirPath);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
npm test -- tests/jsonStore.test.js
```

Expected: `tests/jsonStore.test.js` PASS。

- [ ] **Step 5: 提交**

```bash
git add server/lib/jsonStore.js tests/jsonStore.test.js
git commit -m "feat: add local json store"
```

---

### Task 3: 默认配置和配置服务

**Files:**
- Create: `server/config/defaults.js`
- Create: `server/config/configService.js`
- Test: `tests/configService.test.js`

- [ ] **Step 1: 写失败测试**

Create `tests/configService.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../server/lib/jsonStore.js';
import { ConfigService } from '../server/config/configService.js';

test('ConfigService returns seeded prompt modules and world book', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-config-'));
  const service = new ConfigService(new JsonStore(root));
  const state = await service.getAll();
  assert.equal(state.promptModules.length >= 5, true);
  assert.equal(state.worldBook.length >= 3, true);
  assert.equal(state.providers.activeProviderId, '');
});

test('ConfigService saves provider config without touching prompt modules', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-config-'));
  const service = new ConfigService(new JsonStore(root));
  await service.saveProviders({
    activeProviderId: 'local',
    providers: [{
      id: 'local',
      kind: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'secret',
      model: 'model-a',
      temperature: 0.9,
      maxTokens: 2000,
      headers: {}
    }]
  });
  const state = await service.getAll();
  assert.equal(state.providers.activeProviderId, 'local');
  assert.equal(state.promptModules.length >= 5, true);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm test -- tests/configService.test.js
```

Expected: FAIL，错误包含 `Cannot find module '../server/config/configService.js'`。

- [ ] **Step 3: 实现默认配置**

Create `server/config/defaults.js`:

```js
export const defaultProviders = {
  activeProviderId: '',
  providers: []
};

export const defaultPromptModules = [
  {
    id: 'core-rules',
    title: '核心规则',
    enabled: true,
    content: [
      '你是一个用于个人创作的角色扮演叙事 agent。',
      '保持世界观、角色关系、时间线和因果一致。',
      '不要主动跳出角色解释系统机制，除非用户明确要求。',
      '优先推进剧情，同时尊重用户输入的行动意图。'
    ].join('\n')
  },
  {
    id: 'world-premise',
    title: '世界观基调',
    enabled: true,
    content: '这是一个高武、玄幻、武侠混合的大世界。武道、宗门、朝廷、帮派和隐秘势力共同塑造江湖格局。'
  },
  {
    id: 'memory-rules',
    title: '记忆规则',
    enabled: true,
    content: '优先遵守结构化世界状态、滚动摘要和最近对话。不要改写已经确认的长期事实。'
  },
  {
    id: 'output-format',
    title: '输出格式',
    enabled: true,
    content: '使用沉浸式中文叙事。必要时用简短状态面板呈现地点、人物、风险和可选行动。'
  },
  {
    id: 'personal-creative-mode',
    title: 'Personal Creative Mode',
    enabled: true,
    content: '这是用户的本地个人创作工具。应用层不增加限制词、敏感词规避或题材过滤。'
  }
];

export const defaultWorldBook = [
  {
    id: 'faction-zhenwusi',
    type: 'faction',
    title: '朝廷镇武司',
    keywords: ['镇武司', '朝廷', '缉拿', '官府'],
    content: '镇武司是朝廷约束江湖武人的暴力机构，掌管缉捕、审讯、密探和禁武律。',
    priority: 70,
    depth: 4,
    scope: 'prompt',
    enabled: true,
    source: 'seed',
    updatedAt: '2026-06-29T00:00:00.000Z'
  },
  {
    id: 'faction-tingyulou',
    type: 'faction',
    title: '听雨楼',
    keywords: ['听雨楼', '刺客', '情报', '杀手'],
    content: '听雨楼以刺杀和情报闻名，楼中人行事隐秘，常以价码衡量恩怨。',
    priority: 65,
    depth: 4,
    scope: 'prompt',
    enabled: true,
    source: 'seed',
    updatedAt: '2026-06-29T00:00:00.000Z'
  },
  {
    id: 'realm-martial',
    type: 'realm',
    title: '武道境界',
    keywords: ['境界', '突破', '修为', '武道'],
    content: '武道境界决定气血、真气、神意和战斗上限。突破需要资源、悟性、机缘和代价。',
    priority: 80,
    depth: 5,
    scope: 'prompt',
    enabled: true,
    source: 'seed',
    updatedAt: '2026-06-29T00:00:00.000Z'
  }
];
```

- [ ] **Step 4: 实现配置服务**

Create `server/config/configService.js`:

```js
import { defaultPromptModules, defaultProviders, defaultWorldBook } from './defaults.js';

export class ConfigService {
  constructor(store) {
    this.store = store;
  }

  async getAll() {
    const providers = await this.store.read('config/providers.local.json', defaultProviders);
    const promptModules = await this.store.read('config/prompt-modules.json', defaultPromptModules);
    const worldBook = await this.store.read('config/world-book.json', defaultWorldBook);
    return { providers, promptModules, worldBook };
  }

  async saveProviders(providers) {
    return this.store.write('config/providers.local.json', normalizeProviders(providers));
  }

  async savePromptModules(promptModules) {
    return this.store.write('config/prompt-modules.json', promptModules.map(normalizePromptModule));
  }

  async saveWorldBook(worldBook) {
    return this.store.write('config/world-book.json', worldBook.map(normalizeWorldBookEntry));
  }
}

function normalizeProviders(value) {
  return {
    activeProviderId: String(value.activeProviderId || ''),
    providers: Array.isArray(value.providers) ? value.providers.map((provider) => ({
      id: String(provider.id || ''),
      kind: provider.kind === 'openai-compatible' ? provider.kind : 'openai-compatible',
      baseUrl: String(provider.baseUrl || ''),
      apiKey: String(provider.apiKey || ''),
      model: String(provider.model || ''),
      temperature: Number(provider.temperature ?? 0.9),
      maxTokens: Number(provider.maxTokens ?? 2000),
      headers: provider.headers && typeof provider.headers === 'object' ? provider.headers : {}
    })) : []
  };
}

function normalizePromptModule(module) {
  return {
    id: String(module.id || crypto.randomUUID()),
    title: String(module.title || '未命名模块'),
    enabled: Boolean(module.enabled),
    content: String(module.content || '')
  };
}

function normalizeWorldBookEntry(entry) {
  return {
    id: String(entry.id || crypto.randomUUID()),
    type: String(entry.type || 'memory'),
    title: String(entry.title || '未命名条目'),
    keywords: Array.isArray(entry.keywords) ? entry.keywords.map(String) : [],
    content: String(entry.content || ''),
    priority: Number(entry.priority ?? 50),
    depth: Number(entry.depth ?? 4),
    scope: String(entry.scope || 'prompt'),
    enabled: Boolean(entry.enabled),
    source: String(entry.source || 'manual'),
    updatedAt: String(entry.updatedAt || new Date().toISOString())
  };
}
```

- [ ] **Step 5: 运行测试确认通过**

Run:

```bash
npm test -- tests/configService.test.js
```

Expected: `tests/configService.test.js` PASS。

- [ ] **Step 6: 提交**

```bash
git add server/config tests/configService.test.js
git commit -m "feat: add editable agent config"
```

---

### Task 4: Prompt 组装、token 估算和世界书检索

**Files:**
- Create: `server/agent/token.js`
- Create: `server/agent/memoryRetriever.js`
- Create: `server/agent/promptAssembler.js`
- Test: `tests/promptAssembler.test.js`

- [ ] **Step 1: 写失败测试**

Create `tests/promptAssembler.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { assemblePrompt } from '../server/agent/promptAssembler.js';
import { estimateTokens } from '../server/agent/token.js';

test('estimateTokens gives non-zero estimate for Chinese text', () => {
  assert.equal(estimateTokens('神荒武界'), 4);
});

test('assemblePrompt includes modules, state, summary, matched world book, and recent messages', () => {
  const result = assemblePrompt({
    promptModules: [{ id: 'core', title: '核心', enabled: true, content: '保持角色一致。' }],
    worldBook: [{
      id: 'wb-1',
      title: '镇武司',
      keywords: ['镇武司'],
      content: '镇武司负责约束江湖武人。',
      priority: 80,
      enabled: true
    }],
    memory: {
      rollingSummary: '主角刚到城中。',
      worldState: { protagonist: { name: '李青' }, location: { current: '云州城' } },
      memoryCards: []
    },
    messages: [
      { role: 'user', content: '我走进云州城。' },
      { role: 'assistant', content: '城门外风雪未歇。' }
    ],
    userMessage: '我要去镇武司附近打探消息。',
    options: { recentPairs: 4, maxPromptTokens: 2000, maxInjectedCards: 3 }
  });

  assert.equal(result.messages.at(-1).role, 'user');
  assert.equal(result.injectedCards.length, 1);
  assert.match(result.messages[0].content, /保持角色一致/);
  assert.match(result.messages[0].content, /镇武司负责约束江湖武人/);
  assert.match(result.messages[0].content, /云州城/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm test -- tests/promptAssembler.test.js
```

Expected: FAIL，错误包含 `Cannot find module '../server/agent/promptAssembler.js'`。

- [ ] **Step 3: 实现 token 估算**

Create `server/agent/token.js`:

```js
export function estimateTokens(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return 0;
  let estimate = 0;
  for (const char of text) {
    estimate += /[\u4e00-\u9fff]/.test(char) ? 1 : 0.35;
  }
  return Math.max(1, Math.ceil(estimate));
}
```

- [ ] **Step 4: 实现世界书检索**

Create `server/agent/memoryRetriever.js`:

```js
export function retrieveCards({ query, worldBook = [], memoryCards = [], maxCards = 5 }) {
  const candidates = [...worldBook, ...memoryCards]
    .filter((card) => card && card.enabled !== false && String(card.content || '').trim())
    .map((card) => ({ card, score: scoreCard(card, query) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || String(left.card.title).localeCompare(String(right.card.title)));

  return candidates.slice(0, maxCards).map((item) => item.card);
}

function scoreCard(card, query) {
  const text = String(query || '').toLowerCase();
  const keywords = Array.isArray(card.keywords) ? card.keywords : [];
  const hitScore = keywords.reduce((score, keyword) => {
    const normalized = String(keyword || '').toLowerCase();
    if (!normalized) return score;
    return text.includes(normalized) ? score + 100 : score;
  }, 0);
  const priority = Number(card.priority ?? 50);
  return hitScore + priority / 10;
}
```

- [ ] **Step 5: 实现 prompt 组装器**

Create `server/agent/promptAssembler.js`:

```js
import { estimateTokens } from './token.js';
import { retrieveCards } from './memoryRetriever.js';

export function assemblePrompt({
  promptModules,
  worldBook,
  memory,
  messages,
  userMessage,
  options = {}
}) {
  const recentPairs = Number(options.recentPairs ?? 8);
  const maxInjectedCards = Number(options.maxInjectedCards ?? 5);
  const memoryCards = Array.isArray(memory?.memoryCards) ? memory.memoryCards : [];
  const query = [userMessage, ...messages.slice(-recentPairs * 2).map((message) => message.content)].join('\n');
  const injectedCards = retrieveCards({ query, worldBook, memoryCards, maxCards: maxInjectedCards });

  const systemSections = [
    renderPromptModules(promptModules),
    renderWorldState(memory?.worldState),
    renderRollingSummary(memory?.rollingSummary),
    renderCards(injectedCards)
  ].filter(Boolean);

  const recentMessages = messages.slice(-recentPairs * 2).map((message) => ({
    role: message.role,
    content: String(message.content || '')
  }));

  const assembledMessages = [
    { role: 'system', content: systemSections.join('\n\n') },
    ...recentMessages,
    { role: 'user', content: String(userMessage || '') }
  ];

  const tokenEstimate = estimateTokens(assembledMessages.map((message) => `${message.role}: ${message.content}`).join('\n'));
  return {
    messages: assembledMessages,
    tokenEstimate,
    injectedCards,
    sections: {
      promptModules: promptModules.filter((module) => module.enabled !== false).map((module) => module.id),
      hasWorldState: Boolean(memory?.worldState),
      hasRollingSummary: Boolean(memory?.rollingSummary),
      injectedCardIds: injectedCards.map((card) => card.id)
    }
  };
}

function renderPromptModules(promptModules = []) {
  const enabled = promptModules.filter((module) => module.enabled !== false && String(module.content || '').trim());
  if (!enabled.length) return '';
  return ['# Prompt 模块', ...enabled.map((module) => `## ${module.title}\n${module.content}`)].join('\n\n');
}

function renderWorldState(worldState) {
  if (!worldState) return '';
  return `# 结构化世界状态\n${JSON.stringify(worldState, null, 2)}`;
}

function renderRollingSummary(summary) {
  if (!String(summary || '').trim()) return '';
  return `# 滚动摘要\n${summary}`;
}

function renderCards(cards) {
  if (!cards.length) return '';
  return ['# 本轮注入的世界书和记忆', ...cards.map((card) => `## ${card.title}\n${card.content}`)].join('\n\n');
}
```

- [ ] **Step 6: 运行测试确认通过**

Run:

```bash
npm test -- tests/promptAssembler.test.js
```

Expected: `tests/promptAssembler.test.js` PASS。

- [ ] **Step 7: 提交**

```bash
git add server/agent tests/promptAssembler.test.js
git commit -m "feat: assemble prompts with memory retrieval"
```

---

### Task 5: Provider 客户端

**Files:**
- Create: `server/provider/openaiCompatible.js`
- Test: `tests/providerClient.test.js`

- [ ] **Step 1: 写失败测试**

Create `tests/providerClient.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenAICompatibleRequest, readOpenAICompatibleResponse } from '../server/provider/openaiCompatible.js';

test('buildOpenAICompatibleRequest builds chat completions request', () => {
  const { url, init } = buildOpenAICompatibleRequest({
    provider: {
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'secret',
      model: 'model-a',
      temperature: 0.8,
      maxTokens: 1234,
      headers: { 'x-test': 'yes' }
    },
    messages: [{ role: 'user', content: '你好' }]
  });

  assert.equal(url, 'https://api.example.com/v1/chat/completions');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.authorization, 'Bearer secret');
  assert.equal(init.headers['x-test'], 'yes');
  assert.equal(JSON.parse(init.body).model, 'model-a');
});

test('readOpenAICompatibleResponse extracts assistant content', async () => {
  const response = new Response(JSON.stringify({
    choices: [{ message: { content: '江湖夜雨。' } }]
  }), { status: 200 });

  const result = await readOpenAICompatibleResponse(response);
  assert.equal(result.content, '江湖夜雨。');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm test -- tests/providerClient.test.js
```

Expected: FAIL，错误包含 `Cannot find module '../server/provider/openaiCompatible.js'`。

- [ ] **Step 3: 实现 provider 客户端**

Create `server/provider/openaiCompatible.js`:

```js
export function buildOpenAICompatibleRequest({ provider, messages }) {
  const baseUrl = String(provider.baseUrl || '').replace(/\/+$/, '');
  const url = `${baseUrl}/chat/completions`;
  const body = {
    model: provider.model,
    messages,
    temperature: Number(provider.temperature ?? 0.9),
    max_tokens: Number(provider.maxTokens ?? 2000)
  };

  return {
    url,
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${provider.apiKey}`,
        ...(provider.headers || {})
      },
      body: JSON.stringify(body)
    }
  };
}

export async function callOpenAICompatible({ provider, messages, fetchImpl = fetch }) {
  const { url, init } = buildOpenAICompatibleRequest({ provider, messages });
  const response = await fetchImpl(url, init);
  return readOpenAICompatibleResponse(response);
}

export async function readOpenAICompatibleResponse(response) {
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Provider returned non-JSON response: ${text.slice(0, 160)}`);
  }

  if (!response.ok) {
    throw new Error(`Provider error ${response.status}: ${JSON.stringify(payload).slice(0, 240)}`);
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`Provider response missing assistant content: ${JSON.stringify(payload).slice(0, 240)}`);
  }

  return {
    content,
    raw: payload
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
npm test -- tests/providerClient.test.js
```

Expected: `tests/providerClient.test.js` PASS。

- [ ] **Step 5: 提交**

```bash
git add server/provider tests/providerClient.test.js
git commit -m "feat: add openai compatible provider client"
```

---

### Task 6: 会话服务、记忆更新和自动总结调度

**Files:**
- Create: `server/agent/summaryScheduler.js`
- Create: `server/agent/memoryUpdater.js`
- Create: `server/services/sessionService.js`
- Create: `server/services/agentService.js`
- Test: `tests/agentService.test.js`

- [ ] **Step 1: 写失败测试**

Create `tests/agentService.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../server/lib/jsonStore.js';
import { ConfigService } from '../server/config/configService.js';
import { SessionService } from '../server/services/sessionService.js';
import { AgentService } from '../server/services/agentService.js';

test('AgentService runs one chat turn and records memory metadata', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-loop-'));
  const store = new JsonStore(root);
  const configService = new ConfigService(store);
  await configService.saveProviders({
    activeProviderId: 'fake',
    providers: [{
      id: 'fake',
      kind: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'secret',
      model: 'fake-model',
      temperature: 0.9,
      maxTokens: 2000,
      headers: {}
    }]
  });

  const providerClient = {
    complete: async ({ messages }) => ({
      content: `回应：${messages.at(-1).content}`,
      raw: { fake: true }
    })
  };

  const service = new AgentService({
    configService,
    sessionService: new SessionService(store),
    providerClient
  });

  const result = await service.sendMessage({ sessionId: 'main', content: '我去镇武司。' });
  assert.equal(result.session.messages.length, 2);
  assert.equal(result.session.memory.eventLedger.length, 1);
  assert.equal(result.debug.injectedCards.length, 1);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm test -- tests/agentService.test.js
```

Expected: FAIL，错误包含 `Cannot find module '../server/services/sessionService.js'`。

- [ ] **Step 3: 实现自动总结调度**

Create `server/agent/summaryScheduler.js`:

```js
export function shouldSummarize({ unsummarizedTurnCount, promptTokenEstimate, maxPromptTokens }) {
  if (Number(unsummarizedTurnCount) >= 4) return true;
  if (Number(promptTokenEstimate) > Number(maxPromptTokens || 8000) * 0.85) return true;
  return false;
}

export function buildSummaryPrompt({ rollingSummary, messages }) {
  const transcript = messages.map((message) => `${message.role}: ${message.content}`).join('\n');
  return [
    { role: 'system', content: '你是长篇角色扮演的记忆整理器。请用中文更新滚动摘要，保留事实、关系、目标、承诺和未完成线索。不要添加原文没有确认的事实。' },
    { role: 'user', content: `旧摘要：\n${rollingSummary || '无'}\n\n新增对话：\n${transcript}\n\n请输出新的滚动摘要。` }
  ];
}
```

- [ ] **Step 4: 实现记忆更新器**

Create `server/agent/memoryUpdater.js`:

```js
export function createDefaultMemory() {
  return {
    rollingSummary: '',
    unsummarizedTurnCount: 0,
    worldState: {
      protagonist: { name: '', realm: '', traits: [], injuries: [], inventory: [] },
      location: { current: '', knownPlaces: [] },
      relationships: [],
      quests: [],
      factions: [],
      flags: {},
      timeline: []
    },
    memoryCards: [],
    eventLedger: []
  };
}

export function appendTurnEvent({ memory, userMessage, assistantMessage, turnId }) {
  const next = structuredClone(memory || createDefaultMemory());
  next.eventLedger.push({
    id: `event-${turnId}`,
    turnId,
    timestamp: new Date().toISOString(),
    actor: 'system',
    summary: summarizeTurn(userMessage, assistantMessage),
    effects: [],
    sourceMessageId: assistantMessage.id,
    confidence: 0.5
  });
  next.unsummarizedTurnCount = Number(next.unsummarizedTurnCount || 0) + 1;
  return next;
}

function summarizeTurn(userMessage, assistantMessage) {
  const user = String(userMessage.content || '').slice(0, 120);
  const assistant = String(assistantMessage.content || '').slice(0, 160);
  return `用户行动：${user}\n回应摘要：${assistant}`;
}
```

- [ ] **Step 5: 实现会话服务**

Create `server/services/sessionService.js`:

```js
import { createDefaultMemory } from '../agent/memoryUpdater.js';

export class SessionService {
  constructor(store) {
    this.store = store;
  }

  async getSession(sessionId = 'main') {
    return this.store.read(`sessions/${sessionId}.json`, createSession(sessionId));
  }

  async saveSession(session) {
    return this.store.write(`sessions/${session.id}.json`, session);
  }

  async listSessions() {
    const files = await this.store.list('sessions');
    return files.filter((file) => file.endsWith('.json')).map((file) => file.replace(/\.json$/, ''));
  }
}

function createSession(id) {
  return {
    id,
    title: '新的江湖',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [],
    memory: createDefaultMemory(),
    settings: {
      recentPairs: 8,
      maxPromptTokens: 8000,
      maxInjectedCards: 5
    }
  };
}
```

- [ ] **Step 6: 实现 agent service**

Create `server/services/agentService.js`:

```js
import { assemblePrompt } from '../agent/promptAssembler.js';
import { appendTurnEvent } from '../agent/memoryUpdater.js';
import { buildSummaryPrompt, shouldSummarize } from '../agent/summaryScheduler.js';

export class AgentService {
  constructor({ configService, sessionService, providerClient }) {
    this.configService = configService;
    this.sessionService = sessionService;
    this.providerClient = providerClient;
  }

  async sendMessage({ sessionId = 'main', content }) {
    const [config, session] = await Promise.all([
      this.configService.getAll(),
      this.sessionService.getSession(sessionId)
    ]);
    const provider = config.providers.providers.find((item) => item.id === config.providers.activeProviderId);
    if (!provider) throw new Error('NO_ACTIVE_PROVIDER');

    const userMessage = createMessage('user', content);
    const assembled = assemblePrompt({
      promptModules: config.promptModules,
      worldBook: config.worldBook,
      memory: session.memory,
      messages: session.messages,
      userMessage: content,
      options: session.settings
    });

    const assistantResult = await this.providerClient.complete({
      provider,
      messages: assembled.messages
    });
    const assistantMessage = createMessage('assistant', assistantResult.content);

    session.messages.push(userMessage, assistantMessage);
    session.memory = appendTurnEvent({
      memory: session.memory,
      userMessage,
      assistantMessage,
      turnId: assistantMessage.id
    });

    if (shouldSummarize({
      unsummarizedTurnCount: session.memory.unsummarizedTurnCount,
      promptTokenEstimate: assembled.tokenEstimate,
      maxPromptTokens: session.settings.maxPromptTokens
    })) {
      await this.trySummarize({ session, provider });
    }

    session.updatedAt = new Date().toISOString();
    await this.sessionService.saveSession(session);
    return {
      session,
      reply: assistantMessage,
      debug: assembled
    };
  }

  async trySummarize({ session, provider }) {
    const recent = session.messages.slice(-8);
    try {
      const result = await this.providerClient.complete({
        provider,
        messages: buildSummaryPrompt({
          rollingSummary: session.memory.rollingSummary,
          messages: recent
        })
      });
      session.memory.rollingSummary = result.content;
      session.memory.unsummarizedTurnCount = 0;
      session.memory.lastSummaryError = '';
    } catch (error) {
      session.memory.lastSummaryError = error.message;
    }
  }
}

function createMessage(role, content) {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content: String(content || ''),
    createdAt: new Date().toISOString()
  };
}
```

- [ ] **Step 7: 运行测试确认通过**

Run:

```bash
npm test -- tests/agentService.test.js
```

Expected: `tests/agentService.test.js` PASS。

- [ ] **Step 8: 提交**

```bash
git add server/agent server/services tests/agentService.test.js
git commit -m "feat: add roleplay agent loop"
```

---

### Task 7: HTTP API

**Files:**
- Create: `server/lib/http.js`
- Modify: `server/app.js`
- Test: `tests/httpApi.test.js`

- [ ] **Step 1: 写失败测试**

Create `tests/httpApi.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';

test('GET /api/state returns config and session', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'agent-http-'));
  const server = createServer(createApp({ rootDir }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;

  const response = await fetch(`http://127.0.0.1:${port}/api/state`);
  const payload = await response.json();
  server.close();

  assert.equal(response.status, 200);
  assert.equal(payload.session.id, 'main');
  assert.equal(Array.isArray(payload.config.promptModules), true);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm test -- tests/httpApi.test.js
```

Expected: FAIL，`/api/state` 返回 404 或没有 `payload.session`。

- [ ] **Step 3: 实现 HTTP 辅助函数**

Create `server/lib/http.js`:

```js
export async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

export function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}
```

- [ ] **Step 4: 替换 app 路由**

Replace `server/app.js` with:

```js
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { JsonStore } from './lib/jsonStore.js';
import { readJson, writeJson } from './lib/http.js';
import { ConfigService } from './config/configService.js';
import { SessionService } from './services/sessionService.js';
import { AgentService } from './services/agentService.js';
import { callOpenAICompatible } from './provider/openaiCompatible.js';

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8']
]);

export function createApp({ rootDir }) {
  const store = new JsonStore(path.join(rootDir, 'data'));
  const configService = new ConfigService(store);
  const sessionService = new SessionService(store);
  const providerClient = {
    complete: ({ provider, messages }) => callOpenAICompatible({ provider, messages })
  };
  const agentService = new AgentService({ configService, sessionService, providerClient });

  return async function app(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        await handleApi({ req, res, url, configService, sessionService, agentService });
        return;
      }
      await serveStatic({ rootDir, pathname: url.pathname, res });
    } catch (error) {
      writeJson(res, 500, { error: 'INTERNAL_ERROR', message: error.message });
    }
  };
}

async function handleApi({ req, res, url, configService, sessionService, agentService }) {
  if (req.method === 'GET' && url.pathname === '/api/health') {
    writeJson(res, 200, { ok: true, app: 'local-roleplay-agent' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/state') {
    const [config, session] = await Promise.all([
      configService.getAll(),
      sessionService.getSession('main')
    ]);
    writeJson(res, 200, { config: maskConfig(config), session });
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/providers') {
    const body = await readJson(req);
    await configService.saveProviders(body);
    writeJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/prompt-modules') {
    const body = await readJson(req);
    const value = await configService.savePromptModules(body.promptModules || []);
    writeJson(res, 200, { promptModules: value });
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/world-book') {
    const body = await readJson(req);
    const value = await configService.saveWorldBook(body.worldBook || []);
    writeJson(res, 200, { worldBook: value });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/chat') {
    const body = await readJson(req);
    const result = await agentService.sendMessage({ sessionId: body.sessionId || 'main', content: body.content });
    writeJson(res, 200, result);
    return;
  }

  writeJson(res, 404, { error: 'NOT_FOUND' });
}

async function serveStatic({ rootDir, pathname, res }) {
  const safePathname = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(rootDir, 'public', safePathname);
  const body = await readFile(filePath);
  const ext = path.extname(filePath);
  res.writeHead(200, { 'content-type': contentTypes.get(ext) || 'application/octet-stream' });
  res.end(body);
}

function maskConfig(config) {
  return {
    ...config,
    providers: {
      ...config.providers,
      providers: config.providers.providers.map((provider) => ({
        ...provider,
        apiKey: provider.apiKey ? '********' : ''
      }))
    }
  };
}
```

- [ ] **Step 5: 运行 API 测试**

Run:

```bash
npm test -- tests/httpApi.test.js
```

Expected: `tests/httpApi.test.js` PASS。

- [ ] **Step 6: 运行全量测试**

Run:

```bash
npm test
```

Expected: 所有测试 PASS。

- [ ] **Step 7: 提交**

```bash
git add server/app.js server/lib/http.js tests/httpApi.test.js
git commit -m "feat: expose local agent api"
```

---

### Task 8: 本地网页工作台

**Files:**
- Modify: `public/index.html`
- Create: `public/styles.css`
- Create: `public/app.js`

- [ ] **Step 1: 替换 HTML**

Replace `public/index.html` with:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>本地角色扮演 Agent</title>
    <link rel="stylesheet" href="/styles.css">
  </head>
  <body>
    <div class="app-shell">
      <aside class="side-panel">
        <h1>本地 RP Agent</h1>
        <label>Provider ID<input id="provider-id" placeholder="default"></label>
        <label>Base URL<input id="provider-base-url" placeholder="https://api.example.com/v1"></label>
        <label>API Key<input id="provider-api-key" type="password" placeholder="仅保存在本地"></label>
        <label>Model<input id="provider-model" placeholder="model-name"></label>
        <button id="save-provider">保存 Provider</button>
        <p id="provider-status" class="muted"></p>
      </aside>

      <main class="chat-panel">
        <header class="topbar">
          <div>
            <strong id="session-title">新的江湖</strong>
            <span id="agent-status" class="muted">未连接</span>
          </div>
          <button id="refresh-state">刷新</button>
        </header>
        <section id="messages" class="messages"></section>
        <form id="chat-form" class="composer">
          <textarea id="chat-input" rows="3" placeholder="输入你的行动、对白或创作指令"></textarea>
          <button type="submit">发送</button>
        </form>
      </main>

      <aside class="inspector">
        <nav class="tabs">
          <button data-tab="memory" class="active">记忆</button>
          <button data-tab="worldbook">世界书</button>
          <button data-tab="prompt">Prompt</button>
        </nav>
        <section id="tab-memory" class="tab active">
          <h2>记忆状态</h2>
          <pre id="memory-view"></pre>
        </section>
        <section id="tab-worldbook" class="tab">
          <h2>世界书</h2>
          <textarea id="worldbook-editor"></textarea>
          <button id="save-worldbook">保存世界书</button>
        </section>
        <section id="tab-prompt" class="tab">
          <h2>Prompt 模块</h2>
          <textarea id="prompt-editor"></textarea>
          <button id="save-prompt">保存 Prompt</button>
        </section>
      </aside>
    </div>
    <script type="module" src="/app.js"></script>
  </body>
</html>
```

- [ ] **Step 2: 添加 CSS**

Create `public/styles.css`:

```css
:root {
  color-scheme: dark;
  --bg: #10100f;
  --panel: #191816;
  --panel-2: #22201d;
  --line: #3d3628;
  --text: #efe9dc;
  --muted: #aa9f8a;
  --accent: #d6ad4b;
  --danger: #d46a6a;
}

* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
}

.app-shell {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr) 360px;
  min-height: 100vh;
}

.side-panel, .inspector {
  background: var(--panel);
  border-right: 1px solid var(--line);
  padding: 16px;
  overflow: auto;
}

.inspector {
  border-right: 0;
  border-left: 1px solid var(--line);
}

h1, h2 { margin: 0 0 14px; }
h1 { font-size: 20px; color: var(--accent); }
h2 { font-size: 16px; }

label {
  display: grid;
  gap: 6px;
  margin: 12px 0;
  color: var(--muted);
  font-size: 13px;
}

input, textarea {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #0c0c0b;
  color: var(--text);
  padding: 10px;
  font: inherit;
}

textarea { resize: vertical; }
button {
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel-2);
  color: var(--text);
  padding: 9px 12px;
  cursor: pointer;
}
button:hover { border-color: var(--accent); }

.chat-panel {
  display: grid;
  grid-template-rows: auto 1fr auto;
  min-width: 0;
}

.topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--line);
  padding: 12px 16px;
  background: var(--panel);
}

.messages {
  overflow: auto;
  padding: 18px;
}

.message {
  max-width: 860px;
  margin: 0 auto 14px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  white-space: pre-wrap;
  line-height: 1.65;
}

.message.user { border-color: #4a5b7a; }
.message.assistant { border-color: #5c4b26; }
.role {
  display: block;
  margin-bottom: 6px;
  color: var(--accent);
  font-size: 12px;
}

.composer {
  display: grid;
  grid-template-columns: 1fr 96px;
  gap: 10px;
  border-top: 1px solid var(--line);
  padding: 12px;
  background: var(--panel);
}

.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.tabs button.active { border-color: var(--accent); color: var(--accent); }
.tab { display: none; }
.tab.active { display: block; }

pre {
  min-height: 220px;
  margin: 0;
  padding: 12px;
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #0c0c0b;
  color: var(--text);
}

#worldbook-editor, #prompt-editor {
  min-height: 520px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}

.muted { color: var(--muted); font-size: 12px; }

@media (max-width: 1100px) {
  .app-shell { grid-template-columns: 1fr; }
  .side-panel, .inspector { border: 0; border-bottom: 1px solid var(--line); }
}
```

- [ ] **Step 3: 添加前端逻辑**

Create `public/app.js`:

```js
const state = {
  config: null,
  session: null
};

const els = {
  messages: document.querySelector('#messages'),
  chatForm: document.querySelector('#chat-form'),
  chatInput: document.querySelector('#chat-input'),
  sessionTitle: document.querySelector('#session-title'),
  agentStatus: document.querySelector('#agent-status'),
  providerStatus: document.querySelector('#provider-status'),
  memoryView: document.querySelector('#memory-view'),
  worldbookEditor: document.querySelector('#worldbook-editor'),
  promptEditor: document.querySelector('#prompt-editor'),
  saveProvider: document.querySelector('#save-provider'),
  saveWorldbook: document.querySelector('#save-worldbook'),
  savePrompt: document.querySelector('#save-prompt'),
  refreshState: document.querySelector('#refresh-state')
};

await loadState();

els.refreshState.addEventListener('click', loadState);
els.chatForm.addEventListener('submit', sendMessage);
els.saveProvider.addEventListener('click', saveProvider);
els.saveWorldbook.addEventListener('click', saveWorldBook);
els.savePrompt.addEventListener('click', savePromptModules);

document.querySelectorAll('.tabs button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((item) => item.classList.remove('active'));
    document.querySelectorAll('.tab').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    document.querySelector(`#tab-${button.dataset.tab}`).classList.add('active');
  });
});

async function loadState() {
  const payload = await request('/api/state');
  state.config = payload.config;
  state.session = payload.session;
  render();
}

async function sendMessage(event) {
  event.preventDefault();
  const content = els.chatInput.value.trim();
  if (!content) return;
  els.chatInput.value = '';
  els.agentStatus.textContent = '生成中...';
  try {
    const payload = await request('/api/chat', {
      method: 'POST',
      body: { sessionId: state.session.id, content }
    });
    state.session = payload.session;
    els.agentStatus.textContent = `完成，注入 ${payload.debug.injectedCards.length} 条世界书/记忆`;
    render();
  } catch (error) {
    els.agentStatus.textContent = error.message;
  }
}

async function saveProvider() {
  const provider = {
    id: value('#provider-id') || 'default',
    kind: 'openai-compatible',
    baseUrl: value('#provider-base-url'),
    apiKey: value('#provider-api-key'),
    model: value('#provider-model'),
    temperature: 0.9,
    maxTokens: 2000,
    headers: {}
  };
  await request('/api/providers', {
    method: 'PUT',
    body: { activeProviderId: provider.id, providers: [provider] }
  });
  els.providerStatus.textContent = 'Provider 已保存到本地。';
  await loadState();
}

async function saveWorldBook() {
  const worldBook = JSON.parse(els.worldbookEditor.value);
  await request('/api/world-book', { method: 'PUT', body: { worldBook } });
  await loadState();
}

async function savePromptModules() {
  const promptModules = JSON.parse(els.promptEditor.value);
  await request('/api/prompt-modules', { method: 'PUT', body: { promptModules } });
  await loadState();
}

function render() {
  els.sessionTitle.textContent = state.session.title;
  els.messages.innerHTML = state.session.messages.map((message) => `
    <article class="message ${escapeHtml(message.role)}">
      <span class="role">${message.role === 'user' ? '你' : 'Agent'}</span>
      ${escapeHtml(message.content)}
    </article>
  `).join('');
  els.messages.scrollTop = els.messages.scrollHeight;
  els.memoryView.textContent = JSON.stringify(state.session.memory, null, 2);
  els.worldbookEditor.value = JSON.stringify(state.config.worldBook, null, 2);
  els.promptEditor.value = JSON.stringify(state.config.promptModules, null, 2);
  const activeProvider = state.config.providers.providers.find((provider) => provider.id === state.config.providers.activeProviderId);
  els.agentStatus.textContent = activeProvider ? `当前模型：${activeProvider.model}` : '未配置 Provider';
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: options.body ? { 'content-type': 'application/json' } : {},
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

function value(selector) {
  return document.querySelector(selector).value.trim();
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
```

- [ ] **Step 4: 运行全量测试**

Run:

```bash
npm test
```

Expected: 所有测试 PASS。

- [ ] **Step 5: 启动本地服务**

Run:

```bash
npm run dev
```

Expected: 终端输出 `Local roleplay agent running at http://127.0.0.1:5177`。

- [ ] **Step 6: 手动验证**

Open: `http://127.0.0.1:5177`

Expected:

- 页面显示三栏布局。
- 右侧能看到记忆 JSON、世界书 JSON、Prompt JSON。
- 未配置 provider 时，顶部显示 `未配置 Provider`。
- 保存 provider 后刷新仍可读取配置，但 API key 在 `/api/state` 中被遮罩。

- [ ] **Step 7: 提交**

```bash
git add public
git commit -m "feat: add local roleplay workspace ui"
```

---

### Task 9: 端到端验证和收尾

**Files:**
- Modify: `README.md`
- Create: `outputs/local-roleplay-agent-runbook.md`

- [ ] **Step 1: 创建 README**

Create `README.md`:

```md
# 本地角色扮演 Agent

私有本地网页应用，用于长篇角色扮演和个人创作。

## 启动

```bash
npm test
npm run dev
```

访问：

```text
http://127.0.0.1:5177
```

## Provider 配置

第一版支持 OpenAI-compatible API：

```json
{
  "id": "default",
  "kind": "openai-compatible",
  "baseUrl": "https://api.example.com/v1",
  "apiKey": "your-local-key",
  "model": "model-name",
  "temperature": 0.9,
  "maxTokens": 2000,
  "headers": {}
}
```

Provider 配置保存在 `data/config/providers.local.json`，该文件不会进入 git。

## Agent 结构

```text
Agent = Prompt 组装器 + 记忆管理器 + API 客户端 + 对话循环 + 状态存储
```

每轮对话会读取 prompt 模块、世界书、最近对话、滚动摘要和结构化世界状态，再调用模型生成回复。

## Personal Creative Mode

本地应用不增加自己的限制词、敏感词规避或创作题材过滤。实际限制来自你选择的模型/API provider。
```

- [ ] **Step 2: 创建运行手册**

Create `outputs/local-roleplay-agent-runbook.md`:

```md
# 本地角色扮演 Agent 运行手册

## 启动

```bash
npm run dev
```

打开：

```text
http://127.0.0.1:5177
```

## 首次使用

1. 在左侧填写 OpenAI-compatible provider。
2. 点击保存 Provider。
3. 在中间输入第一条行动。
4. 在右侧查看记忆状态、世界书和 Prompt 模块。

## 记忆检查

- `rollingSummary`：旧对话摘要。
- `worldState`：结构化长期事实。
- `eventLedger`：每轮追加的事件记录。
- `memoryCards`：剧情过程中生成的记忆卡片。

## 常见错误

- `NO_ACTIVE_PROVIDER`：尚未保存 provider。
- `Provider returned non-JSON response`：base URL 或服务商响应格式不兼容。
- `Provider error 401`：API key 错误或失效。
```

- [ ] **Step 3: 运行全量测试**

Run:

```bash
npm test
```

Expected: 所有测试 PASS。

- [ ] **Step 4: 启动服务验证**

Run:

```bash
npm run dev
```

Expected: 访问 `http://127.0.0.1:5177` 能打开网页。

- [ ] **Step 5: 提交**

```bash
git add README.md outputs/local-roleplay-agent-runbook.md
git commit -m "docs: add local roleplay agent runbook"
```

---

## 自检清单

- 设计文档中的“本地网页 + 本地后端代理 API”由 Task 1、7、8 实现。
- “OpenAI-compatible provider 配置”由 Task 3、5、7、8 实现。
- “最近对话 + 滚动摘要 + 结构化状态 + 事件账本 + 世界书检索”由 Task 4、6 实现。
- “不复制原站限制词和敏感词模块”由默认 prompt 的 Personal Creative Mode 和 README 说明实现。
- “Prompt/world book 可编辑”由 Task 3、7、8 实现。
- “网页直接访问”由 Task 1、7、8 实现。
- “自动总结”由 Task 6 的 SummaryScheduler 实现。
- “审核材料中文化”已在设计文档和 outputs 架构文档中完成。

