# Engines 与 Native 实现

> 范围：官方 Engine、Audio 云端/本地路线、模型 warmup、Kernel capability 接线、process log、native 平台原语和发布投影。
> 源码依据：`engines/audio/src/glimmer_cradle/audio/`、Kernel audio capability、Audio Contract Spine、`data/models/`、`data/work/audio/media-leases/`、`native/` 与 Avatar Composition。

## Audio 物理入口

| 入口 | 职责 |
|---|---|
| `contracts/proto/glimmer/engine/audio/v1/audio_engine.proto` | Kernel/Audio Engine gRPC Service 与媒体引用单一事实源 |
| `contracts/json-schema/config/v1/audio-config.schema.json` | 系统 Audio 路由与执行策略 Document |
| `contracts/json-schema/config/v1/voice-config.schema.json` | Character Package 声音身份 Document |
| `engines/audio/src/glimmer_cradle/audio/main.py` / `grpc_host.py` | TTS/ASR lane 入口、动态回环 gRPC Host、认证与媒体租约校验 |
| `engines/audio/src/glimmer_cradle/audio/tts/route.py` | TTS 顺序路由、fallback、熔断和原子输出 |
| `engines/audio/src/glimmer_cradle/audio/tts/dashscope_cosyvoice.py` | CosyVoice 持久 WebSocket adapter |
| `engines/audio/src/glimmer_cradle/audio/asr/funasr_engine.py` | FunASR ASR provider |
| Kernel `audio-service.ts` | 能力门、缓存、状态与 readiness 投影 |
| Kernel `official-audio-engine.ts` | 双 lane 子进程监督、动态端点 gRPC client 与媒体租约 owner |

当前 Audio Engine 由主仓发布和 Kernel Audio adapter 管理，不通过 Extension 安装。
这是当前归属；目标 v2.1 的 Speech/Provider 边界见基线与原迁移任务，不能从第三方来源或旧 Engine 名称推导永久归属。Kernel 不维护 provider 数组，不循环尝试 provider，也不理解具体 TTS/ASR provider 的内部参数。

TTS 与 ASR lane 绑定 `127.0.0.1:0`，用一次性 stdout 启动帧向直接父进程报告动态端点；主请求/响应只走二进制 `AudioEngineService`，stdout/stderr 此后只承载日志。Kernel 为每个进程注入随机 `x-glimmer-audio-token`，令牌不进入配置、catalog 或日志。两条 lane 均通过 `Shutdown` RPC 完成协议级停机：Engine 先 ACK、关闭 provider 资源并以 `0` 退出，Kernel 等待 2.5 秒后才升级为进程树强制回收。停机控制请求使用独立短超时，不继承业务长超时。

大型音频不进入普通 RPC。Kernel 在 `data/work/audio/media-leases/<lane>/<lease-id>/` 为 ASR 输入创建 `READ_ONLY` 副本，为 TTS 输出创建 `WRITE_ONCE` 目标；`AudioMediaReference` 固定 file URI、MIME、长度、SHA-256、访问模式和过期时间。Engine 只能解析注入的 lane root，拒绝越界、过期、摘要不符或重复写入；Kernel 验证 TTS 回执后才把产物移入最终缓存/目标路径，并在成功、错误、超时、正常停机与崩溃后回收租约根。

## 配置与输入输出语义

`configs/system/audio.yaml` 当前 TTS/ASR 都 `enabled: false`；TTS primary 为 `dashscope-cosyvoice`、fallbacks 为空，
ASR 为 `funasr`。角色 `configs/characters/<id>/voice.yaml` 拥有声线身份，系统配置拥有路由/超时/缓存/熔断，秘密来自环境或 secrets。
默认 Selrena `voice_id` 为空，不能据配置/目录声称 TTS 可用；启用还需有效身份、依赖、模型/供应商与真实 warmup。
ASR 成功后才进入文本感知，失败不伪造文本；TTS 失败不抹掉已成立的文本回复。关闭的 lane 不产生预热义务。

## TTS 链路

```text
Cognition reply
  -> ControlSurfaceGateway 按语义标点分段
  -> AudioService 缓存键(text + route + provider config + voice profile)
  -> WRITE_ONCE media lease + Audio Engine TTS lane gRPC
  -> TTSRoute(primary, fallbacks)
  -> DashScopeCosyVoiceEngine
  -> 原子 WAV 文件
  -> audio_play projection
  -> Renderer 按 trace 排队播放
  -> audio envelope -> Avatar 口型
```

CosyVoice adapter 在进程内复用 WebSocket，严格执行 `run-task -> task-started -> continue-task -> finish-task -> task-finished`，二进制帧聚合后在 provider 边界回填 RIFF 和 data chunk 真实长度，再交给 `TTSRoute` 原子落盘。单次调用只在 adapter 内执行有界退避重试；跨 provider fallback 和熔断由 `TTSRoute` 统一处理。当前路线只有 CosyVoice；未来微调 provider 接入后可复用现有顺序路由。Kernel 只复用已定稿的 WAV 缓存；流式占位头或过期产物会被删除并重新生成。fallback 产物不写入主路线的稳定缓存，避免主 provider 恢复后继续复用替代声线。每个语义分段使用由 `trace_id + sequence` 派生的稳定 `audio_id`，Electron main 对同一 `audio_id` 只向唯一音频 owner Surface 投递一次，并只下发 `audio_uri` 媒体引用，不在普通 control frame 内联 `audio_data`。新 reply 到来时 Kernel 不再继续生成旧 reply 的后续分段，Renderer 清空旧 trace 的播放队列。

当前播放边界仍是语义短句级 WAV，而不是把二进制音频块直接暴露给 Renderer。这样保留稳定的缓存、回放和 Avatar 包络边界；未来若引入 PCM media plane，必须以独立流协议和播放器缓冲状态替换，不能把 base64 chunk 塞进现有单响应帧。

## ASR 链路

```text
Desktop recorder -> data/work/audio/asr/*.wav
  -> AudioService -> READ_ONLY media lease -> Audio Engine ASR lane gRPC
  -> FunASR -> transcript projection
  -> PerceptionAppService -> Cognition
```

FunASR 模型和依赖在 warmup 阶段准备。识别失败只更新语音输入状态，不生成伪文本。

## 状态与韧性

`audio_status` 同时表达路线与节点：

- 路线：`disabled | ready | degraded | unavailable | unknown`；
- provider：稳定 `provider_id`、`primary/fallback`、`cloud/local` 和 `ready/degraded/unavailable/circuit_open/unknown`；
- `active_provider` 始终表示实际承载请求的 provider，不表示配置首选。

`audio.host` 聚合 `audio.tts` 与 `audio.asr`；lane reconciler 再投影 provider 资源。配置明确关闭的 lane 视为满足其 disabled desired state，不拖累 Audio 聚合状态。

TTS 与 ASR 独立预热、独立收敛：任一 lane 完成 warmup、业务成功或发生故障时，`AudioService` 都立即更新该 lane 的缓存与 readiness，并由 `AudioRuntime` 的状态订阅统一投影到 Runtime Catalog 和 `audio_status`。较慢的本地 ASR 不得阻塞已就绪的云端 TTS 状态，Renderer 也不通过轮询或业务成功结果猜测 provider 健康。

## Native 实现边界

Native 当前只服务 Avatar Composition：平台窗口/surface、per-pixel alpha、透明命中、DPI、多显示器和 ABI 检查。音频不保留 Native 假 ABI、不可达 provider 或固定结果 stub。
Windows composition 有实际实现，其他平台的 stub/加载诊断不能当作透明合成等价支持。
ABI/版本/平台与 DLL 位置由正式构建投影和 resolver 核对，不能从开发机绝对路径加载。
`native.host` 的 package/动态库资源 readiness 与具体 Avatar 首帧是不同门，后者见 [Desktop/Avatar](Desktop与Avatar实现.md#avatar-readiness-实现点)。

## 验证

```powershell
cd engines/audio
uv run --extra dev pytest -q
cd ../..
pnpm contracts:verify
pnpm typecheck
pnpm build
```

真实云端 smoke test 需要本机 `DASHSCOPE_API_KEY` 和角色 voice id；测试输出与密钥不得提交。

完整 Personal Server 组合可在根目录运行 `pnpm smoke:personal-server`，同时验证 LLM 回复、TTS 投影、逐 lane Audio 状态、协议停机和产品进程树回收。
