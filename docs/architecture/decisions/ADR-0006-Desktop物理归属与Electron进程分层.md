# ADR-0006 Desktop 物理归属与 Electron 进程分层

- 状态：superseded by ADR-0010
- 日期：2026-07-13

## 背景

旧目录 `core/renderer/desktop/` 把整个 Electron 应用归在 Renderer 下，包名 `@glimmer-cradle/desktop-surfaces` 又把完整 Desktop 应用缩写成 Surface 集合。但 Electron main 实际拥有应用生命周期、窗口、托盘、OS 副作用、受控文件访问和 IPC；只有 renderer process 负责 Web UI 呈现。目录和包名因此无法表达真实 owner，也容易诱导后续代码把 main、preload 与 renderer 当成同一信任边界。

## 决策

1. Electron 应用物理归属为 `core/desktop/`，workspace 包名为 `@glimmer-cradle/desktop`。
2. Desktop 内部保留 Electron 正式进程术语 `src/main/`、`src/preload/` 和 `src/renderer/`。
3. main 拥有应用生命周期、窗口、托盘、受控 OS/文件操作和 IPC handler；preload 只暴露最小白名单；renderer 只消费投影和发送用户 intent。
4. `Surface` 继续表示 Presence、Control Center 等出现位置，不再作为整个 Desktop 应用的包名。
5. 开发阶段直接删除旧路径、旧包名和 `dev:shells` 命令，不提供别名、转发包或双路径解析。

## 结果

- 顶层目录直接表达 Desktop owner，Electron renderer 只在应用内部作为进程边界出现。
- Desktop 与 Avatar、Kernel、Cognition 成为同级子系统，不再让 Renderer 概念覆盖 OS 适配层。
- 未来拆分 IPC、设置、诊断和 Surface controller 时，可以在 `core/desktop/src/main/` 内按 owner 演进，不改变顶层归属。

## 验证

- 活跃代码、workspace、脚本、打包配置和文档不再引用 `core/renderer/desktop`、`@glimmer-cradle/desktop-surfaces` 或 `dev:shells`。
- `pnpm --filter @glimmer-cradle/desktop typecheck`、`pnpm build` 和 UI 测试通过。
- 打包资源路径与 repo/data/config resolver 在新目录深度下仍指向唯一事实源。
