# 剧情知识图谱 v1

剧情知识图谱用于持久保存人物、势力、地点、任务及其关系。它是服务端事实层；前端人物关系图只是其玩家可见投影，不承担事实提取或持久化。

## 实现边界

- 默认实现为 `data/knowledge-graph.sqlite`，随本地数据一起备份，不进入 Git。
- Session JSON 保留 `memory.knowledgeGraph` 兼容投影，旧存档按内容指纹惰性迁移。
- SQLite Repository 与领域契约分离，后续可以增加 Neo4j 适配器，但运行时不依赖 Neo4j。
- 模型不能执行 SQL 或 Cypher，只能产生受约束的图变更提案。
- 玩家投影永远排除 `visibility=director` 的节点和边。

## 节点与关系

节点类型：`Character`、`Faction`、`Location`、`Event`、`Item`、`Quest`、`Knowledge`。

关系类型：`INTERACTED_WITH`、`KNOWS`、`TRUSTS`、`HOSTILE_TO`、`MEMBER_OF`、`OWES`、`LOCATED_AT`、`WITNESSED`、`KNOWS_SECRET`、`RELATED_TO`、`INVOLVED_IN`。

节点和关系均记录来源、来源对象、权威级别、可信度、可见性、状态及更新时间。关系额外记录生效/失效回合和证据消息 ID。

## 来源权威

| 来源 | 权威值 | 用途 |
| --- | ---: | --- |
| `role_card` | 500 | 角色身份、性格与行为边界 |
| `world_book` | 500 | 世界规则与既定事实 |
| `user_confirmed` | 400 | 用户明确确认的剧情事实 |
| `dialogue` | 300 | 正文中实际发生并经提取的事实 |
| `world_state` | 250 | 旧版世界状态兼容迁移 |
| `migration` | 200 | 系统迁移记录 |
| `model_inference` | 100 | 尚待确认的模型推测 |

低权威提案不得覆盖高权威事实。旧关系失效时标记为 `superseded`，不物理删除历史。

## 调用链

```text
角色卡 / 世界书 / 世界状态 / 正文提取
  -> buildSessionGraphSnapshot
  -> KnowledgeGraphService
  -> SQLiteGraphRepository
  -> 两跳场景子图
     -> Prompt 关系锚点
     -> 玩家人物关系图
     -> GET /api/sessions/:id/knowledge-graph
```

查询接口默认返回玩家视图，支持 `depth=0..4`；只有显式指定 `view=director` 才返回导演知识。变更审计可通过 `/api/sessions/:id/knowledge-graph/mutations` 查看。

## 兼容与恢复

图数据库是本地派生事实层。首次读取旧 Session 时根据角色卡与 `worldState` 建图；后续使用稳定指纹避免重复写入。完整备份会包含 SQLite 文件和 Session JSON。恢复全量数据后应按现有提示重启服务，使数据库连接重新指向恢复后的文件。
