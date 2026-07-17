# Local Data Domain

`data/` 是 Glimmer Cradle 的可重定位本机数据根。开发态默认位于仓库根目录；Desktop 打包态映射到 Electron `userData/data/`，Personal Server 由部署配置映射到持久卷。除本说明外，内容均不进入 Git。

```text
data/
├── state/             # 按 owner 隔离的长期状态、记忆、经历与偏好
├── models/            # 本地模型和用户导入模型
├── packages/          # 可重装的第三方包、Extension 和 SDK
├── cache/             # 可删除、可重建的缓存
├── work/              # 音频输入、导出中间文件等短生命周期工作材料
├── observability/     # logs、traces、metrics、模型调用观测、索引和诊断包
├── run/               # 动态端点、PID、锁与进程代际；停机后无保留契约
└── backups/           # 用户主动备份或正式迁移前快照
```

## 边界

- `state/` 是唯一需要默认保护的数据域，子目录必须由 `cognition`、`kernel`、`avatar`、`desktop` 或具体 Extension owner 管理。
- `models/` 保存模型本体；下载缓存进入 `cache/`，单次处理材料进入 `work/`。
- `packages/` 只保存第三方可重装内容。第一方构建进入仓库 `build/`，最终可分发物进入 `dist/`。
- `observability/logs/application/` 保存第一方应用日志及受管进程 console 输出；结构化事件和审计分别进入 `logs/events/`、`logs/audit/`。
- `run/` 不得保存跨启动状态。端点目录为 `run/host/endpoints.json`，停机时由生命周期 owner 清理。
- `artifacts/`、`backup/`、`blobs/`、`tmp/`、`legacy/` 不属于当前架构。新增数据类型必须先确定 owner、保留期、恢复语义和 resolver。

完整路径契约见 `docs/reference/data-layout.md`。
