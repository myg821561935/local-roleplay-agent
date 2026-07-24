# v0.1 稳定自用版发布基线

## 发布范围

- 本机单用户访问，默认监听 `127.0.0.1:5178`。
- Node.js 20 或更高版本，无第三方运行依赖。
- 角色卡、世界书、Prompt、Provider、会话、记忆和内容包统一存放在 `data/`。
- 数据模式版本为 `v1`，启动时自动执行幂等迁移。
- 备份格式为带 SHA-256 校验的单文件 JSON 快照。

## 一键启动

双击项目根目录中的 `start-local.command`，或运行：

```bash
npm start
```

停止服务可双击 `stop-local.command`，或运行：

```bash
npm stop
```

启动脚本固定使用 `5178`，会识别已运行实例，记录 PID 与日志，并自动打开浏览器：

```text
.runtime/server.pid
.runtime/server.log
```

可通过环境变量覆盖：

```bash
PORT=5180 BIND_HOST=127.0.0.1 NO_OPEN=1 npm run start:local
```

## 备份与恢复

接口配置抽屉中的“本地备份与恢复”支持创建、下载和恢复快照。恢复前会自动创建一份 `pre-restore` 安全备份。

命令行灾备入口：

```bash
npm run backup
npm run backup:list
npm run restore -- <backup-id> --yes
```

备份文件保存在 `backups/`。若已保存 Provider 配置，快照会包含 API Key，因此所有备份都应按敏感文件保管。恢复时不要同时生成对话或修改设定。

## Provider 验证

接口表单中的“测试连接”会使用当前表单配置发起一次最小非流式请求，验证 Base URL、API Key 和模型是否可用。测试不会保存表单，也不会覆盖现有 Provider 配置。

## 发布验收

```bash
npm run release:check
```

验收必须满足：

1. 全部自动化测试通过。
2. 数据迁移达到 `v1`，重复执行不产生新迁移。
3. 创建备份后可以恢复，损坏快照会被拒绝。
4. `/api/health` 返回应用版本和数据版本，且 `ok: true`。
5. Provider 测试连接成功，失败时响应不泄露 API Key。
6. `start-local.command` 可以启动或复用 `5178` 实例，`stop-local.command` 可以停止本项目实例。

## 自用版边界

- 没有多用户账号、远程登录和公网鉴权，不应直接暴露到公网。
- API Key 以本地明文 JSON 保存；已有 Provider 配置时，备份中同样包含密钥。
- 数据恢复以单用户空闲状态为前提，不支持与正在运行的流式生成并发恢复。
- MCP stdio 连接恢复配置后建议重启应用，以重新建立外部进程连接。
