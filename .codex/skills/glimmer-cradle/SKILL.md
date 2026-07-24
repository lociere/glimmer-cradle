---
name: glimmer-cradle
description: Develop, review, debug, or document the Glimmer Cradle（微光摇篮）repository while preserving its architecture, protocol, lifecycle, character-profile, and documentation boundaries.
---

# Glimmer Cradle 开发 Skill

本 Skill 是项目操作手册，不是当前实现的副本。当前目录、端口、阶段、默认 provider、配置值和已落地状态必须从代码、Schema、配置与 `docs/` 读取。

## 配置定位

`.codex/skills/glimmer-cradle/` 是本仓库唯一 canonical agent Skill（目录名暂保留，后续单独迁移）。其他工具入口（例如 `.claude/CLAUDE.md`、`.github/copilot-instructions.md`）只能作为薄入口，指向 `AGENTS.md`、`docs/README.md` 和本 Skill；不得复制 `.codex/skills/glimmer-cradle/references/` 或维护第二套项目事实。

## 每项任务的最小流程

1. 读取根目录 `AGENTS.md`、`docs/README.md`、[开发手册](../../../docs/guides/开发手册.md)，并检查 `git status --short`。
2. 架构设计先读 `architecture/blueprint/`，理解当前结构读 `architecture/current/`，改代码先读对应 `architecture/implementation/`；再核对实际代码、Schema、测试和配置。
3. 先写清用户可观察目标、事实源、生命周期 owner、跨边界契约、成功/失败/降级语义和验证矩阵；用户只要求分析时不修改。
4. 跨层改动先做 Schema/公开 Port，再按生产者、映射层、消费者、投影顺序实现；单层改动也要覆盖空态、错误和释放路径。
5. 删除被替代的旧入口、旧字段、旧桥接和无期限兼容壳；更新蓝图/Current/Implementation/Reference/Guide 中唯一受影响的事实源。
6. 架构升级必须落到真实物理形态：目录结构、文件名、配置键、Schema、加载链路、默认模板、测试和文档同步升级；不要只把旧目录解释成新概念。
7. 按风险运行验证；交付必须区分已运行验证、未运行验证及原因、真实阻塞和剩余风险。

## Reference 路由

| 任务 | 必读 reference |
|---|---|
| 任意任务的角色确认、会话创建/换届、下发、等待、验收或交接 | `common/会话与任务编排.md` |
| 任意实现、调试、文档或交付 | `common/开发工作流.md` |
| 测试、构建、启动、验收 | `common/测试与交付.md` |
| 文档、注释、术语、编码 | `common/文档、注释与编码.md` |
| Code review 或设计自查 | `common/审查与反模式.md` |
| 模块归属、依赖、进程边界、重构 | `architecture/架构边界与决策.md` |
| Schema、事件、IPC、WebSocket、SDK | `architecture/协议与跨边界契约.md` |
| Kernel、Engine、子进程、readiness | `architecture/Runtime与生命周期.md` |
| `configs/`、`data/`、资产、路径、打包 | `architecture/数据、配置与路径.md` |
| 日志、trace、metrics、DLQ、性能 | `architecture/可观测性与诊断.md` |
| 人格、情绪、记忆、LLM、认知循环 | `subsystems/Cognition.md` |
| Control Center、Presence、Electron、Unity、Live2D | `subsystems/Desktop与Avatar.md` |
| Extension、Skill Plane、MCP、公开 SDK | `subsystems/Extensions与SkillPlane.md` |

## 硬约束

- 每个会话只担任一个 `session_role`；创建执行、审查或发布/运维会话不等于更换总控。新会话先按 `common/会话与任务编排.md` 声明 parent controller、独占资源 owner、授权与回报契约。
- 跨边界数据由 Schema/公开契约定义；投影、缓存和生成物不是第二事实源。
- Kernel 不承载人格判断，Cognition 不访问平台 IO，Renderer 不推断系统事实，Extension 不获取内部对象。
- 进程存活不等于能力 ready；可降级能力不能伪装为可用。
- 不保留无退出条件的兼容壳、旧协议、旧桥接或双重主线；Git 保留历史。
- 架构优化不留下旧架构外壳；如果目标架构要求新目录或新文件布局，代码、配置和文档必须采用该布局，旧布局不得继续作为运行时入口。
- 文档按 `docs/文档维护规范.md` 选择唯一归属；蓝图表达 Glimmer Cradle 的长期设计语言，Implementation 解释代码，不在 Skill 复制项目事实。
- 新增或重命名标识符、目录、包、命令、配置键、事件或文档术语前，先按 `docs/guides/development/命名规范.md` 判断 owner；中文正文可用“微光摇篮/摇篮”，机器接口保持英文稳定命名。
