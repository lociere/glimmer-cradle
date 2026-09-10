# Engineering Lifecycle Reference

## 宿主事务

| 项 | 值 |
|---|---|
| host owner root | `/run/glimmer-cradle/host-owner/`，`root:root`、`0700` |
| service IPC root | `/run/glimmer-cradle/service/`，UID/GID `10001`、`0700`；映射为容器内 `/run/glimmer-cradle/` |
| lock | `/run/glimmer-cradle/host-owner/host.lock` |
| guard | `/run/glimmer-cradle/host-owner/.host.lock.guard` |
| handoff | `/run/glimmer-cradle/host-owner/handoff/<operation-id>.{request.json,result.json,ack,decision}` |
| journal | `/var/lib/glimmer-cradle/transactions/{current.json,events.jsonl}` |
| execution phases | `acquire`、`prepare`、`replace`、`restart`、`readiness`、`bridge_readiness`、`commit` |
| operation states | `unsupported`、`accepted`、`started`、`committed`、`failed`、`recovery_required`、`owner_timeout`、`conflict`、`error` |

宿主事务与服务 IPC 不共享可写根目录。候选镜像、Caddy 镜像和 Caddyfile 只进入临时 Compose projection；readiness 成功后，部署 owner 才以单次 rename 原子替换 canonical `deployment.env`。失败补偿始终从未混入候选字段的 previous projection 重建，不允许形成“旧镜像 + 候选路径”的拼接状态。同镜像重装也走这条事务，以重新核对完整 projection，而不是跳过配置提交门。

`/var/lib/glimmer-cradle/` 是 root-owned 控制面，容器 bind source `config/` 与 `data/` 归 UID/GID `10001`；`data/backups/`、`data/diagnostics/deploy/` 仍是 root-only 子域。失败候选在销毁前把 Compose 状态和日志保存到 `data/diagnostics/deploy/<transaction-id>/`，诊断失败不阻断回滚。

| stable exit | 64 usage；66 missing/unavailable；70 failed；75 locked；77 confirmation denied；78 recovery required；130 INT；143 TERM |

`commit` 只表示最后执行阶段，`committed` 才是成功终态。日志字段默认不包含 token、secret
或 raw payload。

POST `/api/v1/operations` 必须接受并返回 canonical `operation_id`；GET
`/api/v1/operations/<operation-id>` 使用 `operations:write` 鉴权并返回同一持久结果。
`accepted/started` 为 HTTP 202，`committed` 为 200，unsupported/conflict/owner timeout/
recovery required/failed/error 均为非 200；只有 committed 可写 audit succeeded。

## 备份与 DLQ

| 类型 | 路径 | Cleanup |
|---|---|---|
| manual | `/var/lib/glimmer-cradle/data/backups/manual/` | 不由 transaction history 清理 |
| transaction | `/var/lib/glimmer-cradle/data/backups/transaction/` | 按部署 history retention |
| restore-safety | `/var/lib/glimmer-cradle/data/backups/restore-safety/` | 恢复证据，独立保留 |

DLQ 命令为 `list`、`show`、`replay`、`resolve`、`cleanup`。`replay` 需要
`--confirm --dispatcher <registered-id>`；registration 固定 owner、允许 source 与命令，
receipt 必须精确返回 source、record id、owner、event type、trace id、payload SHA-256、
operation ID、dispatcher ID 与 `kernel_event_bus_published` delivery，且 status 为
`success`。Kernel 当前注册 `kernel.event-bus.v1`；它等 owner-local EventBus ingress 真实
publish 并落 durable receipt 后才成功。legacy Cognition source 未注册，返回 66，不能退回
任意命令。`resolve/cleanup/raw show` 也需要显式确认。
cleanup 只删 `replayed=1` 且从成功 receipt 时间起超过天数门的记录；没有 receipt 时间的
legacy 记录保留。

Replay-capable handler 必须注册稳定 `handler_id` 与 owner。EventBus 在
`data/state/kernel/dlq-replay-inbox/processed/effects/<operation-id>/<handler-id>.json`
逐 handler 原子写入 committed effect；重试只执行未提交 handler。所有当前 inventory 的
ledger 校验通过后才写 aggregate effect 和 receipt；owner、handler、payload digest 或
inventory 漂移都失败闭合并保留原始 envelope。

Desktop Windows 的 Kernel 进程树由产品自有 `DesktopProcessTreeBridge.exe` 持有 Job
Object（`KILL_ON_JOB_CLOSE`），不依赖 Unity Avatar launcher。启动顺序固定为 suspended、
AssignProcessToJobObject、resume；root exit 不释放 authority，stop/timeout 只有 helper
返回 `terminated` 且 active count 为零时才允许 stopped，缺少 helper projection 直接
failed closed。

## Fixed artifact

两个产品都产生 `artifact-manifest.json`、`provenance.json`、组件/依赖级
`sbom.spdx.json` 与明确标为 unsigned 的 `build-claim.json`。可信 attestation 不存放为
自洽 JSON；GitHub workflow 用 Sigstore 身份签发并要求 verifier 接收独立 expected
commit、manifest digest 与 builder，Release 下载后再次用 `gh attestation verify` 核对
repository/source/signer。Personal Server 路径为
`dist/personal-server/<version>/linux-amd64/`；Desktop 路径为
`dist/desktop/<version>/windows-x64/`。制品和 derived report 不进入 Git。

公共任务、精确 source/test/workflow 路径见
[M13 完成态物理目录](../roadmap/manifests/M13-目标物理清单.md)。
