---
name: glimmer-services
description: Implement or review Glimmer Cradle Host services, persistence, Jobs, capability execution, configuration and resource lifecycles; simple definition lookups can use docs or source directly.
---

# 服务与数据工程

只查询一个已知配置键或定义时直接查对应 Reference/源码，无需展开服务实现与验收流程。

首次实现或链路不明时追踪实际入口→接纳/授权→领域 owner→持久提交/副作用→公开投影→停止与恢复。
owner 和链路已明确时直接使用相关 manifest、composition、公开 API 与测试，只核对本次影响；
未知入口再查 [实现地图](../../../docs/architecture/implementation/README.md)或[当前拓扑](../../../docs/architecture/current/10-当前物理拓扑.md)。不要仅测试 helper 后推断产品已接入。
现有 Kernel/Product 与迁移中 Host 可同时存在，但不能建立第二 writer；目标边界查 [v2.1](../../../docs/architecture/target/baseline.md)。

## 选择必要细节

| 工作 | 方法/事实 |
|---|---|
| 数据库、资产、缓存、任务、跨库一致性与迁移 | [持久化方法](references/persistence.md)；[数据 Reference](../../../docs/reference/data-layout.md) |
| 扩展加载/撤销、公开 SDK、MCP、外部 Adapter | 转到 [glimmer-integrations](../glimmer-integrations/SKILL.md)；同时改服务/存储边界时再组合本方法 |
| 认证/授权、路径、网络、上传、隐私与秘密 | [安全方法](../../../docs/how-to/审查权限与外部边界.md)；具体入口的 Schema/权限代码 |
| 生命周期、readiness、进程、配置 | [Kernel/Runtime 实现](../../../docs/architecture/implementation/Kernel与Runtime实现.md)、Platform/Host 源码与真实测试 |
| 新跨边界字段或兼容策略 | [glimmer-contracts](../glimmer-contracts/SKILL.md) |
| CI、固定制品、安装/回滚 | [glimmer-delivery](../glimmer-delivery/SKILL.md)；普通局部编译直接使用包脚本 |

## 实施判断

- 分开 domain owner、进程和部署单元。状态机有明确接纳点、转换及持久确认；App 接线 port，
  不以 service locator、交叉内部 import 或复用一个数据库总管隐藏 owner。
- Node 同步 SQLite/CPU 工作和 Python event loop 中的阻塞都要按实际耗时判断；并发有上限、背压和取消。
  不在 SQL 事务中跨网络 await；异步处理不自动获得 exactly-once 语义。
- 生命周期识别 startup、ready/degraded、失败、drain、stop。deadline 使用项目 Clock/预算，
  timeout 只说明等待结束，不能当任务已停止。旧 epoch/取消后/迟到回调不得发布新 ready 或接纳工作。
  释放失败保留可恢复 owner；重复 stop/retry 不创建第二组资源。
- 配置区分解析/校验/默认值、不可变快照、revision/CAS、effect 与重启要求；路径经 resolver。
  安装目录只读，AppRoot/ConfigRoot/DataRoot/RunRoot 的具体规则查 [配置](../../../docs/reference/configuration.md) 与数据 Reference。
- 服务端 HTTP/WS/gRPC 实际采用什么栈就核验什么栈。输入/帧大小、deadline、错误 code、trace、
  断连和重试语义连同 consumer 一起设计；健康 endpoint 不冒充所有业务 ready。

## 验证成果

采用临时真实 SQLite、受控时钟/barrier、真实 App 注入点和传输替身；在授权且需要时补真实子进程链。
覆盖成功、非法输入、拒权、重复、取消、部分失败、crash/reopen、迟到与资源释放，按影响选取。
常用入口来自根 `test:host`、`test:platform`、`test:conversation`、`test:capabilities`、`test:jobs` 及对应包 tests，
先确认 manifest 中的前置 build 和副作用，再运行定向命令。临时数据、网络和进程由测试 owner 收尾。

交付说明服务/数据 owner、调用与提交边界、实际集成证据及尚未切换的产品 consumer；
验证和独立审查见 [共享方法](../../../docs/how-to/测试与验收.md)。
紧耦合的接纳/资源 owner/失败传播修复按一个可验证结果收束；局部保存提交不拆断这条责任链，也不自动逐提交发审。
