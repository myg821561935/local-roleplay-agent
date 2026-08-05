# 分层记忆系统 v1

分层记忆系统负责让长篇对话可持续、可回退、可审计。它不建立第二套剧情事实源，而是统一编排最近对话、滚动摘要、事实卡、事件账本、世界状态、向量召回和剧情知识图谱。

## 事实优先级

发生冲突时按以下顺序处理：

1. 当前启用的角色卡与世界书；
2. 用户明确确认的设定，以及正文中已经发生且有消息证据的事件；
3. 世界状态、事件账本和剧情知识图谱；
4. 带证据消息 ID 的情节记忆与滚动摘要；
5. 向量召回结果与模型推测。

向量数据库只负责找候选内容，不负责判定事实。低权威记忆不得覆盖角色卡、世界书或用户已经确认的事实。

## 领域契约

Session 中的 `memory.episodicMemory` 使用 `nre.memory/v1`：

```text
episodes        带来源消息、分支、修订号和有效期的情节记忆
summaries       scene / chapter / arc 三层摘要槽位
decisions       可审计决策摘要
retrievalAudit  每次召回使用的情节、向量消息和图谱版本
```

情节记忆以 assistant 消息 ID 形成稳定 ID。重复处理同一轮不会产生副本；编辑或切换 Swipe 会增加修订号；删除、隐藏或放弃分支时，旧记忆标记为 `superseded`，不再参与召回，但保留本地审计痕迹。

每条场景摘要同时记录 `episodeId@revision` 证据引用。章节摘要引用场景摘要及其修订号，故事弧摘要再引用章节摘要及其修订号。因此即使消息 ID 没有变化，只要编辑正文或切换 Swipe 导致情节修订，依赖旧版本的 Scene、Chapter 和 Arc 也会自动失效。

默认晋升节奏：

```text
每次摘要维护 -> 1 条 Scene
4 条有效 Scene -> 1 条 Chapter
3 条有效 Chapter -> 1 条 Arc
```

摘要 Provider 应同时返回全局 `rollingSummary` 和只描述本批新增对话的 `sceneSummary`。若旧 Provider 只返回纯文本，系统仍更新滚动摘要，但不会将整段历史误登记为独立场景。

`MemoryService` 是 Agent 的统一门面：

- `observeTurn`：在世界状态裁定完成后登记当前回合；
- `recordDecision`：只登记结论、证据、规则、可信度和可见性，拒绝原始推演字段；
- `recordSceneSummary`：登记带情节修订证据的场景摘要，并按阈值晋升章节和故事弧；
- `retrieveContext`：同时召回情节记忆与向量候选，并记录图谱版本；
- `rebuildRange`：编辑、重生成、Swipe 和可见性变化后重放有效分支；
- `invalidateFromMessage`：从指定消息起失效后续记忆，并清理派生向量索引。

Prompt 只接收已过滤的 `memoryContext`，其中按故事弧、章节、场景和情节片段分层召回。最近 16 条消息默认不再从长期记忆重复注入，避免同一段剧情挤占两份上下文预算。记忆检查器显示有效情节数和 Scene / Chapter / Arc 数量，并隐藏已经失效的分支摘要。

## CoT 边界

CoT（Chain of Thought，思维链）是模型解决复杂问题时使用的内部草稿，例如拆解任务、比较候选行动和检查矛盾。它可能包含未经验证的猜测、系统提示细节和已经被推翻的中间结论，因此：

- 不显示原始 CoT；
- 不把原始 CoT 当作剧情正文、事实卡或长期记忆；
- 不持久化 `analysis`、`reasoning`、`thinking`、`chainOfThought`、`cot` 或 `scratchpad` 字段；
- 过滤 `<think>`、`<analysis>`、`<reasoning>`、`<planning>` 和 `<cot>` 控制块。

需要保留的不是推演原文，而是结构化决策摘要：

```json
{
  "decision": "将失踪名单视为待核验线索",
  "evidenceMessageIds": ["assistant-message-id"],
  "policy": "角色卡与世界书优先",
  "confidence": 0.8,
  "visibility": "player"
}
```

这使后续模型能够知道“采用了什么结论、依据是什么”，而不依赖不可审计的内部草稿。

## 存储与后续演进

- 情节记忆当前随 Session JSON 本地保存；
- 剧情知识图谱保存在本地 SQLite，并在 Session 中保留兼容投影；
- 向量索引是可重建的派生检索层；
- 角色卡、世界书、存档、向量数据和密钥都不进入 Git。

v1 已实现 Scene / Chapter / Arc 自动晋升、修订证据校验和分层召回。下一步应在不改变 `MemoryService` 调用方的前提下，增加独立 Memory Repository、摘要质量评测，以及角色卡/世界书/事件账本之间的记忆冲突审阅。
