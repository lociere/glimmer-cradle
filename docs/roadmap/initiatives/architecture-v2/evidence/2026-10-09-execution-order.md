# 主执行任务书与防漂移检查

> 范围：本次文档任务的交付证据；不接受任何产品实现任务。
> 输入：89e476be 上的文档、状态路由与 repo-checks 工作区改动。
> 维护触发：本候选变更或验证结果变化。

## 成果

- 主任务书固定 A00 至 P15B 的 22 项任务、动作、范围、命令、完成门和例外处理。
- execution.json 只保留原有真实状态，任务入口全部指向主任务书章节；未将 planned 产品任务标为已完成。
- 主任务书纳入目标清单与规范摘要；检查器拒绝缺失指令文件、任务顺序漂移、漏项或错误章节路由。
- 项目入口、Skill、通用指南、阶段计划和 A00 输入索引引用同一主任务书。

## 验证

环境：Windows / PowerShell，仓库根目录；输入为上述 HEAD 加本次文档/工具 dirty 范围。

| 命令或检查 | 结果与覆盖 |
|---|---|
| `pnpm check:docs --write`、`pnpm check:target-layout --write` | PASS；重建状态、docs 树与目标树 |
| `pnpm --filter @glimmer-cradle/repo-checks test` | PASS，33 项；包含任务顺序、章节路由、指令漏项和缺失章节的拒绝反例 |
| `pnpm check:docs` | PASS，116 份活跃 Markdown 的链接、入口、清单、状态与生成视图 |
| `pnpm check:architecture` | PASS；规范锁与既有架构规则 |
| `pnpm check:encoding` | PASS；合法 UTF-8 无 BOM |
| `pnpm typecheck` 后 `pnpm build` | PASS；顺序执行，根工程基线 |
| 改动 Markdown 本地章节引用核对 | PASS，102 个锚点 |
| `git diff --check` | PASS |
| `checkTargetLayout(..., {final:true})` 只读差距核对 | 尚未满足最终实现：536 缺项、963 旧路径，共 1,499 项；与文档任务前相同，无其他错误 |

上述成功命令退出码均为 0。最终目录差距核对只统计实际差距，不代表 final 门通过。
产品任务状态仍为 A00 ready、其余 planned；本记录不作为 A00 或任何产品任务的接受证据。

## 失效条件

任务顺序/路由、规则、生成器、目标清单或规范正文改变时，重验对应门。
本次未启动产品重构、未操作生产数据、未进行真实设备/外部平台或最终成品验收。
