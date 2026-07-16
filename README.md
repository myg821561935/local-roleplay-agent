# 本地角色扮演 Agent

私有本地网页应用，用于长篇角色扮演和个人创作。它把 prompt 模块、世界书、分层记忆、OpenAI-compatible API 调用和会话存档放在同一个本地工作台里。

## 启动

```bash
npm test
npm run start:local
```

访问：

```text
http://127.0.0.1:5178
```

默认只监听 `127.0.0.1`，用于本机访问。

也可以直接双击项目根目录的 `启动本地角色扮演.command`。运行日志与 PID 保存在 `.runtime/`。

## v0.4 世界模拟

- 新增 `lra.action/v1` 声明式动作协议；模型正文与状态变化分离，动作必须通过服务端裁定才会生效。
- 事件账本记录剧情回合、精确状态效果、手工动作、NPC 档案修改和世界时钟推进。
- 重生成、Swipe 切换与历史编辑会从基线重放当前分支动作，避免旧分支污染世界状态。
- NPC 具备位置、状态、目标、关系、公开/私有知识、日程与幕后议程。
- 检查器的“状态”页可切换幕后/公开视图、推进世界时钟、审阅 NPC 行动与事件账本。
- 玄幻、灵异、明末和仙侠内置剧本已加入可运行 NPC 阵容；内容包也可通过角色扩展字段携带自己的模拟设定。

完整说明见 `docs/release-v0.4.md`，动作契约见 `docs/action-protocol-v1.md`。

## v0.2.2 插件适配与内容包版本

- 自定义剧本可导出、导入为 `lra.content-pack/v1` 内容包，清单包含语义版本、引擎范围和依赖。
- `lra.plugin/v1` 插件仅声明资源格式适配规则，不执行第三方 JavaScript、Shell、命令或 Hook。
- 资源库新增“扩展适配”视图，可查看内置/本地插件、启停本地插件，并核对实际可用的格式适配器。
- 导入评定会在安装前显示内容包或插件的版本、依赖状态、内容规模和兼容结论。
- 旧自定义剧本继续可用，读取时会自动补出兼容清单；数据 schema 版本不变。

完整说明见 `docs/release-v0.2.2.md`，格式契约见 `docs/content-pack-spec-v1.md` 与 `docs/plugin-manifest-spec-v1.md`。

## v0.2.1 导入评定与主流程

- 资源工作台按“获取、评定、入库、组装”组织创作路径，在线素材和本地文件共用同一套准入流程。
- 导入前生成五维技术评定：结构完整、运行可用、一致性、上下文效率和来源信息。
- 评定报告显示预计 token、独立资源明细、阻断项、建议项、重复与执行隔离提示。
- 默认只存入素材库，不改变当前角色卡或世界书；需要时可显式选择“同时载入当前创作配置”。
- 完全重复的资源不会再次保存，关键结构为空的资源会在确认前阻断。

完整说明见 `docs/release-v0.2.1.md`。

## v0.2 资源库与剧本工坊

- 角色卡、世界书和 Prompt 导入后先进入本地资源库，不会直接覆盖当前会话。
- 导入体检会显示格式适配器、完整度、重复项、同名冲突和仅与可执行配置有关的风险提示。
- 资源保留来源、作者、链接、许可证、标签与内容指纹，便于回溯类脑社区等外部素材。
- 剧本工坊可选择一个内置剧本作为规则与视觉基底，再组合角色、世界书和 Prompt，生成独立自定义剧本。
- 自定义剧本沿用基底的主题和背景，但会话中的世界书、角色卡和规则身份保持独立。
- 当前内置 Character Card V2、SillyTavern Lorebook、文本/YAML 和社区通用 JSON 适配器；后续可按真实样本继续增加专用适配器。

资源库数据保存在：

```text
data/library/resources/
data/library/packs/
```

完整说明见 `docs/release-v0.2.md`。

## v0.1 发布加固

- `npm run release:check`：执行完整测试并核对 Node、应用版本、数据版本和启动文件。
- 启动时自动把本地数据迁移到当前 schema，健康接口会返回应用版本和数据版本。
- 接口配置抽屉提供 Provider 测试连接，不保存即可验证 URL、Key 与模型。
- “本地备份与恢复”生成带 SHA-256 校验的完整数据快照，恢复前自动创建安全备份。
- 命令行可使用 `npm run backup`、`npm run backup:list` 和 `npm run restore -- <backup-id> --yes`。

基础发布与恢复说明见 `docs/release-v0.1.md`。

## Provider 配置

第一版支持 OpenAI-compatible API。配置文件实际保存为：

```json
{
  "activeProviderId": "default",
  "providers": [
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
  ]
}
```

Provider 配置保存在 `data/config/providers.local.json`，该文件不会进入 git。网页上的 `/api/state` 只返回遮罩后的 API key。

## Agent 结构

```text
Agent = Prompt 组装器 + 记忆管理器 + API 客户端 + 对话循环 + 状态存储
```

每轮对话会读取角色卡、prompt 模块、世界书、最近对话、滚动摘要和结构化世界状态，再调用模型生成回复。生成后会保存消息、追加事件账本，并在满足条件时尝试更新滚动摘要、结构化事实和动态世界书条目。模型按提示输出推荐下一步选项时，网页会把它们显示成可点击按钮。

## 记忆层

- `recent messages`：最近对话，保证短期上下文连续。
- `rollingSummary`：旧对话的滚动摘要，用来压缩 token 消耗。
- `worldState`：主角、地点、关系、任务、势力、时间线等结构化事实。
- `eventLedger`：每轮发生了什么的追加记录。
- `memoryCards` / `worldBook`：可检索注入的长期设定和剧情记忆；世界书支持关键词、正则、二级关键词、常驻条目和 Depth 分组注入。

## 角色卡、Prompt 和世界书

角色卡、Prompt 模块与世界书都可以在网页右侧检查器里直接编辑。世界书页可以点击“新增条目”生成模板，角色卡页可以点击“角色模板”补齐字段，也可以直接导入 Character Card V2 的 `.json` 或带 `Chara/chara` 元数据的 `.png` 角色卡。保存后会写入本地 JSON：

```text
data/config/character-card.json
data/config/prompt-modules.json
data/config/world-book.json
```

## 创作者控制

- `编辑`：每条消息都可以编辑。编辑用户消息会截断后续分支并从该点重生成；编辑 Agent 消息会保留当前分支到该消息。
- `重生成`：Agent 消息可以重生成，结果会作为新的 Swipe 保存，当前显示最新版本。
- `Character Card V2`：导入后会映射 `data.name`、`first_mes`、`mes_example`、`system_prompt`、`post_history_instructions`、`alternate_greetings` 等字段；卡内 `character_book` 会追加到本地世界书。
- `动态记忆触发器`：达到总结阈值时，后台会先尝试提取新事实合并进 `worldState`，并把稳定长期事实追加成 `source: "dynamic-memory"` 的世界书条目，再更新滚动摘要。
- `Markdown 消息`：消息正文支持安全的 `**加粗**` 和 `*斜体*`，原始 HTML 会被转义。
- `SSE 流式输出`：发送消息走 `/api/chat/stream`。OpenAI-compatible provider 支持 SSE 时会按 `delta.content` 真实流式输出；不支持时会退回到完整响应后的分块打字机效果。

## Personal Creative Mode

本地应用不增加自己的限制词、敏感词规避或创作题材过滤。实际限制来自你选择的模型/API provider。
