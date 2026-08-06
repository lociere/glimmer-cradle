# Roadmap

> 范围：记录当前承诺、候选事项、蓝图落地母路线、里程碑成果、风险和验收门；不保存已落地架构事实正文。
> 事实依据：蓝图差距、Current/Implementation、测试结果、真实运行诊断和用户目标。
> 维护触发：承诺范围、里程碑状态、验收门、风险、依赖、候选事项或完成归档变化。

路线图回答“接下来承诺把什么做到什么验收状态”，以及“蓝图应该按哪些阶段落地”。它不是任务流水账、历史正文仓库或架构说明书。

| 文件 | 用途 |
|---|---|
| [now.md](./now.md) | 当前唯一活跃推进面、下一验收门和本次审阅日期 |
| [blueprint-realization.md](./blueprint-realization.md) | 从项目 0 到架构蓝图完全落地的全阶段母路线；不等同当前承诺 |
| [milestones/](./milestones/) | 已承诺或进行中的里程碑，按成果写 |
| [manifests/](./manifests/) | M12/M13 的完成态目录树、Current → Target 动作与删除门 |
| [backlog.md](./backlog.md) | 有价值但未承诺的候选能力 |

M13 A～F 已完成，待本次合入 main。下一活跃推进面等待总控与用户选择；不自动启动 M12/M11。[M12 Slice 1 contracts baseline](./milestones/M12-契约脊柱与跨进程服务架构重建.md) 已集成，runtime consumer 尚未迁移。

## 状态规则

| 状态 | 含义 |
|---|---|
| `planned` | 已决定进入路线图，但尚未开始 |
| `in-progress` | 正在推进，有明确验收门 |
| `at-risk` | 目标仍有效，但依赖、风险或验证阻塞 |
| `candidate` | 与蓝图一致但尚未承诺，只能作为候选存在 |
| `done` | 验收门已满足，当前事实已迁入 Architecture/Reference/Guide |

进入 `done` 前必须满足所有验收门。完成后：

- 当前事实进入 Architecture、Implementation、Reference 或 Guide。
- 长期取舍进入 ADR。
- 过程材料或被替代计划进入 History。
- Roadmap 只保留完成摘要或从 `now.md` 移除。

## 可执行里程碑门

里程碑必须包含目标成果、范围、非范围、依赖、风险、验收门和完成后的归档位置。每个
可执行 slice 还必须按 [文档维护规范](../文档维护规范.md#完成态物理目录门) 写出最终
目录树、owner、Current → Target 动作和旧路径删除门；无法确定最终路径时只能处于
discovery/design。历史 milestone 不追溯整改，本次只更新 M12/M13。
