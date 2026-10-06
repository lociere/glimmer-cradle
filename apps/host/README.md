# Host

`@glimmer-cradle/host` 是 v2.1 Node App 装配 owner。当前已落位的实际消费面为
`composition/cognition-job-adapter.ts`：通过唯一生成 Cognition Service 投递 Memory 源请求、执行
Jobs handler，并核验原 attempt 的 Memory 持久封口/结果证据。Core Jobs 不导入 Cognition，App
不导入 Kernel 内部实现；`CognitionClient` 的端点/generation 必须由监督 owner 注入并在切代时撤销。

`pnpm build` 包含该 workspace，`pnpm test:host` 使用真实 Python Worker RPC、Memory/Log 和 Jobs
SQLite 验证源 ACK 丢失、业务响应丢失、重启对账及未到达 attempt 封口后重试。生产 supervisor、
gateway、scheduler/config 和产品启动迁移尚未完成；本包当前不提供伪装成可启动 Host 的空 CLI。

完整进度与临时 owner 退出条件见 [架构迁移执行记录](../../docs/roadmap/architecture-v2-refactor.md)。
