# 本地角色扮演 Agent 设计

日期：2026-06-29

## 目标

构建一个私有、本地运行的网页应用，用于长篇角色扮演和个人创作。参考对象是 Afengy 上的公开作品：

`https://afengy.app/zh/explore/installed/e57ba24d-e5ad-46a5-9477-7a6b8be1477b`

本地应用要继承原站有价值的工作流：角色/世界设定、快捷指令、世界书、短期上下文、自动记忆，以及模型切换能力。同时要改进记忆机制，让长篇创作保持连贯，但不要每轮都塞入过多历史内容导致 token 消耗失控。

这是个人本地创作工具，不是公开平台。应用本身不增加内容审查层、不复制原站的限制词列表，也不做敏感词规避。实际限制只来自你接入的外部模型/API 服务商。

## 可以从原站继承什么

Afengy 的公开 API 暴露了应用身份、模型元数据、视觉资源、快捷指令、背景图、CSS 和长度信息。但没有暴露隐藏的完整 prompt 和隐藏的世界书内容。

已观察到的公开配置：

- 应用名：`神荒武界❤️武侠大世界（高武/开局roll/中消耗/玄幻/武侠/大世界）`
- 年龄分级：`18`
- 默认最近消息数：`6`
- 隐藏 prompt 长度：约 `46k`
- 隐藏世界书长度：约 `38k`
- 公开 `world_book` 值：空
- 公开 `pre_prompt` 值：空
- 快捷指令包括：角色锚定、修复格式、存档、读档、文风切换、好评、差评。

平台本身明显接近“角色卡 + Lorebook/世界书”的生态范式：

- 前端包里出现了 Character Card 导入文案。
- 前端包里出现了 Lorebook/世界书导入模板。
- Memory Palace 会把 AI 总结的记忆存成类似 Lorebook 的条目。
- Automatic Summary 会把旧对话压缩成摘要并放入系统提示词。

因此，我们可以复刻它的工作流模式，但不能精确复制它隐藏的原始 prompt。

## 这个项目里的 Agent 是什么

在这个应用里，agent 不是“一个会聊天的模型”。它更像一个按轮次运行的对话编排器，包含明确的组件和流程：

1. 接收用户的新消息。
2. 读取当前会话、世界状态、摘要和相关世界书。
3. 在 token 预算内组装 prompt。
4. 调用配置好的模型/API。
5. 保存模型回复和原始对话。
6. 从新一轮对话里抽取记忆更新。
7. 定期总结或压缩旧上下文。
8. 把记忆和状态变化展示出来，方便用户检查和编辑。

一句话：

```text
Agent = Prompt 组装器 + 记忆管理器 + API 客户端 + 对话循环 + 状态存储
```

LLM 负责生成下一段回复。Agent Runtime 负责决定 LLM 每轮能看到什么，以及模型回复如何更新长期世界状态。

## 总体架构

```text
浏览器网页应用
  |
  | HTTP
  v
本地 Node 服务
  |
  +-- 静态网页服务
  +-- 模型 Provider 代理
  +-- 会话 API
  +-- 记忆 API
  +-- Prompt/世界书 API
  |
  v
Agent Runtime
  |
  +-- Prompt 组装器
  +-- 记忆检索器
  +-- Token 预算控制器
  +-- 模型 Provider 客户端
  +-- 记忆更新抽取器
  +-- 自动总结调度器
  |
  v
本地 JSON 存储
```

## 浏览器网页应用

浏览器是你的创作工作台。

主要区域：

- 对话区：角色扮演正文、流式回复、重试、编辑，后续可支持分支。
- 左侧栏：会话列表、当前角色/世界预设、存档/读档快照。
- 右侧检查器：API 配置、记忆状态、世界书、prompt 模块、事件账本。
- 顶部状态栏：当前 provider、模型、记忆模式、prompt token 估算、注入的世界书数量。

UI 要展示足够多的 agent 内部信息，方便你学习和调试：

- 本轮注入了哪些记忆卡片。
- 本轮使用了哪段摘要。
- `worldState` 哪些字段发生了变化。
- 自动总结什么时候运行。
- 当前 prompt 大致消耗多少 token。

## 本地服务

本地服务的主要作用是避免 API key 直接暴露在浏览器里。

职责：

- 在 `http://localhost:<port>` 提供网页访问。
- 把 provider 配置保存在本地配置文件中。
- 代理对外模型调用。
- 把不同模型服务商的差异收敛到统一接口。
- 读写会话、记忆、prompt 模块、世界书和快照。

第一版优先支持 OpenAI-compatible 接口：

```json
{
  "id": "default",
  "kind": "openai-compatible",
  "baseUrl": "https://api.example.com/v1",
  "apiKey": "local-only-secret",
  "model": "model-name",
  "temperature": 0.9,
  "maxTokens": 2000,
  "headers": {}
}
```

后续可以增加 Gemini 和 Anthropic 适配器，但不应该影响 agent runtime 的核心结构。

## Agent Runtime

Runtime 是这个项目最值得学习的核心。

模块划分：

- `ConversationStore`：保存会话、消息、分支和快照。
- `PromptModuleStore`：保存可编辑 prompt 模块，例如核心规则、世界设定、文风、输出格式、记忆规则。
- `WorldBookStore`：保存关键词触发的世界书条目。
- `MemoryStore`：保存最近对话、滚动摘要、结构化世界状态、记忆卡片和事件账本。
- `MemoryRetriever`：为当前轮次选择相关世界书和记忆卡片。
- `PromptAssembler`：按固定顺序和 token 预算构建最终模型输入。
- `ProviderClient`：通过不同适配器调用外部模型 API。
- `MemoryUpdater`：从最新对话里抽取结构化状态变化。
- `SummaryScheduler`：判断什么时候总结或压缩旧上下文。

## 单轮对话流程

每条用户消息都会走这个流程：

```text
1. 用户发送消息
2. 服务端保存用户消息
3. Runtime 加载当前会话配置
4. Runtime 检索相关记忆和世界书
5. PromptAssembler 构建最终模型输入
6. ProviderClient 调用选定模型
7. 服务端流式返回或一次性返回助手回复
8. ConversationStore 保存助手回复
9. MemoryUpdater 抽取事件和状态更新
10. SummaryScheduler 判断是否需要总结旧对话
11. UI 展示回复和记忆变化
```

这是最小但有用的 agent loop。它围绕 LLM 调用做编排，且每个阶段都有输入输出，方便调试。

## 记忆架构

本地记忆系统应该分层，而不是把所有历史塞进一个巨大 prompt。

### 1. 最近对话

最近 6-10 轮保留原文。这样可以保留语气、即时目标和短期连续性。

默认配置：

- 保留最近 `8` 组用户/助手对话。
- 每个会话可以单独配置。

### 2. 滚动摘要

更旧的对话压缩成简洁的叙事摘要。

默认触发条件：

- 至少出现 `4` 轮未总结的旧对话时触发。
- 或者 prompt token 估算超过预算时触发。

摘要应该像章节提纲：

- 当前局面
- 重要决定
- 未完成线索
- 角色关系变化
- 未解决风险或承诺
- 绝不能自相矛盾的事实

### 3. 结构化世界状态

把长期事实存成 JSON，而不是只存在散文摘要里。

建议结构：

```json
{
  "protagonist": {
    "name": "",
    "realm": "",
    "traits": [],
    "injuries": [],
    "inventory": []
  },
  "location": {
    "current": "",
    "knownPlaces": []
  },
  "relationships": [],
  "quests": [],
  "factions": [],
  "flags": {},
  "timeline": []
}
```

这能减少重复 prose，并让连续性更容易检查。

### 4. 事件账本

保存一份只追加、不覆盖的重要事件列表。

每条事件包含：

- turn id
- 时间戳
- 行动者
- 事件摘要
- 影响结果
- 来源消息 id
- 置信度

事件账本通常不直接注入 prompt。它的作用是审计、回溯和重新生成摘要。

### 5. 记忆卡片和世界书

记忆卡片是游玩过程中生成的剧情事实。世界书是相对稳定的设定知识。

建议二者共用类似 schema：

```json
{
  "id": "",
  "type": "faction|location|npc|realm|rule|plot|style|memory",
  "title": "",
  "keywords": [],
  "content": "",
  "priority": 50,
  "depth": 4,
  "scope": "prompt",
  "enabled": true,
  "source": "manual|imported|generated",
  "updatedAt": ""
}
```

第一版使用关键词命中检索，后续再考虑 embedding/向量检索。

## Token 预算策略

长记忆只有在“选择性注入”时才真正有价值。

默认 prompt 预算拆分：

- 核心角色扮演规则：15-20%
- 当前用户消息和最近对话：35-45%
- 结构化世界状态：10-15%
- 滚动摘要：10-15%
- 检索到的世界书/记忆卡片：10-20%

规则：

- 核心规则和当前用户消息必须始终包含。
- 最近对话按预算尽量包含。
- 长散文摘要之前，优先包含精简的结构化世界状态。
- 世界书卡片按关键词命中、优先级、最近性和 depth 排序。
- 每轮注入的世界书卡片数量要有上限。
- 如果滚动摘要太长，就再次压缩成更短摘要，并归档旧版本。

## Prompt 和世界书设计

不要做一个巨大的隐藏 prompt。应该拆成可编辑模块：

- `core-rules`：角色扮演契约，保持角色，不主动跳出世界观。
- `world-premise`：世界观总设定和整体基调。
- `cultivation-system`：境界、战力尺度、修行代价、战斗影响。
- `factions`：宗门、朝廷、帮派、隐藏势力。
- `locations`：地域、城池、禁地。
- `npc-rules`：常驻 NPC 的一致性和关系规则。
- `combat-rules`：危险、受伤、资源消耗、后果。
- `memory-rules`：如何更新世界状态和记忆。
- `output-format`：可见回复格式和可选 UI 面板。
- `style-guide`：叙事节奏和类型风格。

这种方式比编辑一个超大文本更适合长期调参。

## Personal Creative Mode

默认开启。

行为：

- 不设置应用层限制词。
- 不做应用层敏感词规避。
- 不做本地创作题材过滤。
- 不强制拒绝或修正文风。
- Prompt 只关注创作质量、连续性、角色一致性和世界模拟。

外部模型服务商自己的策略仍可能生效，取决于你选择的 provider。

## 存档、读档和分支

第一版支持：

- 将会话快照导出为 JSON。
- 从 JSON 导入快照。
- 保存/加载当前世界状态。
- 保留原始事件账本，方便重新生成摘要。

分支功能可以后续再做。记忆模型从第一版开始要保留 `session id` 和 `parent snapshot id`，这样将来容易扩展。

## 错误处理

应用需要处理：

- 缺少 provider 配置
- API key 无效
- provider 超时
- 记忆抽取阶段返回非 JSON
- 自动总结失败
- 记忆 patch 无效
- prompt 超过预算

记忆更新失败时，对话回复仍然应该保存。记忆变化可以重试，也可以手动编辑。

## 测试策略

核心测试：

- Prompt 组装器遵守 section 顺序和 token 预算。
- 记忆检索器能排序并限制世界书卡片数量。
- 自动总结调度器能按轮次和 token 估算触发。
- 结构化状态 patch 必须校验后才能应用。
- ProviderClient 能正确构建 OpenAI-compatible 请求。
- 存档/读档能完整保留会话、记忆和配置。

手动浏览器验证：

- 启动本地应用。
- 配置 provider。
- 发送一条聊天消息。
- 检查本轮注入的 prompt section。
- 确认记忆/状态更新出现在检查器里。
- 确认对话足够多后自动总结会触发。

## MVP 范围

第一版包含：

- 本地网页 UI
- 本地 Node 服务
- OpenAI-compatible provider 适配器
- 可编辑 prompt 模块
- 可编辑世界书
- 会话存档/读档
- 最近对话
- 滚动摘要
- 结构化世界状态
- 事件账本
- 手动记忆编辑
- Prompt 预览和 token 估算

后续再做：

- Gemini/Anthropic 一等适配器
- 基于 embedding 的检索
- 对话分支
- 更好的 SillyTavern 角色卡/Lorebook 导入
- 可视化世界状态时间线
- 连续性漂移评测脚本

