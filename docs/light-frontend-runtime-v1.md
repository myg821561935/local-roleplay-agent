# 轻前端兼容运行时 v1

本运行时用于承接社区角色卡中不依赖任意 JavaScript 的轻前端能力。目标是让内容在本项目中可玩、可检查、可降级，而不是逐字复刻酒馆扩展环境。

## 当前能力

- **安全显示正则**：导入 `regex_scripts` 等常见字段，对助手或用户消息的渲染副本执行替换。原始消息、记忆、事件账本和导出内容保持不变。
- **文本 Quick Reply**：识别普通文本以及 `/send 文本`、`/say 文本`，映射到现有输入栏；点击后仍可编辑。
- **MVU 状态**：导入 JSON 初始值；模型可输出隐藏的 `lra.mvu-patch/v1` 补丁，服务端验证 revision、路径、操作数和状态体积后再提交。手工调试仍可使用 `PATCH /api/sessions/:id/light-frontend/mvu`。
- **安全 EJS 子集**：支持 `<%= mvu.favor %>`、`<%= getvar('favor') %>`、只读 `if/else` 和简单比较；模板可用于角色卡、世界书、Prompt 与快捷回复。
- **声明式侧栏面板**：识别 `panels`、`status_panels`、`sidebar_panels` 等字段，将状态字段、条目列表和 Markdown 说明映射到沉浸侧栏。
- **社区命名空间适配**：识别酒馆助手和小白 X 扩展中的变量、显示正则、文本按钮和声明式面板，并转换为内置数据。
- **SillyTavern Prompt 预设**：识别原生及 Tavern Helper 导出的预设 JSON，按 `prompt_order` 保存模块顺序，并在模型消息中应用 `system/user/assistant` 角色、相对位置及 `in_chat` 的 Depth/Order。
- **分支重放**：Edit、重生成和 Swipe 选择会从导入基线重放当前消息分支的已提交补丁。
- **兼容报告**：导入预览区分原生支持、需要转换和缺少外部运行时，并分别标注“可安全保存”与“可直接游玩”。

## 安全模板示例

```ejs
<% if (mvu.relationships.shen >= 20) { %>
沈观澜愿意透露第二层口供。
<% } else { %>
沈观澜仍保持戒备。
<% } %>
```

当前比较运算支持相等判断和数值大小判断；状态值也可以用 `<%= getvar('relationships.shen') %>` 读取。模板运行时不能赋值，状态变化必须走 MVU 补丁接口。

## 声明式面板

面板可放在角色卡 `extensions.tavern_helper.panels`、`extensions.xiaobai_x.panels` 或内容包 `lightFrontend.panels` 中。

```json
{
  "title": "关系档案",
  "subtitle": "本幕人物状态",
  "kind": "stats",
  "summary": "<% if (mvu.relationships.shen >= 20) { %>已建立信任<% } else { %>仍在观望<% } %>",
  "tone": "relationship",
  "fields": [
    { "label": "好感", "path": "relationships.shen" },
    { "label": "立场", "template": "<%= mvu.relationships.stance %>" }
  ],
  "items": [
    { "title": "未了之约", "detail": "尚欠一次旧案人情", "status": "未完成" }
  ],
  "content": "**说明：** 数据来自当前会话 MVU，不改写角色卡原文。"
}
```

面板类型支持 `stats`、`list`、`text`；颜色语义支持 `active`、`warning`、`resource`、`faction`、`relationship`。未识别的字段不会注入 DOM。

## MVU 补丁

模型输出使用隐藏控制块；该内容不会进入正文或流式显示：

````text
```lra-mvu-patch
{
  "spec": "lra.mvu-patch/v1",
  "expectedRevision": 3,
  "summary": "本回合稳定变量变化",
  "operations": [
    { "op": "increment", "path": "relationships.shen.trust", "value": 1 }
  ]
}
```
````

手工接口接受相同的 `expectedRevision` 与 `operations` 结构：

```json
{
  "expectedRevision": 3,
  "operations": [
    { "op": "set", "path": "relationships.shen", "value": 20 },
    { "op": "increment", "path": "clues", "value": 1 },
    { "op": "delete", "path": "temporary.warning" }
  ]
}
```

状态限制深度、体积和路径，拒绝原型链键；revision 不一致时返回 `409 MVU_REVISION_CONFLICT`。

## 明确不支持

- 任意 JavaScript、`<script>`、事件 Hook、动态网络请求。
- 除 `/send`、`/say` 之外的 STscript 或斜杠命令链。
- EJS 赋值、循环、任意函数调用、DOM 注入、iframe、自定义 CSS 和面板事件回调。
- 酒馆助手或小白 X 的事件生命周期、网络能力和隐式全局对象。

这些能力后续只能通过声明式适配器或隔离的重前端沙盒接入，不会扩大当前运行时权限。

## Prompt 预设兼容边界

- 酒馆的角色卡、世界书、聊天历史等内置占位符不会作为重复文本导入，而是映射到本项目已有的结构化装配位置。
- 普通 Prompt 内容会作为素材库中的独立模块保存；创建剧本时可选择整套或部分模块。
- `relative` 模块保留消息角色；`in_chat` 模块按 Depth 与 Order 插入当前历史，且不会越过本轮最终用户消息。
- 温度、上下文长度、输出长度和采样参数只保存在预设元数据中，供用户核对后手工采用。
- `regex_scripts` 和 Tavern Helper 脚本只进入依赖报告；安全显示正则可由轻前端转换器承接，其他脚本不会执行。
