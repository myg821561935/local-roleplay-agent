# 轻前端兼容运行时 v1

本运行时用于承接社区角色卡的声明式轻前端能力，以及少量经过人工审核的第三方脚本。目标是让内容在本项目中可玩、可检查、可降级和可审计，而不是逐字复刻酒馆扩展环境。

## 当前能力

- **安全显示正则**：导入 `regex_scripts` 等常见字段，对助手或用户消息的渲染副本执行替换。原始消息、记忆、事件账本和导出内容保持不变。
- **文本 Quick Reply**：识别普通文本以及 `/send 文本`、`/say 文本`，映射到现有输入栏；点击后仍可编辑。
- **白名单变量命令**：`/setvar` 与 `/incvar` 会转换为 `set` / `increment` MVU 补丁；其他 STscript 命令保持禁用。
- **MVU 状态**：导入 JSON 初始值；模型可输出隐藏的 `lra.mvu-patch/v1` 补丁，服务端验证 revision、路径、操作数和状态体积后再提交。手工调试仍可使用 `PATCH /api/sessions/:id/light-frontend/mvu`。
- **安全 EJS 子集**：支持 `<%= mvu.favor %>`、`<%= getvar('favor') %>`、只读 `if/else` 和简单比较；模板可用于角色卡、世界书、Prompt 与快捷回复。
- **声明式侧栏面板**：识别 `panels`、`status_panels`、`sidebar_panels` 等字段，将状态字段、条目列表和 Markdown 说明映射到沉浸侧栏。
- **社区命名空间适配**：识别酒馆助手和小白 X 扩展中的变量、显示正则、文本按钮和声明式面板，并转换为内置数据。
- **SillyTavern Prompt 预设**：识别原生及 Tavern Helper 导出的预设 JSON，按 `prompt_order` 保存模块顺序，并在模型消息中应用 `system/user/assistant` 角色、相对位置及 `in_chat` 的 Depth/Order。
- **分支重放**：Edit、重生成和 Swipe 选择会从导入基线重放当前消息分支的已提交补丁。
- **受限生命周期**：声明式 `onImport`、`onUser`、`onAssistant` 在白名单状态路径和补丁操作内执行；任一步失败时整次事件回滚。
- **受审核脚本沙箱**：含可执行 replacement 的规则按 SHA-256 内容哈希审核；只有当前哈希获得授权后才会进入无父页面权限、默认禁止联网的 iframe 沙箱，并记录本地执行审计。
- **世界书逻辑**：支持 SillyTavern `selectiveLogic` 的 `AND ANY`、`NOT ALL`、`NOT ANY`、`AND ALL` 四种二级关键词过滤。
- **兼容报告**：导入预览固定输出“完整映射”“安全降级”或“阻断运行”，并显式列出差异与阻断原因。

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

## 生命周期统一预算

受限生命周期不会执行原始脚本，只接受声明式状态操作：

- 单事件最多执行 8 次。
- 只允许写入 `variables`、`world`、`character(s)`、`relationships`、`quests`、`inventory`、`flags`、`scene`、`story`、`status`、`stats` 根路径。
- 只允许 `set`、`increment`、`delete`。
- 嵌套步骤最大深度为 4。
- 单轮最大变更数量为 32。
- 解析、路径或补丁应用任一步失败时，整次事件回滚，不保留部分状态。

## 明确不支持

- 未经审核、内容哈希变化、已拒绝或已撤销授权的 JavaScript。
- 访问父页面 DOM、Cookie、localStorage、任意网络、外部脚本、嵌套 iframe、Worker 或宿主隐式全局对象。
- 除 `/send`、`/say`、`/setvar`、`/incvar` 之外的 STscript 或斜杠命令链。
- EJS 赋值、循环、任意函数调用以及绕过审核门禁的 DOM 注入、iframe 和面板事件回调。
- 酒馆助手或小白 X 的可执行事件生命周期、网络能力和隐式全局对象。

静态转换和声明式适配仍是首选。确需执行的第三方脚本只能使用本项目提供的审核、隔离和审计环境，不直接继承酒馆插件的宿主权限。

## Prompt 预设兼容边界

- 酒馆的角色卡、世界书、聊天历史等内置占位符不会作为重复文本导入，而是映射到本项目已有的结构化装配位置。
- 普通 Prompt 内容会作为素材库中的独立模块保存；创建剧本时可选择整套或部分模块。
- `relative` 模块保留消息角色；`in_chat` 模块按 Depth 与 Order 插入当前历史，且不会越过本轮最终用户消息。
- 温度、上下文长度、输出长度和采样参数只保存在预设元数据中，供用户核对后手工采用。
- `regex_scripts` 中的安全显示正则由轻前端转换器承接；含可执行 replacement 的规则进入审核队列，只有当前内容哈希获批后才在隔离沙箱中执行。Tavern Helper 的宿主 Hook 和网络权限不会直接继承。
