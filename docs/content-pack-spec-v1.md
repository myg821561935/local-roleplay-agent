# LRA Content Pack v1

`lra.content-pack/v1` 是本项目的可移植剧本包。文件必须是 UTF-8 JSON，根节点只包含声明和内容，不允许可执行字段。

## 最小结构

```json
{
  "spec": "lra.content-pack/v1",
  "manifest": {
    "spec": "lra.content-pack/v1",
    "id": "local.rain-night",
    "version": "1.0.0",
    "title": "听雨夜",
    "description": "雨夜旧案支线",
    "author": "local",
    "license": "未声明",
    "publisher": "local-roleplay-agent",
    "engine": ">=0.2.2 <1.0.0",
    "capabilities": ["character", "worldbook", "prompt", "rules"],
    "dependencies": [
      {
        "kind": "plugin",
        "id": "core.sillytavern-lorebook",
        "range": "^1.0.0",
        "optional": false,
        "scope": "runtime"
      }
    ]
  },
  "content": {
    "sessionTitle": "听雨夜",
    "visualPackId": "lingyi",
    "characterCard": {},
    "characterPresets": [],
    "worldBook": [],
    "promptModules": [],
    "memory": {},
    "ruleSystem": {}
  }
}
```

## 依赖规则

- `kind`：`plugin` 或 `content-pack`。
- `range`：SemVer 范围。
- `scope`：`runtime` 表示运行必需，`build` 表示生成时来源。
- `optional`：可选依赖缺失时只提示，不阻断安装。

## 安装规则

- 相同 ID 与相同版本视为重复安装。
- 相同 ID 的更高版本执行更新。
- 降级、引擎不兼容、运行依赖缺失或内容结构无效时阻断。
- 内容包中的 `entry`、`main`、`module`、`script`、`scripts`、`command`、`hooks` 等字段不被接受。
