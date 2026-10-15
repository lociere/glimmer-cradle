# 音频与语音链路

适用：ASR/TTS、麦克风/播放、媒体流、模型 warmup、音频设备与语音能力扩展。
权威入口见 [音频开发](../../../../docs/how-to/音频引擎开发.md)、[设备实现](../../../../docs/architecture/implementation/Engines与Native实现.md)、
Audio Service IDL、voice/audio Schema 和实际 recorder/player/Worker。不要将当前 Engine 承载写成永久目标。

## 实施判断

分别追踪采集→媒体引用→ASR→Conversation→Cognition→TTS→投递→播放器→已听回执→口型。
模型生成、文件完成、已发送、已播放和用户已听不是同一事实；中断记录实际边界，旧 generation 不恢复播放。
实时/分段/WAV/PCM 的当前支持从代码核对，不把目标 realtime 端口当已支持全双工产品。

格式校验包括采样率、声道、编码、帧顺序/长度/时间和 backpressure；内存/队列有界。
大媒体使用受控 AssetRef/lease，不内联进普通 JSON/gRPC 控制帧；校验权限、摘要、过期和单次写入。
临时文件、麦克风轨、AudioContext、缓冲、provider 连接和进程在成功/取消/失败/崩溃后均有 owner。

区分 provider 注册、依赖准备、模型 warmup、设备可用、首个合成/识别成功。
TTS/ASR 独立 readiness；关闭的 lane 按 desired state 判断，不拖累已可用能力。
声音身份从角色 profile 消费，重试/fallback 不可悄悄改变身份；缓存键和 fallback 缓存政策按实际 voice/config 语义核验。

## 验证

先用合成/录音 fixture 验证格式、拒权、过期 lease、取消、清理和回执。Python 用对应 owner 的 uv 环境，
避免为了普通测试安装 torch、下载大型模型或调用付费云服务。
真实 ASR/TTS、录音权限、设备缺失/切换、播放中断、延迟/抖动、口型同步与安装态需对应硬件/模型证据。
分别报告替身与真实输入输出，缺少设备、模型或服务授权时明确未验门；不记录私人音频/prompt/secret 到日志。
