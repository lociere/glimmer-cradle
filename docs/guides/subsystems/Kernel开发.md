# Kernel 开发

> 适用场景：修改 Kernel lifecycle、runtime module、Ingress Gate、跨进程 Service、Application service、Capability、Skill Plane、Extension Host、Desktop/Avatar/Audio 投影。
> 前置条件：已读 [Kernel 当前视图](../../architecture/current/07-子系统当前视图/Kernel与Runtime.md) 与 [Kernel 与 Runtime 实现](../../architecture/implementation/Kernel与Runtime实现.md)。

## 改动路径

| 任务 | 主要文件/目录 |
|---|---|
| 新增/修改 runtime | `core/kernel/src/runtime/modules/`、`composition/kernel-application.ts` |
| 输入闸门 | `application/ingress/`、`application/use-cases/perception-app.service.ts` |
| 子进程监督 | `adapters/process/`、对应 `runtime/modules/` |
| Cognition Service | `adapters/cognition/`、`application/capabilities/inference/cognition-manager.ts` |
| Audio | `application/capabilities/audio/` |
| Avatar | `application/capabilities/avatar/` |
| Desktop 投影 | `application/capabilities/desktop-ui/` |
| Skill Plane | `application/skill-plane/` |
| Extension Host（Slice 3 暂在 Kernel） | `application/extension-supervision/`、`adapters/extension-host/`、`application/use-cases/extension-host-app.service.ts` |
| 日志/trace/DLQ | `adapters/observability/`、`adapters/events/dead-letter-queue.ts` |

## 标准步骤

1. 确认 owner：Kernel 是否只做生命周期、路由、权限、状态投影和能力编排。
2. 若 Kernel–Cognition RPC 改变，先改 `contracts/proto/glimmer/{common,cognition,kernel}/v1/`，运行 `pnpm contracts:generate` / `pnpm contracts:verify`；不得手改 generated。
3. 找 producer、mapper、consumer、projection 和 tests。
4. 修改 root/module/service，不在调用端堆临时补丁。
5. 保持 `domain <- application -> ports <- adapters`；Runtime 只提交运行事实给 `application/projection/runtime-readiness-projection.ts`，不得直接写只读投影。
6. 补 ready/degraded/failed/stop 语义。
7. 删除旧事件、旧 bridge、旧 handler、旧 fallback。
8. 同步 Current/Implementation/Reference/Guide 中唯一受影响页面。

## 新 runtime 检查表

| 项 | 要求 |
|---|---|
| id | 唯一、稳定、出现在日志和 snapshot |
| dependencies | 启动前依赖明确 |
| blocking/degradable | 失败是否阻断主线 |
| start | 建立资源，不把启动成功当 ready |
| ready | 真实业务握手、资源和能力可用 |
| failed/degraded | 用户和日志能解释 |
| restart | 重启后重新握手、catalog、handler、projection |
| stop | 释放进程、端口、订阅、计时器、临时文件、日志 flush |
| observability | trace、runtime log、process log、DLQ 可定位 |

## 常见失败与定位

| 症状 | 检查 |
|---|---|
| UI 显示在线但输入丢失 | Ingress Gate、required SDK snapshot、Desktop IPC |
| 子进程启动但能力不可用 | health vs warmup vs ready，process log |
| 重启后工具还指向旧 handler | Skill registry 撤销、provider dispose、Gateway 引用 |
| renderer 状态旧 | projection producer、preload subscription、store 更新 |
| 停机卡住 | stop 顺序、未释放订阅/计时器/stdio/WebSocket |
| Cognition 注册失败 | generation、自身/受管父 PID、动态回环端点与 process log |
| DLQ 增长 | event bus、payload schema、owner 错误 |

## 验证

```powershell
pnpm --filter @glimmer-cradle/kernel typecheck
pnpm typecheck
pnpm build
```

生命周期和子进程改动还要验证：正常启动、缺资源、超时、崩溃、重启、主动停机、反向停机、日志和 DLQ 定位。能实机启动时检查 `data/observability/logs/application/kernel.pretty.log` 与 `logs/application/`。

## 需要同步的文档

- runtime/边界变化：Current。
- 代码入口和链路变化：Implementation。
- 字段/配置/路径变化：Reference。
- 操作和排障变化：Guides。
