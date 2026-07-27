# 本地角色扮演 Agent

私有本地网页应用，用于长篇角色扮演和个人创作。它把 prompt 模块、世界书、分层记忆、OpenAI-compatible API 调用和会话存档放在同一个本地工作台里。

## 快速开始（3 步）

1. 启动本地服务：执行 `npm start`，浏览器打开 `http://127.0.0.1:5178`。
2. 配置 Provider：在空会话封面点击“去配置”，选择厂家、填写 API Key 和模型，并先执行“测试连接”。
3. 选择剧本并入局：打开“剧本书架”，选择基础剧本或自定义剧本，完成主角与天命设置后进入第一幕。

首次运行建议先执行一次 `npm test`。所有会话、素材和配置均保存在本机。

## 叙事资产中心

顶部“素材中心”统一管理角色卡、世界书、Prompt 预设与内容包，并提供卡片/列表视图、类型与来源筛选、评定结果、Token 规模和内容结构预览。馆藏资料可补充标题、摘要、标签、集合与收藏状态；这些整理信息不会改写导入素材的原始 payload，也不会影响已经生成的故事存档。

- `用于新剧本`：把角色卡、随卡世界书、独立世界书或 Prompt 带入自定义剧本流程。
- `高级拼装`：按“世界基线 → 角色卡 → 世界书 → 预设 → 校验确认”五步组装，并在创建前检查冲突、扩展依赖和上下文体量。
- `导入素材`：沿用现有导入预览与技术评定，不会跳过兼容性检查。

## 启动

```bash
npm test
npm start
```

停止或重启后台服务：

```bash
npm stop
npm restart
```

访问：

```text
http://127.0.0.1:5178
```

默认只监听 `127.0.0.1`，用于本机访问。

`npm run start:local`、`npm run stop:local` 与 `npm run restart:local` 作为兼容别名继续可用。也可以直接双击项目根目录的 `start-local.command` 启动，双击 `stop-local.command` 停止。英文文件名便于终端、IDE 和跨语言环境统一调用；运行日志与 PID 保存在 `.runtime/`。

## 当前测试基线

`v0.5.0` 是当前冻结的酒馆资源兼容稳定自用版。近期测试应以该版本为基线记录 Provider、剧本、会话与复现步骤；个人导入素材、故事工程和角色图片仍只保存在本机，不进入 git。

### GitHub 内容边界

这个仓库发布的是本地角色扮演引擎、格式规范、测试和最小演示内容，不是社区角色卡或世界书镜像：

- 第三方角色卡、世界书、Prompt、立绘、派生剧本和实际故事存档只保存在本机。
- `data/config/`、`data/library/`、`data/assets/`、`data/projects/` 等运行时目录均被 Git 忽略。
- `data/content-packs/` 只允许放入作者明确授权公开或项目自行创作的内置演示包；来源不清的内容应放入 `data/content-packs-local/`。
- 提交或推送前运行 `npm run repository:check`；发布检查 `npm run release:check` 也会自动执行相同校验。

详细规则见 [`docs/repository-content-policy.md`](docs/repository-content-policy.md)。

冻结范围与重点回归清单见 `docs/release-v0.5.0.md`。

## v0.5 酒馆资源兼容

- 社区卡中的安全显示正则可随自定义剧本进入会话，只修改渲染副本，不污染原始消息、记忆和事件账本。
- 纯文本 Quick Reply 与 `/send`、`/say` 会映射到原生输入栏；白名单 `/setvar`、`/incvar` 会转换为 MVU 补丁，其他脚本命令链继续禁用。
- MVU 初始状态可随内容包保存；模型可通过隐藏的 `lra.mvu-patch/v1` 协议提交带 revision 的声明式补丁，服务端验证后更新状态。
- 世界书 `selectiveLogic` 四种二级关键词逻辑会映射到内部检索语义；显示正则替换支持 `{{char}}` 与 `{{user}}`。
- 声明式 `onImport`、`onUser`、`onAssistant` 可以在统一预算内更新状态；路径、操作、递归与变更数量受限，任一步失败会整体回滚。
- EJS 轻前端支持只读变量插值、条件分支和简单比较；赋值、循环及任意函数调用会被剥离。
- 状态字段、条目列表和 Markdown 说明可转换为原生沉浸侧栏，并随会话 MVU 实时渲染。
- 酒馆助手和小白 X 命名空间中的变量、显示正则、文本按钮、声明式面板与受限生命周期可安全映射；原始脚本生命周期仍标为缺失。
- SillyTavern Prompt 预设可导入素材库，保留 `prompt_order`、消息角色、相对位置及 `in_chat` 的 Depth/Order；内置占位符由本项目的角色卡、世界书和聊天历史装配器承接。
- 预设中的温度、上下文和输出长度等生成参数作为建议展示，不会静默覆盖当前 Provider；正则与酒馆助手脚本会单独诊断，任意 JavaScript 不会执行。
- Edit、重生成和 Swipe 切换会从轻前端基线重放当前分支补丁，避免旧分支状态污染。
- 导入兼容报告固定输出“完整映射 / 安全降级 / 阻断运行”，并列出差异或阻断原因，避免把“能导入”误写成“完全兼容”。

当前安全边界与数据结构见 `docs/light-frontend-runtime-v1.md`，正式兼容原则见 `docs/tavern-compatibility-policy-v1.md`。

## v0.4 世界模拟

- 新增 `lra.action/v1` 声明式动作协议；模型正文与状态变化分离，动作必须通过服务端裁定才会生效。
- 事件账本记录剧情回合、精确状态效果、手工动作、NPC 档案修改和世界时钟推进。
- 重生成、Swipe 切换与历史编辑会从基线重放当前分支动作，避免旧分支污染世界状态。
- NPC 具备位置、状态、目标、关系、公开/私有知识、日程与幕后议程。
- 检查器的“状态”页可切换幕后/公开视图、推进世界时钟、审阅 NPC 行动与事件账本。
- 玄幻、灵异、明末和仙侠内置剧本已加入可运行 NPC 阵容；内容包也可通过角色扩展字段携带自己的模拟设定。

完整说明见 `docs/release-v0.4.md`，动作契约见 `docs/action-protocol-v1.md`。

## 创作账本与 Agent Profile

项目吸收通用 Agent 客户端和长篇小说创作工具的优点，但保持“剧本内容包驱动的可游玩世界”主线：

- **Agent Profile**：内置“叙事导演、群像角色、连续性守门人”三种职责，同一套角色与世界资产可按当前创作任务切换运行策略。
- **当前场景章纲**：记录本场目标、叙事视角、地点时间、必须呈现 / 必须隐藏的信息和禁止偏离方向。
- **叙事承诺**：独立追踪伏笔、人物约定和必须回应的线索，不与已经发生的事件账本混为一谈。
- **创作决策**：保存作者已经确认的方向，防止模型在后续对话中静默推翻。
- 账本保存在会话内，并在每次对话生成前注入系统上下文；它约束叙事，但不会改写原始角色卡和世界书。

## v0.2.2 插件适配与内容包版本

- 自定义剧本可导出、导入为 `lra.content-pack/v1` 内容包，清单包含语义版本、引擎范围和依赖。
- `lra.plugin/v1` 插件使用受控声明式运行时：可声明资源适配器，以及安全宏、正则触发、推荐行动、世界状态、侧栏面板、动作协议和 Prompt 顺序等能力；不执行第三方 JavaScript、Shell、命令或 Hook。
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
