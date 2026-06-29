# Fact Management 与武侠沉浸主舞台设计

日期：2026-06-29

## 背景

当前 `local-roleplay-agent` 已经具备本地角色扮演创作的核心闭环：Provider 配置、角色卡、世界书、Prompt 模块、动态记忆、自动总结、流式回复、Markdown 渲染、重生成、消息编辑和推荐行动。

下一阶段要解决两个问题：

1. 自动提取的事实已经能进入长期记忆，但用户只能在 JSON 检查器里查看，缺少可审阅、可修正、可删除的产品界面。
2. 当前 UI 已经从后台配置页调整为创作台，但视觉上仍偏通用 AI 聊天客户端，缺少面向武侠/玄幻角色扮演的沉浸式包装。

本设计选择路线 A：先做“事实卡片审阅台 + 武侠沉浸主舞台”。完整关系图谱和主题市场暂缓，但为后续演进预留数据字段和 UI 入口。

## 目标

- 让自动记忆可被创作者审阅、编辑、禁用、删除。
- 让动态记忆的来源和状态可追溯，降低错误事实污染长期创作的风险。
- 保持现有 RP 连续性：自动事实默认继续生效，不改成全部等待审核后才注入。
- 为后续“设定图谱”保留 `type`、`source`、`extensions` 等结构字段。
- 将聊天主区升级为武侠/古风沉浸主舞台，包含背景、遮罩、卷轴/羊皮纸质感和悬浮输入框。
- 保持本地网页直接访问，不引入前端框架，不增加构建链复杂度。

## 非目标

- 第一版不实现完整图数据库或可拖拽关系图谱。
- 第一版不做在线主题市场、素材商店或外部图片检索。
- 第一版不改变 Provider API 协议，也不新增模型服务商。
- 第一版不做多会话复杂管理；仍以 `main` 会话为主。
- 第一版不增加内容审查层。项目用于个人本地创作，应用侧不附加创作限制。

## 产品形态

### 事实审阅台

在右侧检查器新增“事实”标签页，位置建议放在“记忆”之前或之后。它展示从 `session.memory.memoryCards` 和动态世界书中整理出的事实卡片。

每张事实卡片展示：

- 标题：优先使用 `title`，没有则从内容截取。
- 内容：事实正文。
- 类型：人物、地点、物品、任务、关系、事件、旗标、未分类。
- 状态：启用、禁用。
- 来源：自动提取、手动、动态世界书。
- 更新时间。
- 关键词。

每张卡片支持操作：

- 编辑：修改标题、内容、关键词、类型和启用状态。
- 启用/禁用：禁用后不参与记忆检索和 Prompt 注入。
- 删除：从 memoryCards 中移除。
- 提升为世界书：复制为 `worldBook` 条目，保留关键词、内容、depth、source，并标记来源为 `fact-management`。

第一版不做批量操作，避免 UI 和 API 面积过大。

### 沉浸式主舞台

聊天区升级为 Main Stage：

- 背景：内置一张 CSS 渐变式武侠场景背景，不依赖网络资源；后续可加本地图片上传。
- 遮罩：主区叠加深色渐变遮罩，保证消息文字可读。
- 消息气泡：助手消息偏深色半透明，用户消息偏青绿色，保留 Markdown 强调样式。
- 输入框：从面板底部固定条改成悬浮浮岛，使用羊皮纸/卷轴色，按钮保持清晰可点击。
- 快捷操作：在悬浮输入框上方或旁边放置场景化按钮，例如“角色设定”“修复格式”“回到底部”。

主题第一版内置两个模式：

- `default-dark`：保留当前偏工具型暗色风格。
- `wuxia-scroll`：武侠卷轴主题，使用暖纸色、金色边线、青绿点缀和场景背景。

主题切换先做前端本地状态，不进入后端持久化；后续如果用户需要，可加入本地配置文件。

## 数据模型

### Fact Card

`memoryCards` 统一规范为可管理事实卡片。现有字符串或松散对象在读取时做兼容转换。

```json
{
  "id": "fact-...",
  "title": "沈观澜获得名刀",
  "content": "沈观澜在青崖镇获得一把名刀。",
  "type": "item",
  "keywords": ["沈观澜", "名刀", "青崖镇"],
  "enabled": true,
  "source": "auto-extracted",
  "createdAt": "2026-06-29T00:00:00.000Z",
  "updatedAt": "2026-06-29T00:00:00.000Z",
  "extensions": {
    "confidence": "medium",
    "originTurnId": "assistant-..."
  }
}
```

字段说明：

- `id`：稳定标识。没有 id 的旧卡片在规范化时补齐。
- `title`：卡片标题。
- `content`：注入 Prompt 的事实正文。
- `type`：为未来图谱分组预留。
- `keywords`：用于检索匹配。
- `enabled`：是否参与检索和注入。
- `source`：来源，常见值为 `auto-extracted`、`manual`、`dynamic-memory`、`fact-management`。
- `extensions`：保留扩展字段，不由 UI 强制解释。

### World State

`worldState` 第一版仍保持自动合并，不把它拆成可逐字段审核。原因是它承担“当前状态快照”的职责，直接冻结审核会让 RP 连续性变差。

事实审阅台第一版主要管理 `memoryCards` 和由事实提升出的世界书条目。后续如果需要，可以再做 World State 字段级审计。

## 后端 API

新增 API 只操作当前 `main` 会话，延续现有 API 风格。

### 更新事实卡片

```text
PUT /api/memory/facts
```

请求：

```json
{
  "sessionId": "main",
  "facts": []
}
```

行为：

- 校验 `facts` 为数组。
- 对每个卡片执行规范化。
- 保存回 `session.memory.memoryCards`。
- 返回更新后的 `session` 或 `facts`。

### 提升为世界书

```text
POST /api/memory/facts/:factId/promote
```

请求：

```json
{
  "sessionId": "main"
}
```

行为：

- 从 `memoryCards` 找到 fact。
- 创建一个世界书条目。
- 默认 `depth` 为 6、`priority` 为 80、`source` 为 `fact-management`、`enabled` 为 true。
- 避免重复：使用标题和内容作为去重键。
- 返回更新后的 `worldBook`。

## Prompt 注入规则

`retrieveCards` 和 `assemblePrompt` 只应使用 `enabled !== false` 且 `content` 非空的 memory cards。

禁用事实后：

- 不参与关键词检索。
- 不出现在本轮注入卡片中。
- 不删除原对话，也不回滚 `worldState`。

这种策略简单、可预测，适合第一版。

## 前端改动

### HTML

- 在检查器 tabs 中新增 `事实`。
- 增加事实卡片列表容器。
- 增加主题切换按钮或下拉，初版可放在顶部状态栏或检查器中。
- 聊天输入区保留同一个表单 id，避免影响现有发送逻辑，只改视觉布局。

### JavaScript

- 新增 `renderFacts()`：从 `state.session.memory.memoryCards` 生成卡片 UI。
- 新增 `saveFacts()`：把当前编辑后的 facts 发送到 `PUT /api/memory/facts`。
- 新增 `promoteFact()`：调用提升世界书 API。
- 现有 `renderInspector()` 中加入事实页刷新。
- 主题切换只改 `document.documentElement.dataset.theme`，并写入 `localStorage`。

### CSS

- 使用 `data-theme="wuxia-scroll"` 覆盖 CSS 变量。
- `.chat-panel` 增加舞台背景和遮罩。
- `.chat-form` 改成浮岛式输入，但保持响应式移动端可用。
- `.fact-list`、`.fact-card`、`.fact-card-actions` 使用紧凑卡片布局。

## 错误处理

- API 接收到非数组 facts 返回 `INVALID_MEMORY_FACTS`。
- 提升不存在的 fact 返回 `MEMORY_FACT_NOT_FOUND`。
- JSON 保存失败沿用现有统一错误处理。
- 前端编辑失败时在事实页状态栏展示错误，不清空用户正在编辑的内容。

## 测试计划

后端：

- `PUT /api/memory/facts` 能保存规范化 fact cards。
- 非数组 facts 返回 400。
- 禁用 fact 后 `retrieveCards` 不返回该卡片。
- `POST /api/memory/facts/:factId/promote` 能创建世界书条目。
- 重复提升不会重复追加世界书。

前端：

- `node --check public/app.js`。
- `node --check public/markdown.js`。

集成：

- `npm test` 全部通过。
- `git diff --check` 无空白问题。
- 本地 `http://127.0.0.1:5177/` 返回 200。

## 后续演进

- 第二阶段可以把事实卡片升级为设定图谱：人物、地点、物品、事件成为节点，关系和持有关系成为边。
- 可以给事实加入置信度、来源轮次、最后使用时间、冲突检测。
- 可以把主题配置持久化，允许用户上传本地背景图。
- 可以增加“本轮注入预览”，显示哪些事实实际进入 prompt。

## 自检结论

- 本设计聚焦单一增量：事实审阅闭环与主舞台主题化，不拆散现有架构。
- 新 API 面积小，复用现有 SessionService、ConfigService 和 JSON 存储。
- 默认自动事实继续生效，符合长篇 RP 连续性需求。
- 完整图谱和主题市场明确暂缓，避免第一版范围膨胀。
