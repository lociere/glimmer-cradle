# ADR-0018：Personal Server 宿主与服务状态分域

- 状态：accepted
- 日期：2026-09-11

## Context

Personal Server 同时存在两类状态 owner：以 root 身份持有全局锁、安装、更新、备份、恢复和失败诊断的宿主事务 owner，以及以 UID/GID `10001` 运行 Kernel、Cognition、Extension Host 和 Product Host 的服务 owner。旧布局把两类状态都直接放在 `/var/lib/glimmer-cradle/` 下，并曾把宿主备份嵌入 service-owned `data/`；运行态也曾让 root 锁与服务 socket 共用一个可写目录。

仅把备份挪到 `data/` 的同级目录仍然没有让物理结构直接表达 owner，文档、环境变量和脚本容易再次把聚合根误当成某一 owner 的写入根。service-owned 父目录还可以改名或删除其中的 root-owned 子目录，因此文件自身为 root 并不足以形成信任边界。

## Decision

1. `/var/lib/glimmer-cradle/` 只作为 root-owned 聚合根，不直接承载某个 owner 的可变文件。
2. 宿主持久态固定在 `/var/lib/glimmer-cradle/host/`，由 `root:root`、`0700` 持有：
   - `transactions/` 保存全局事务 journal；
   - `backups/{manual,transaction,restore-safety}/` 分别持有独立 retention 域；
   - `diagnostics/deploy/` 保存失败候选销毁前证据。
3. 服务持久态固定在 `/var/lib/glimmer-cradle/service/`，由 `10001:10001`、`0700` 持有；其 `config/` 与 `data/` 作为 bind source 投影到容器内规范 `/var/lib/glimmer-cradle/{config,data}`。
4. 短生命周期状态采用相同分层：`/run/glimmer-cradle/host/` 保存 root 锁和 handoff，`/run/glimmer-cradle/service/` 保存服务 IPC；只有 service run root 投影到容器内 `/run/glimmer-cradle/`。
5. `GLIMMER_CRADLE_STATE_ROOT` 和 `GLIMMER_CRADLE_RUN_ROOT` 只表示聚合根；部署层显式派生并记录 `GLIMMER_CRADLE_HOST_STATE_ROOT`、`GLIMMER_CRADLE_SERVICE_STATE_ROOT`、`GLIMMER_CRADLE_HOST_RUN_ROOT` 与 `GLIMMER_CRADLE_SERVICE_RUN_ROOT`。宿主事务库只接受 host state root，不再把聚合根作为 journal owner。
6. 新架构不探测、双读或回退到旧 `config/`、`data/`、`backups/`、`diagnostics/`、`transactions/` 或 `host-owner/` 路径。已有部署如需保留数据，必须在服务停止且有校验备份时执行一次显式离线迁移；验证新树后删除被替代路径。
7. 应用自己的 `data/backups/` 仍是 Local Data Domain 中可由应用 owner 使用的通用语义路径；它不是 Personal Server 的宿主部署事务备份，也不能被宿主恢复命令消费。

## Consequences

- owner、权限、生命周期与目录树一一对应；服务无法通过控制父目录来替换宿主事务证据。
- 容器内配置、数据和 RunRoot 契约保持产品无关，宿主物理布局不会泄漏进 Kernel、Cognition 或 Extension API。
- 安装器、Compose、Ops Bridge、备份恢复、诊断、测试与文档必须共同消费显式 host/service roots。
- 从旧部署升级需要一次停机迁移，但运行主线不承担永久兼容复杂度。

## Alternatives considered

- **继续使用聚合根的同级 `config/`、`data/`、`backups/` 和 `diagnostics/`**：权限可以配置正确，但目录本身不表达 owner，调用者仍容易把聚合根当作统一写入域；拒绝。
- **在 service-owned `data/` 中创建 root-owned 子目录**：service 可改名或删除父目录，不能形成安全边界；拒绝。
- **运行时同时识别新旧路径**：会形成双事实源和无退出条件的迁移壳；拒绝。
- **把宿主路径暴露给应用和 Extension**：会让产品逻辑依赖 Linux 部署实现并扩大第三方权限；拒绝。

## Links

- [目标物理拓扑](../blueprint/目标物理拓扑.md)
- [Data Layout Reference](../../reference/data-layout.md)
- [Engineering Lifecycle Reference](../../reference/engineering-lifecycle.md)
- [ADR-0015 工程自动化平面与交付生命周期分层](./ADR-0015-工程自动化平面与交付生命周期分层.md)
