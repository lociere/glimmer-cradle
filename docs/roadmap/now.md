# Now

> 审阅日期：2026-07-13
> 范围：当前唯一活跃推进面、下一验收门和近期不做事项；不记录已完成架构事实。
> 维护触发：当前里程碑、验收门、风险、范围或审阅日期变化。

当前暂不进入 [M10：发布形态、安装投影与数据迁移闭环](./milestones/M10-发布形态、安装投影与数据迁移闭环.md)。人物自主使用 Skill 的 Cognition ActionPlan、Kernel Skill Plane 执行、结果回注与综合回复链路已经落地；当前唯一活跃推进面改为 **Official Audio 闭环**。

## 当前推进：Official Audio

Audio 架构已经收口为独立双 lane Engine：CosyVoice 3.5 Flash 是当前云端 TTS 基线，FunASR 是唯一 ASR provider；当前不保留本地 TTS fallback。角色声音身份、系统路由、密钥、Engine 执行和 Desktop 播放各有单一 owner；旧 experimental provider、Piper、GSV sidecar、Edge/SAPI/Whisper 与 Kernel provider 队列已删除。当前验收重点转为真实账号、真实声线和真实录音 smoke test，不再继续调整边界。

| 成果 | 当前关注 | 验收证据 |
|---|---|---|
| 云端 TTS 实机验收 | 创建 Selrena 正式 voice id，验证持久连接、连续短句、错误 key、超时与熔断 | 真实音频、route_state、provider_id、耗时和 process log |
| TTS 失效隔离 | 验证断网/熔断后 TTS 明确 unavailable，文本回复和 Cognition 连续性不受影响 | unavailable 投影、文本回复、恢复窗口 |
| ASR 实机验收 | FunASR 真实录音、空音频、坏文件、缺模型和超时 | transcript、输入状态和 process log |
| 交互延迟基线 | 记录短句合成与播放器开口耗时，作为未来 PCM media plane 的比较基线 | 冷/热连接、合成耗时、播放开始时间 |

## 随后推进

1. **Desktop 配置投影**：Electron main 当前仍直接解析和改写多份 YAML。应由 Kernel Config Application Port 提供校验后的 `ConfigSnapshot` 与显式 update command，Control Center 只发送用户 intent；完成后删除 Desktop 的第二套 YAML normalizer。
2. **商业级 Control Center**：基于 Kernel 投影统一空态、加载、保存、重启提示、错误恢复、Memory/Experience 可见性和 Avatar ready 状态，再做完整桌面与移动宽度视觉验收。
3. **Avatar 体验收尾**：验证 Unity 首帧无左上角窗口闪现、任务栏图标不短暂出现、外观与动作设置持久化、Presence 与 Unity 状态不互相误报。
4. **M10 发布闭环**：完成安装目录、用户数据域、组件域、缓存域、日志域、迁移与包内容检查后再进入实际发布。

## 近期不做

- 不新增真流式回复、本地模型工作台或新平台大集成。
- 不把 Audio、Avatar、Cognition 或 Kernel 生命周期伪装为 Extension。
- 不在 Desktop、打包脚本或 provider 包装中增加角色 fallback、旧目录 fallback 或永久兼容壳。
- 不让 Renderer 读取原始配置、日志全文、secret 或内部 service。
- 不把用户数据、日志、缓存、模型或私人资产写入安装目录。

## 第一验收门

- 配置本机 `DASHSCOPE_API_KEY` 与 Selrena CosyVoice `voice_id`。
- 用真实 TTS/ASR 样本跑通 warmup、连续调用、超时、失效隔离、缺资源和停机回收。
- 保存 Control Center 声线 ID，重启后确认配置、route state 与播放队列一致。

未承诺候选事项见 [backlog.md](./backlog.md)。
