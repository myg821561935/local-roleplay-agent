# LRA Plugin Manifest v1

`lra.plugin/v1` 是声明式资源适配插件。它只描述格式识别能力，不携带或执行第三方代码。

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

## 匹配规则

- `previewKinds`：解析后的内部预览类型。
- `sourceIncludes`：来源站点、社区名或 URL 中需要出现的文本。
- `sourceSpecIncludes`：角色卡来源规范中需要出现的文本。
- `fallback`：仅在没有更高优先级专用适配器时作为回退。

## 安全边界

- 禁止在插件或适配器中声明 `entry`、`main`、`module`、`script`、`scripts`、`command` 或 `hooks`。
- 插件不能访问网络、文件系统、MCP 或 Provider 凭证。
- 插件停用后，其适配器不再参与新资源匹配；已经标准化入库的资源保持不变。
- 未来若引入可执行插件，应使用独立权限模型和沙盒协议，不扩展本规范的隐式能力。
