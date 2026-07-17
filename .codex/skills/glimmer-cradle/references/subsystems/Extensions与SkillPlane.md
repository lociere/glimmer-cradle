# Extensions 与 Skill Plane

适用任务：Extension SDK、manifest、Host Port、权限、contribution、Skill/Tool、MCP Server、User Skill、Policy 和 Invocation。

## 判断

Extension 是可安装、可禁用、可授权、可回收的生态能力，不是官方本体器官。Skill Plane 统一 Core、Extension、MCP、User Provider 的 catalog、policy、调用和审计。

## 实施顺序

1. 定义 manifest：`id`、`activationEvents`、`requires`、`permissions`、`contributes`。
2. 只使用公开 SDK 和 Host Port。
3. 静态 `contributes.skills` 进入 catalog；无 handler 时为 `contract_only`。
4. 调用必须经过 Policy 和 Invocation Gateway。
5. 所有连接、订阅、计时器、handler 注册进入 disposable。
6. MCP 断连、超时、枚举失败必须撤销 catalog 或标记 degraded。

## 禁止项

Extension import Kernel 内部对象；handler 绕过权限；需要确认但确认通道未接入时直接执行；平台 payload 原样进 Cognition；停用后旧 handler 仍可调用。

验证注册、禁用、拒权、确认缺失、调用、失败、重连、撤销、dispose、trace 和日志脱敏。

## 常见入口

SDK 看 `packages/extension-sdk/src/`；基础模板看 `templates/extension-basic/`；官方扩展源码看独立 `glimmer-cradle-extensions/extensions/<extension-id>/` 仓库；安装态看 `data/packages/extensions/<extension-id>/<version>/`；Kernel Skill Plane 看 `core/kernel/src/application/skill-plane/`；MCP 配置看 `configs/system/skills.yaml`。

## 交付检查

manifest 与运行时 handler 是否一致；`contract_only` 是否不可执行；policy 是否处理风险和确认；停用是否撤销 catalog；MCP 失败是否不留下假能力；文档是否同步 Extension SDK Reference 和扩展开发指南。

## 安全边界

外部 MCP 和平台扩展都按不可信输入处理。工具结果需要规范化，副作用需要 policy，敏感能力需要权限和审计。配置里不放 token；远端错误不把密钥或完整响应写进日志。

## 何时不是 Extension

官方音频引擎、Avatar、Cognition、Kernel lifecycle、Native Composition Host 都是本体能力，不应为了“统一”塞进 Extension。Extension 是生态接入点，不是核心器官容器。
