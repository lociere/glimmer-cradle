# Engines 与 Native 实现

> 范围：官方 Engine、Audio 云端/本地路线、模型 warmup、Kernel capability 接线、process log、native 平台原语和发布投影。
> 源码依据：`engines/audio/src/glimmer_cradle/audio/`、Kernel audio capability、Protocol Engine Schema、`data/models/`、`native/` 与 Avatar Composition。

## Audio 物理入口

| 入口 | 职责 |
|---|---|
| `protocol/src/schemas/engine/AudioEngine*.schema.json` | Kernel/Audio Engine stdio 帧单一事实源 |
| `protocol/src/schemas/config/AudioConfig.schema.json` | 系统 Audio 路由与执行策略 |
| `protocol/src/schemas/config/VoiceConfig.schema.json` | Character Package 声音身份 |
| `engines/audio/src/glimmer_cradle/audio/main.py` | TTS/ASR lane 命令入口 |
| `engines/audio/src/glimmer_cradle/audio/tts/route.py` | TTS 顺序路由、fallback、熔断和原子输出 |
| `engines/audio/src/glimmer_cradle/audio/tts/dashscope_cosyvoice.py` | CosyVoice 持久 WebSocket adapter |
| `engines/audio/src/glimmer_cradle/audio/asr/funasr_engine.py` | FunASR ASR provider |
| Kernel `audio-service.ts` | 能力门、缓存、状态与 readiness 投影 |
| Kernel `official-audio-engine.ts` | 双 lane 子进程监督和协议 adapter |

Audio Engine 是摇篮本体能力，不通过 Extension 安装。Kernel 不维护 provider 数组，不循环尝试 provider，也不理解具体 TTS/ASR provider 的内部参数。

TTS 与 ASR lane 均通过 stdio `host.shutdown` 完成协议级停机：Engine 先返回 ACK、关闭 provider 资源并以 `0` 退出，Kernel 等待 2.5 秒后才升级为进程树强制回收。停机控制请求使用独立的短超时，不继承 ASR/TTS 业务请求的长超时；模型仍在 warmup 时也不能让全局停机等待数分钟。正常停机不得记录成 Engine 崩溃；超时、协议损坏和非零退出仍保留为 lifecycle warning。

## TTS 链路

```text
Cognition reply
  -> ControlSurfaceGateway 按语义标点分段
  -> AudioService 缓存键(text + route + provider config + voice profile)
  -> Audio Engine TTS lane
  -> TTSRoute(primary, fallbacks)
  -> DashScopeCosyVoiceEngine
  -> 原子 WAV 文件
  -> audio_play projection
  -> Renderer 按 trace 排队播放
  -> audio envelope -> Avatar 口型
```

CosyVoice adapter 在进程内复用 WebSocket，严格执行 `run-task -> task-started -> continue-task -> finish-task -> task-finished`，二进制帧聚合后在 provider 边界回填 RIFF 和 data chunk 真实长度，再交给 `TTSRoute` 原子落盘。单次调用只在 adapter 内执行有界退避重试；跨 provider fallback 和熔断由 `TTSRoute` 统一处理。当前路线只有 CosyVoice；未来微调 provider 接入后可复用现有顺序路由。Kernel 只复用已定稿的 WAV 缓存；流式占位头或过期产物会被删除并重新生成。fallback 产物不写入主路线的稳定缓存，避免主 provider 恢复后继续复用替代声线。每个语义分段使用由 `trace_id + sequence` 派生的稳定 `audio_id`，Electron main 对同一 `audio_id` 只向唯一音频 owner Surface 投递一次。新 reply 到来时 Kernel 不再继续生成旧 reply 的后续分段，Renderer 清空旧 trace 的播放队列。

当前播放边界仍是语义短句级 WAV，而不是把二进制音频块直接暴露给 Renderer。这样保留稳定的缓存、回放和 Avatar 包络边界；未来若引入 PCM media plane，必须以独立流协议和播放器缓冲状态替换，不能把 base64 chunk 塞进现有单响应帧。

## ASR 链路

```text
Desktop recorder -> data/work/audio/asr/*.wav
  -> AudioService -> Audio Engine ASR lane
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

## 验证

```powershell
cd engines/audio
uv run --extra dev pytest -q
cd ../..
pnpm typecheck
pnpm build
```

真实云端 smoke test 需要本机 `DASHSCOPE_API_KEY` 和角色 voice id；测试输出与密钥不得提交。

完整 Personal Server 组合可在根目录运行 `pnpm smoke:personal-server`，同时验证 LLM 回复、TTS 投影、逐 lane Audio 状态、协议停机和产品进程树回收。
