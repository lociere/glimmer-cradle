# Engines 与 Native 当前视图

> 范围：官方能力引擎、音频 TTS/ASR、资源 readiness、native 平台原语和性能热路径的当前边界；不写具体模型 API。
> 事实依据：`engines/audio/`、`native/`、Kernel audio capability、Avatar/Composition 约束、`data/models/`、`data/packages/` 与当前打包策略。
> 维护触发：官方 engine、模型资源、stdio/http 协议、warmup、native ABI、FFI、Composition Host 或资源 catalog 变化。

Engine 是 Glimmer Cradle 的官方能力器官，不是 Extension。它们可以独立进程、独立环境、独立资源 warmup，但 owner 仍是项目本体；Extension/MCP 是生态能力，不能替代官方器官的 readiness、观测和发布责任。

## 当前 Engine 分类

| Engine | 来源 | 主要能力 | 当前边界 |
|---|---|---|---|
| Audio Engine | `engines/audio/` | TTS、ASR、音频资源检测、模型 warmup | Kernel audio capability 管理，子进程日志进入 process log |
| Avatar/Composition native | `core/avatar/unity-host/` + `native/` | 复杂身体渲染、透明合成、DPI、命中 | Avatar/Native 边界管理，Kernel 只看协议状态 |
| 未来 Vision/Vector/Reasoning engine | `engines/` 预留 | 官方模型能力 | 必须按 Engine 契约纳入 readiness，不走 Extension 假装本体 |

## 官方 Engine 不变量

- 已启用能力的资源准备是该能力 readiness 的一部分；未启用的可选能力不创建资源准备义务。
- 缺模型、缺依赖、下载失败、license 不满足、warmup 超时要显式 degraded/failed。
- Kernel 当前会把 `native.host` 暴露到统一 `RuntimeReadinessCatalog`：`data/packages/native/` 包目录和当前平台 Composition 动态库属于正式 resource readiness，而不是仅在日志里可见。
- 主日志只记录摘要和路径；完整 stdout/stderr 进入 `data/observability/logs/application/`。
- Engine 协议是受控边界；不能让 Engine 回调 UI 或直接写 Cognition 私有状态。
- Engine 产物和模型在 `data/models/`、`data/packages/`、`data/cache/`、`data/work/` 分域保存，不进入源码事实源。

## Audio 当前语义

| Lane | 输入 | 输出 | 失败语义 |
|---|---|---|---|
| ASR | 录音文件、上传音频、音频配置 | 转写文本、置信/诊断状态 | 只影响语音输入，不伪造 Cognition 失败 |
| TTS | 文本、voice/profile、trace | 音频文件或播放指令 | 只影响语音表达，不改变 reply 事实 |
| Resource | catalog、模型路径、依赖 | ready/degraded/failed snapshot | 不用“文件存在”代替模型可用 |

语音转写成功后才进入普通文本感知链路；TTS 合成失败不能删除文本回复，只能让声音表达 degraded。

TTS 与 ASR 默认不启用；文本对话是完整的最小运行形态。显式启用 TTS 后，当前可选 provider 为 `dashscope-cosyvoice`，没有本地兜底。角色 `voice.yaml` 拥有稳定声线绑定，系统 `audio.yaml` 拥有路由、超时、熔断和缓存；密钥只来自环境变量或 secrets。云端不可用时仅 TTS 明确 unavailable，文本回复继续成立。未来微调 provider 可成为 primary，并把 CosyVoice 配为 fallback；路由和 provider 生命周期仍归 Audio Engine。显式启用 ASR 后，当前正式 provider 为 FunASR。

## Native 当前语义

Native 的职责是提供平台原语，不拥有产品事实。典型场景：

- Avatar 的 per-pixel alpha 和透明命中；
- Windows DPI、多显示器、drag/resize、surface attach；
- 经独立设计和真实消费者验证后的未来性能热路径。

当前 Native ABI 只承载 Avatar Composition。音频能力统一归 `engines/audio/`；主线不保留不可达的 Native ASR/TTS provider、假推理 ABI 或固定结果 stub。

Native 组件必须有 ABI/版本/平台检查、加载失败诊断和可恢复状态。禁止让业务代码按开发机路径直接加载 DLL/so/dylib。

实现入口见 [Engines 与 Native 实现](../../implementation/Engines与Native实现.md)，操作见 [音频引擎开发](../../../guides/subsystems/音频引擎开发.md) 与 [客户端打包](../../../guides/release/客户端打包.md)。
