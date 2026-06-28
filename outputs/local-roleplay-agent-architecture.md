# 本地角色扮演 Agent 架构

这个本地角色扮演 agent 可以理解成一个按轮次运行的对话编排器：

```text
Agent = Prompt 组装器 + 记忆管理器 + API 客户端 + 对话循环 + 状态存储
```

LLM 负责写出下一段回复。Agent 负责决定 LLM 每一轮能看到什么、调用哪个模型 API、如何保存结果，以及如何更新记忆。

## 单轮运行流程

```text
用户消息
  -> 加载会话配置
  -> 检索最近对话、摘要、世界状态、世界书卡片
  -> 在 token 预算内组装 prompt
  -> 调用模型 provider
  -> 保存助手回复
  -> 抽取状态、事件和记忆更新
  -> 必要时总结旧上下文
  -> 在 UI 中展示回复和记忆变化
```

## 主要层次

```text
浏览器网页应用
  - 对话区
  - API 设置
  - Prompt 模块
  - 世界书
  - 记忆检查器

本地 Node 服务
  - 静态网页服务
  - Provider 代理
  - 会话 API
  - 记忆 API
  - 本地 JSON 持久化

Agent Runtime
  - Prompt 组装器
  - 记忆检索器
  - Token 预算控制器
  - 模型 Provider 客户端
  - 记忆更新器
  - 自动总结调度器
```

## 记忆层次

```text
recentTurns       最近 6-10 轮原文
rollingSummary    被压缩的旧上下文
worldState        结构化 JSON，保存长期事实
eventLedger       只追加的事件时间线，用于审计和重建
memoryCards       剧情过程中生成的记忆卡片
worldBook         稳定的世界观/设定条目
```

这个设计避免每轮都注入全部记忆。最近对话负责保留语气和短期连续性，结构化世界状态负责长期事实，世界书和记忆卡片只在相关时注入。

## Personal Creative Mode

本地应用不增加自己的限制词列表、敏感词规避或创作题材过滤。它只关注连续性、角色一致性、状态跟踪和 prompt 控制。实际限制来自你选择的外部模型/API provider。

