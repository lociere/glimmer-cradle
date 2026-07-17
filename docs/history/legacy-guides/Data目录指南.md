# Data 目录指南

`data/` 是月见的 Local Data Domain（本地数据域）。它统一承载月见在本机留下的长期状态、可观测性、大块对象、模型、本地托管包、运行产物、缓存、备份和迁移源。正式客户端中，这套结构映射到 Electron `userData/data/`。

## 目录总览

```text
data/
├── state/
│   ├── cognition/
│   ├── kernel/
│   ├── experience/
│   └── extensions/
├── observability/
│   ├── logs/
│   ├── metrics/
│   └── traces/
├── blobs/
├── models/
│   ├── embedding/
│   │   └── <embedding-id>/
│   └── voice/
│       ├── piper/
│       └── gpt-sovits/
│           └── <voice-id>/
├── packages/
│   ├── gpt-sovits/
│   └── ffmpeg/
├── artifacts/
│   ├── tts/
│   ├── live2d/
│   ├── temp/
│   └── tmp/
├── cache/
├── backup/
└── legacy/
```

## 子目录职责

| 路径 | 所有者 | 职责 | 清理规则 |
|---|---|---|---|
| `data/state/cognition/` | Cognition | `cognition.db`、认知核 DLQ、长期记忆、记忆图谱、向量索引 | 不手动清理；只通过迁移或备份恢复处理 |
| `data/state/kernel/` | Kernel | `kernel.db`、扩展宿主基础设施状态、TS 侧 DLQ | 不存长期记忆；清理前确认可重建 |
| `data/state/experience/` | Cognition | Moment append-only 经历流 | 长期保留；未来通过归档策略移动 |
| `data/state/extensions/` | Extension Host | 扩展持久化数据、用户可读转录、导出型记录 | 按 extension id 隔离 |
| `data/observability/logs/` | Foundation Observability | `runtime.log`、`runtime-error.log`、dev probe 日志、engine sidecar 日志 | 可按保留期轮转 |
| `data/observability/metrics/` | Foundation Observability | `metrics-*.jsonl` | 可按保留期轮转 |
| `data/observability/traces/` | Foundation Observability | `spans-*.jsonl`，用于跨进程 trace | 可按保留期轮转；排障期保留 |
| `data/blobs/` | 引用方共同管理 | 图片、音频、附件等大块二进制对象 | 只有引用已失效时才清理 |
| `data/models/` | Engine / 用户 | 用户下载、导入或安装的模型权重 | 不进 Git；备份策略由用户选择 |
| `data/models/embedding/` | Cognition | 配置选择的 sentence-transformers embedding 模型；缺失时可在启动期自动下载 | 不进 Git；可删除后重下 |
| `data/models/voice/piper/` | Audio Engine | Audio resource catalog 选择的 Piper ONNX voice 与配置 | 不进 Git；可删除后重下 |
| `data/models/voice/gpt-sovits/<voice-id>/` | Audio Engine | Audio resource catalog 选择的 GSV 声线、权重与参考音频 | 不进 Git；可由用户替换或迁移 |
| `data/packages/` | Engine / 本地安装器 | 本机托管的外部运行包，例如 GPT-SoVITS、未来本地 MCP server、whisper.cpp 包 | 不进 Git；可重新安装 |
| `data/packages/gpt-sovits/` | Audio Engine | GPT-SoVITS 上游项目、独立 `.venv`、`api_v2.py`、上游配置 | 不进 Git；可重装或升级 |
| `data/packages/ffmpeg/` | Audio Engine | FFmpeg shared build，供 GPT-SoVITS / torchcodec 在 Windows 上加载音频解码 DLL | 不进 Git；可重装或升级 |
| `data/packages/avatar-runtimes/<runtime-id>/` | Unity Avatar Shell | `avatar-runtimes.json` 声明的第三方模型 runtime；构建时投影到 Unity 忽略目录 | 不进 Git；受上游授权约束 |
| `data/packages/avatar-shell/windows/` | Kernel / Renderer | 当前代码暂存的 Unity Avatar Shell 构建产物；属于待迁移例外 | 不进 Git；后续迁移到 `out/dev/avatar-shell/` |
| `data/artifacts/` | Kernel / Engine / Renderer | 可再生运行生成物、临时媒体、TTS 输出、调试产物 | 可删除，可重建 |
| `data/cache/` | 各子系统 | 下载缓存、预处理缓存、索引缓存 | 可删除，可重建 |
| `data/backup/` | 迁移 / 用户 | 升级前快照、手动导出、安全备份 | 可归档到外部备份位置 |
| `data/legacy/` | 迁移工具 | 历史目录或旧数据库的只读迁移源 | 新代码不得写入 |

## 模型、上游包与运行产物的边界

`data/models/`、`data/packages/` 和 `data/artifacts/` 不能互相代替：

- `data/models/` 保存用户真正关心的模型权重、参考音频和可迁移资产。
- `data/packages/` 保存可以重装的外部运行包，例如 GPT-SoVITS 上游项目副本、独立虚拟环境和 FFmpeg shared 运行时。
- `data/artifacts/` 保存运行中生成、丢失也可以重建的输出和临时文件。

以 GPT-SoVITS 为例：

```text
data/models/voice/gpt-sovits/<voice-id>/ # catalog 声线权重和参考音频
data/packages/gpt-sovits/               # GPT-SoVITS 上游项目与 api_v2.py
data/packages/ffmpeg/                   # GPT-SoVITS sidecar 启动时注入 PATH 的 FFmpeg shared build
data/packages/avatar-runtimes/<runtime-id>/ # catalog 声明的本机 Avatar runtime
data/packages/avatar-shell/windows/     # 当前过渡路径；月见自身产物目标迁入 out/
data/artifacts/tts/                     # 月见生成的 TTS wav
```

这样客户端打包时可以保护模型与记忆连续性，同时允许上游包重新安装、升级或清理。

## 启动期资源准备

默认启用的本体能力不能把模型下载推迟到第一次用户请求：

- Cognition embedding 由 `CognitionManager.start()` 拉起的认知核在 IPC ready 前根据受校验配置完成本地检测、自动下载或明确降级。
- Piper / FunASR 由 Kernel `CapabilityRuntime` 通过 `AudioService.prepareRequiredAudioResources()` 准备；具体模型仓库、artifact 和相对落盘目录来自 Audio Engine resource catalog。GPT-SoVITS 只有显式启用时才使用对应模型与上游包。
- 下载进度、第三方库 warning 和模型库 banner 进入 `data/observability/logs/processes/`，主启动日志只保留资源门摘要。

## assets/ 与 data/ 的边界

`assets/` 是随代码发布的只读应用资产；`data/` 是本机可变数据域。两者不能互相代替：

- `assets/` 放默认图标、默认 Q 版形象、Live2D/Cubism 静态资源、内置声效、前端需要打包的 manifest。
- `data/` 放用户导入或启动期下载的模型、语音资产、上游包、缓存、运行产物、长期状态和观测日志。
- 模型权重默认不进入 `assets/`，除非它小到可以作为应用内置演示资产并随版本严格管理。
- 如果某个文件需要用户替换、下载、迁移或备份，优先进入 `data/`；如果它是应用版本的一部分，才进入 `assets/`。

## 打包映射

开发期：

```text
glimmer-cradle/data/
```

正式客户端：

```text
app.getPath("userData")/data/
```

安装目录只放只读资源与组件投影，完整结构见 [客户端安装形态](./客户端安装形态.md)。用户配置、模型、本地托管包和月见连续性数据进入用户数据目录，升级时不覆盖。

月见自身的 Kernel、Cognition、Engine、Composition Host 与 Unity Worker 构建结果不属于 `data/`。当前 `data/packages/avatar-shell/windows/` 是迁移期间的事实路径；目标构建流为 `out/` 中转、`dist/` 交付、安装时进入 `resources/components/avatar-shell/`。

## VSCode 可见性

`data/packages/`、`data/artifacts/` 与 `data/cache/` 默认不参与搜索、watcher 和 Python 分析，以免索引上游包与运行产物；但它们不应从文件树隐藏。开发者应该能看到本地结构，只是不把它当源码检索对象。

## 新增数据目录的规则

1. 先判断是否属于长期状态；是则进入 `data/state/`。
2. 判断是否是可观测记录；是则进入 `data/observability/`。
3. 判断是否是模型权重或用户资产；是则进入 `data/models/`。
4. 判断是否是可重装的外部运行包；是则进入 `data/packages/`。
5. 判断是否是可删除重建的运行生成物；是则进入 `data/artifacts/`。
6. 判断是否是纯缓存；是则进入 `data/cache/`。
7. 只有被多个模块引用的大块对象才进入 `data/blobs/`，并且必须有可追踪引用。
8. 新代码不得写入 `data/legacy/`。
9. 新增或移动 `data/` 子目录时，同步更新本文件、`data/README.md` 和 `architecture/current/00-架构总览.md`。
10. 如果内容是月见自身的可执行文件、库或安装器，不得新增到 `data/`；分别进入 `out/` 或 `dist/`。
