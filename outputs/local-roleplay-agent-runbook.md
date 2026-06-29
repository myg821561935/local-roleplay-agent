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
2. 点击保存接口。
3. 在中间输入第一条行动、对白或旁白指令。
4. 在右侧查看记忆状态、世界书、角色卡和 Prompt 模块。

## 外部 API 配置

最少需要填写：

```text
Provider ID
Base URL
API Key
Model
```

`Base URL` 需要是 OpenAI-compatible 根地址，例如：

```text
https://api.example.com/v1
```

如果服务商需要额外 header，可以在 `Headers JSON` 中填写普通 JSON 对象。

## 记忆检查

- `rollingSummary`：旧对话摘要，用于控制长对话 token 消耗。
- `worldState`：结构化长期事实，包括主角、地点、关系、任务、势力和时间线。
- `eventLedger`：每轮追加的事件记录，便于复盘剧情推进。
- `memoryCards`：预留的可检索记忆卡片层；当前版本会读取和检索它。
- `worldBook`：人工维护或角色卡导入的设定条目，支持关键词、正则、常驻条目、二级关键词和 Depth 分组注入。

## 增加世界书和角色卡

- 世界书：打开右侧“世界书”，点击“新增条目”，把 `title`、`keywords`、`content` 改成你的设定后保存。需要正则时设置 `matchMode: "regex"` 并填写 `regex`；需要主关键词和副关键词同时命中时设置 `logic: "selective"` 和 `secondaryKeywords`；需要常驻注入时设置 `constant: true`；`depth` 用于控制注入分组。
- 角色卡：打开右侧“角色卡”，点击“角色模板”，填写主角姓名、身份、描述、性格和当前情境后保存。也可以选择 `.json` 或 `.png` 社区角色卡导入；支持 Character Card V2，卡内 `character_book` 会追加进世界书。
- 推荐选项：Agent 回复下方会出现“推荐下一步”。点击任意选项会直接作为下一轮输入发送；不合适就忽略，自己在输入框写。

## Swipes 和消息编辑

- 编辑用户消息：点击该消息下方“编辑”，保存后会删除它之后的旧分支，并按新文本重新生成回复。
- 编辑 Agent 消息：点击“编辑”，会直接改当前回复，并截断后续旧分支。
- 重生成：点击 Agent 消息下方“重生成”，会保留原回复作为 Swipe，并把新回复设为当前版本。

## 自动总结

当前实现会在未总结轮次较多，或 prompt 估算接近上限时触发后台记忆维护。它会先尝试提取新事实并合并到 `worldState`，再更新滚动摘要。摘要成功后会清空未总结计数；如果事实提取或摘要调用失败，会记录错误并在后续轮次继续尝试。

## 常见错误

- `NO_ACTIVE_PROVIDER`：尚未保存 provider。
- `PROVIDER_ERROR`：provider 调用失败，检查 base URL、model、API key 或服务商响应。
- `Headers JSON 解析失败`：左侧 headers 不是合法 JSON。
- `Headers JSON 必须是普通对象`：左侧 headers 不能是数组、字符串或 `null`。

底层 provider 客户端会识别非 JSON 响应、401 等详细错误；当前 HTTP API 为了不把服务商响应直接暴露到网页，会统一显示为 `PROVIDER_ERROR`。

## 本地文件

```text
data/config/providers.local.json    本地 provider，git 忽略
data/config/character-card.json     角色卡
data/config/prompt-modules.json     Prompt 模块
data/config/world-book.json         世界书
data/sessions/main.json             默认会话
```

## 创作边界

这个项目面向个人本地创作。应用层不做题材过滤、不添加限制词，也不复制原站的隐藏限制模块。模型或 API 服务商自身的规则仍可能影响输出。
