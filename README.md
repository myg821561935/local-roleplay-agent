# 本地角色扮演 Agent

私有本地网页应用，用于长篇角色扮演和个人创作。它把 prompt 模块、世界书、分层记忆、OpenAI-compatible API 调用和会话存档放在同一个本地工作台里。

## 启动

```bash
npm test
npm run dev
```

访问：

```text
http://127.0.0.1:5177
```

默认只监听 `127.0.0.1`，用于本机访问。

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
