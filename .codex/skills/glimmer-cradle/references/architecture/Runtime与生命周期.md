# Runtime 与生命周期

适用任务：Kernel、子进程、Engine、Avatar、Cognition、Extension、MCP、readiness、Ingress Gate 或停机回收。

## 必须定义

每个 runtime/module 必须有：唯一 ID、owner、依赖、blocking/degradable、start、真实 ready 条件、degraded 条件、failed 条件、timeout、restart 策略、stop 顺序、日志位置和状态投影。

## 判断

进程存在、端口监听、socket connected、协议握手、资源 prepared、首帧 present、业务 ready 是不同阶段。不得把前一阶段当后一阶段。UI 可以先显示等待态，但 Ingress Gate 只能在 required SDK 真实可服务或明确 degraded 后开放。

## 实施顺序

1. 先改 lifecycle/配置/Port，再接 producer/consumer。
2. 启动时记录阶段和 trace。
3. stop 时先协议级 shutdown，再超时回收进程树。
4. restart 后重新握手、ready、catalog，不复用旧 handler。
5. 降级能力必须投影到 runtime snapshot、日志和 UI。

## 验证

正常启动、缺依赖、缺资源、连接超时、崩溃、重启、主动退出、反向停机、重复启动、订阅释放、端口释放、process log 和 DLQ。不能只验证 `start()` 返回。

## 常见 runtime

Cognition、Audio TTS lane、Audio ASR lane、Avatar、Desktop Surface、Extension Host、MCP Server Provider 都是 runtime 视角下的能力对象。它们可以有不同进程形态，但都必须能解释 readiness、degraded 和 stop。

## 文档同步

新增 runtime 更新 Current 拓扑、Kernel/Implementation、Configuration 或 Packaging；新增日志和状态字段更新 Observability；新增操作步骤更新对应 Guide。

## 失败语义

required SDK 失败通常阻止 Ingress；optional runtime 失败进入 degraded；可重试 runtime 需要退避和状态更新；不可恢复失败要明确需要用户动作。任何失败都不能只吞掉并保持 ready。

## 何时降级

可选 provider、可选 extension、非默认模型、辅助诊断能力通常可以 degraded；Cognition 主循环、required transport、必要配置和用户状态损坏通常不能无声降级。降级必须说明用户影响和恢复动作。
