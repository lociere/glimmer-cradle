# Engineering Lifecycle Reference

## 宿主事务

| 项 | 值 |
|---|---|
| lock | `/run/glimmer-cradle/host.lock` |
| guard | `/run/glimmer-cradle/.host.lock.guard` |
| handoff | `/run/glimmer-cradle/handoff/<operation-id>.{result.json,ack}` |
| journal | `/var/lib/glimmer-cradle/transactions/{current.json,events.jsonl}` |
| execution phases | `acquire`、`prepare`、`replace`、`restart`、`readiness`、`bridge_readiness`、`commit` |
| terminal states | `committed`、`failed`、`recovery_required` |
| stable exit | 64 usage；66 missing/unavailable；70 failed；75 locked；77 confirmation denied；78 recovery required；130 INT；143 TERM |

`commit` 只表示最后执行阶段，`committed` 才是成功终态。日志字段默认不包含 token、secret
或 raw payload。

## 备份与 DLQ

| 类型 | 路径 | Cleanup |
|---|---|---|
| manual | `/var/lib/glimmer-cradle/data/backups/manual/` | 不由 transaction history 清理 |
| transaction | `/var/lib/glimmer-cradle/data/backups/transaction/` | 按部署 history retention |
| restore-safety | `/var/lib/glimmer-cradle/data/backups/restore-safety/` | 恢复证据，独立保留 |

DLQ 命令为 `list`、`show`、`replay`、`resolve`、`cleanup`。`replay` 需要
`--confirm --dispatcher <command> [args...]`；`resolve/cleanup/raw show` 也需要显式确认。
cleanup 只删 `replayed=1` 且从成功 receipt 时间起超过天数门的记录；没有 receipt 时间的
legacy 记录保留。

## Fixed artifact

两个产品都产生 `artifact-manifest.json`、`provenance.json`、`sbom.spdx.json` 与
`attestation.json`。Personal Server 路径为
`dist/personal-server/<version>/linux-amd64/`；Desktop 路径为
`dist/desktop/<version>/windows-x64/`。制品和 derived report 不进入 Git。

公共任务、精确 source/test/workflow 路径见
[M13 完成态物理目录](../roadmap/manifests/M13-目标物理清单.md)。
