# LRA Plugin Manifest v1

`lra.plugin/v1` 是受控声明式插件。它可以描述格式识别规则和引擎已经实现的安全能力，但不携带或执行第三方代码。

## 最小结构

```json
{
  "spec": "lra.plugin/v1",
  "id": "community.example-lore",
  "version": "1.0.0",
  "name": "Example 世界书适配",
  "description": "识别社区导出的世界书 JSON。",
  "engine": ">=0.2.2 <1.0.0",
  "dependencies": [],
  "capabilities": ["safe-macros", "sidebar-panels"],
  "adapters": [
    {
      "id": "example-lore-v1",
      "version": "1.0.0",
      "label": "Example Lore v1",
      "kinds": ["worldbook"],
      "formats": ["json"],
      "priority": 90,
      "capabilities": ["inspect", "normalize", "provenance"],
      "match": {
        "previewKinds": ["world-book"],
        "sourceIncludes": ["example.org"]
      }
    }
  ]
}
```

## 受控能力

顶层 `capabilities` 只接受以下值：

- `safe-macros`：使用引擎白名单宏。
- `regex-triggers`：使用世界书正则触发器。
- `recommended-actions`：输出可点击的推荐行动。
- `world-state`：映射到结构化世界状态。
- `sidebar-panels`：将状态字段、条目列表和 Markdown 说明映射到内置侧栏，不接受自定义事件。
- `action-protocol`：使用 `lra.action/v1` 声明式动作。
- `prompt-ordering`：使用引擎提供的 Prompt 层级与顺序。
- `safe-regex-display`：使用经过限制与校验的显示层正则，不改写原始消息和记忆。
- `quick-replies`：把纯文本快捷回复映射到原生输入栏；不执行斜杠命令链。
- `mvu-state`：使用带 revision 的 JSON 状态和声明式补丁。
- `safe-ejs-template`：仅渲染白名单变量插值与只读条件分支，不执行 EJS JavaScript。
- `community-light-adapters`：把酒馆助手、小白 X 命名空间中的声明数据映射到内置能力。

未知能力会被保留为审阅警告但不会启用。这里的“支持”表示插件资产可以映射到既有受控能力，不表示允许插件注入任意前端或服务端代码。

## 匹配规则

- `previewKinds`：解析后的内部预览类型。
- `sourceIncludes`：来源站点、社区名或 URL 中需要出现的文本。
- `sourceSpecIncludes`：角色卡来源规范中需要出现的文本。
- `fallback`：仅在没有更高优先级专用适配器时作为回退。

## 安全边界

- 禁止在插件或适配器中声明 `entry`、`main`、`module`、`script`、`scripts`、`command` 或 `hooks`。
- 插件不能访问网络、文件系统、MCP 或 Provider 凭证。
- 显示正则只作用于渲染副本；MVU 只接受 `set`、`increment`、`delete`，并限制路径、深度与体积。
- EJS 兼容层只接受属性读取、`getvar`、布尔判断和简单比较；赋值、循环、函数调用均禁用。
- 插件停用后，其适配器不再参与新资源匹配；已经标准化入库的资源保持不变。
- 若未来引入可执行插件，应使用独立权限模型和沙盒协议，不扩展本规范的隐式能力。
