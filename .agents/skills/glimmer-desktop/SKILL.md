---
name: glimmer-desktop
description: Change or debug Glimmer Cradle Electron main/preload, Presence windows, Native composition, Avatar rendering and audio devices.
---

# 桌面、展示与设备

从 [Desktop/Avatar 实现](../../../docs/architecture/implementation/Desktop与Avatar实现.md)、[设备/Native 实现](../../../docs/architecture/implementation/Engines与Native实现.md)
和受影响源码定位进程、窗口、资源 owner。当前 `products/desktop`、`core/avatar`、`hosts/unity-avatar-host`、`engines/audio` 与
目标 `apps/desktop`、Embodiment、Renderer/Speech Extension 的状态分开核验；不机械搬目录。

按本次边界加载：普通 Renderer UI 用 [glimmer-ui](../glimmer-ui/SKILL.md)；Unity/Live2D/身体表达用 [Avatar 方法](references/avatar.md)；
ASR/TTS/麦克风/播放用 [音频方法](references/audio.md)。只改变其中一个边界时不展开所有设备资料。

## Electron 与 Native

- main 拥有窗口和本机权限，preload 暴露白名单，Renderer 提交受控 intent。
  IPC 校验 sender/main-frame、来源与参数，返回最小 projection；不关闭 context isolation/sandbox 来绕过问题。
- 区分 Control Center 的长期控制任务、Presence 的轻量常驻交互与 Avatar 身体展示；不同 Surface 不复制领域状态 writer。
  全局音频 owner、托盘/窗口关闭、应用退出和 Host 停止各有语义，避免一个窗口关闭意外杀掉共享 owner。
- 追踪窗口、WebContents、IPC handler、订阅、timer、媒体流、native handle 与受管进程树的创建/释放。
  crash/reload/退出后旧 sender 和异步回调失效。PID/root exit 或 kill 请求返回不证明后代已释放；依赖实际监督反馈。
- 透明合成、命中、拖动、DPI、多显示器、置顶和焦点由平台 adapter 负责；不要用颜色键/临时窗口形状冒充正式合成。
  平台能力缺失如实标注支持/降级，不伪造跨平台等价。
- 路径从 resolver/catalog 取得。安装目录只读；native/Python/模型/资产的构建投影、安装态与运行数据分开，
  不因开发机可找到 Unity 或源码资产就判打包可用。

## 验证与完成

先以实际 main/preload/监督入口的定向测试证明白名单、失败、取消、迟到与 teardown。
窗口、透明、DPI、多屏、拖动、录音/播放、Unity/Native 变化需要对应实机/设备和必要安装态检查。
查 [桌面指南](../../../docs/how-to/桌面与Avatar开发.md)、[客户端打包](../../../docs/how-to/客户端打包.md)
及对应 package scripts 选择命令；不要把浏览器 fixture、源码结构测试或 dummy native 当实机证据。

缺 Unity、GPU、设备、构建环境或授权时完成可做的隔离测试，保留对应门和具体所需条件。
结果区分逻辑测试、进程接线、实机和固定制品；报告观察到的 ready/degraded、资源释放与尚未验证平台。
高风险候选和证据复用遵循 [共享验证方法](../../../docs/how-to/测试与验收.md)。
