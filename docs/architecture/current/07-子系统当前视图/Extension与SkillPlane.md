# Extension 与 Skill Plane 当前视图

> 范围：Extension SDK、Extension Host、Core/Extension/MCP/User Skill Provider、catalog、Policy、Gateway、权限和审计的当前边界；不写 SDK API 全表。
> 事实依据：`packages/extension-sdk/`、`templates/extension-basic/`、独立扩展仓库、`data/packages/extensions/<extension-id>/<version>/`、`core/kernel/src/application/skill-plane/`、`configs/system/skills.yaml`、`configs/extensions/` 与当前 Skill Plane 实现。
> 维护触发：Extension manifest、requires/permissions、activation、provider 生命周期、MCP 接入、policy、confirmation、invocation、catalog 或公开 SDK 变化。

Extension 是生态边界，Skill Plane 是能力运行平面。当前角色可以通过它接入平台、工具、MCP 和用户能力，但这些能力不成为本体器官，也不能绕过 Kernel 的授权和审计。

跨进程、跨仓库且可序列化、可版本化的 Extension Manifest、Host 消息、包、Release 与 Registry 契约只归 Protocol。Kernel 依赖 Protocol 并拥有安装安全、权限、生命周期、进程监督和内部 Port；Extension SDK 依赖 Protocol，只提供扩展作者 API。Kernel、Products 与 Protocol 不依赖 Extension SDK，产品发行物只在 Extension Host 执行环境中携带 SDK module root。

## 当前能力来源

| 能力来源类型 | 来源 | 语义 | 失败处理 |
|---|---|---|---|
| Core Skill Provider | Kernel 内置能力 | 剪贴板、桌面、通知、屏幕上下文、确认等官方基础能力 | required 能力失败需显式 degraded |
| Extension Skill Provider | Extension Host + SDK | 扩展贡献的 skill/tool/resource/prompt | 扩展停用或失败时撤销 catalog |
| MCP Server Provider | `configs/system/skills.yaml` | 外部 MCP server 暴露的 tools/resources/prompts | initialize、枚举、调用失败都要可诊断 |
| User Skill Provider | 用户配置/脚本 | 本地用户自定义能力 | 默认保守授权，失败不污染本体 |

`provider` 是 Skill Plane 内部对“能力目录来源”的统一技术抽象，不等同外部服务。`provider.kind=core` 由 Kernel 拥有，属于摇篮本体能力；Extension、MCP 和 User 才是可插拔来源。普通产品界面统一称“能力来源”，不显示 `kernel-builtin-skills` 等技术 ID；技术字段只用于协议、日志、审计和高级诊断。Cognition 不作为 Skill Provider，它只消费经过 audience、Policy 与 Gateway 约束后的角色能力投影。

## Extension 当前边界

| 概念 | 当前语义 |
|---|---|
| manifest | 声明扩展身份、入口、贡献点、权限、requires、activationEvents |
| requires | 扩展需要的 Port 或宿主能力，不等同授权 |
| permissions | 可执行副作用或敏感能力的声明 |
| activation | 扩展何时加载和何时释放 |
| Port | Kernel 暴露给 Extension 的公开能力接口 |
| disposable | Extension 停用、失败或升级时必须释放的资源 |

Extension 只能通过 SDK 和公开 Port 与 Kernel 协作。禁止 import `core/kernel/src/**`，禁止拿内部 service 实例，禁止把平台 payload 原样传入 Cognition。

`contributes` 当前按 contribution point id 分组，官方内建能力也通过 `glimmer.*` contribution point definition 进入 registry。`glimmer.command`、`glimmer.setting`、`glimmer.skill`、`glimmer.capability`、`glimmer.managedResource`、`glimmer.protocolBridge`、`glimmer.managementSurface` 等只是预注册 definition，不是平台固定能力边界。未知 contribution point 会被索引和投影为 `unsupported`，但不会执行、不会进入 Cognition、不会获得权限。

Host 以 Capability Graph 表达扩展运行事实。扩展一旦被扫描发现，就先以 `ExtensionRuntimeProjection(lifecycle=discovered)` 暴露身份、版本、description、permissions、tags、contribution point definitions 和声明图；后续再由 load/start/stop/fail 更新 lifecycle 与节点 readiness。图节点承载 contribution point、owner、audience、权限、ready/degraded/failed、readiness gate、metadata 和诊断引用；边表达依赖；action intent 表达 audience、可执行入口和 enablement。Renderer 只消费 `ExtensionRuntimeProjection`，不能读取 manifest 固定字段、扩展 DB、日志或本地端点来推断状态。

`audience` 是能力平面的隔离字段：`character` 才能进入人物 Skill catalog；`user` 给 Control Center 或管理 UI；`host` 给 Host lifecycle/readiness/supervision；`adapter` 给平台 ingress/output 或协议桥；`renderer` 只做展示投影；`extension` 只服务扩展内部。`glimmer.command`、`glimmer.managementSurface`、`glimmer.managedResource`、`glimmer.protocolBridge` 和普通 `glimmer.capability` 默认不得进入人物可用 catalog；未显式 `character` 的扩展运行期 sub-agent 也不会被注册为人物 Skill。

`scope` 与 `requirements` 是另外两道正交边界。`scope.kind` 可以是 `global`、`source_provider`、`scene` 或 `conversation`；扩展声明中的 `$self` 会在注册时解析为自己的 Extension ID。`requirements` 约束 `desktop` / `personal-server`、Windows/Linux/macOS 和 `avatar`、`audio.tts`、`audio.asr`、`local_device_actions`、`extensions` 等产品功能。Catalog 投影、规划和 Invocation Gateway 都按当前 `ConversationContext` 与 Product Composition 过滤，不能用伪造调用跨来源、跨场景或跨会话执行。

认知接入只有两条公开主线：`perception` 提交带 `ConversationAddress` 的清洗后感知；`evidenceProposal` 由 `EVIDENCE_PROPOSAL_WRITE` 授权，提交同样带地址、`sourceEventId` 与 `schemaRef` 的证据候选。Kernel `ConversationDirectory` 把外部地址解析为 canonical ConversationContext 与不可逆 actor id；Extension 不能提交 canonical id、不能直接读写 Cognition Conversation/Memory，也没有平行会话事实 Host Port。

## Skill Plane 调用链

```text
catalog source
  -> SkillRegistry
  -> Planner context / tool intent
  -> SkillPolicyEngine
  -> confirmation / denial / allow
  -> SkillInvocationGateway
  -> provider handler
  -> normalized result
  -> audit + trace
```

Core Skill Provider 当前将已接入 Desktop bridge handler 的 `desktop.open_url`、`notification.show`、`clipboard.read` 和 `clipboard.write` 标记为 ready；仍未接 handler 的能力继续是 `contract_only`。`contract_only` 能力不可执行。需要确认但确认通道未接入时必须拒绝，而不是绕过。工具结果进入 Cognition 前必须成为不可信输入处理，不能直接写事实源。

`SkillInvocationGateway` 是当前唯一运行时执行入口。调用方必须携带当前 `ConversationContext`，并可显式传入 `traceId`；否则 trace 沿用当前 Kernel 上下文或新建。Gateway 对每次已定位到 skill/tool/resource/prompt 的调用重新校验 audience、scope、requirements 与 Policy，并记录 provider、skill、target、policy decision、trace、耗时、结果类型或错误摘要。`policy.audit = false` 只会关闭成功路径的详细审计；策略拒绝和 handler 失败仍会记录，避免高风险或异常调用从时间线中消失。

`SkillRegistry` 的人物 catalog 只包含 character audience 的 skill/tool/resource/prompt；character skill 下显式标为 `user`、`host`、`adapter`、`renderer` 或 `extension` 的子项也会被过滤。`SkillPlanningAppService` 当前只把 character audience 且 ready 的 tools 投影给 Cognition 的 `agent_plan` RPC，并过滤掉目录外建议；执行建议仍走 `SkillInvocationGateway`。普通聊天主循环已通过 `ActionCommand.action_type=skill_request` 接入 Skill Plane：Cognition 的结构化 ActionPlan 判断当前目标需要能力后只发行动意图，Kernel `SkillActionController` 负责 catalog 投影、规划、Policy/Gateway 调用、结果归一化、`agent_synthesis` 回注和最终回复投递。Renderer、Extension 和 Cognition 都不能绕过 Gateway。

`SkillCatalogSnapshot.providerRuntimes` 是当前统一 provider 运行态投影。MCP provider 会显式上报连接状态；Extension provider 则由 `ExtensionHostAppService` 把 `ExtensionRuntimeProjection` 的 lifecycle、Capability Graph 与 diagnostics 映射进同一快照。因此没有人物 skill 的管理型扩展也会作为 `provider.kind=extension` 出现在能力目录中，而不是只能在扩展管理页单独查看。

Personal Server 仍装配 Core、Extension、MCP 与 User Skill Provider。它只排除 `local_device_actions`、Avatar、本地 ASR 等未包含功能；满足 `products=personal-server`、Linux 平台与当前功能集合的全局 Skill，以及匹配某个 Extension/Adapter 来源的 `source_provider` 私有 Skill，都可正常参与该来源的角色对话。扩展私有 Skill 仍是完整 Skill，只是不会泄露到 Desktop、本地会话或其他扩展来源。

降级语义按同一事务返回给 Cognition 合成：无 ready character skill 记为 `skipped/no_ready_skill`，ready catalog 中无合适建议记为 `skipped/no_suitable_skill`，`contract_only`、非 character audience、策略拒绝、缺确认通道、用户拒绝、handler timeout/error 或非法结果记为 `error` 工具结果。Gateway 对 tool/resource/prompt 都会再次校验 audience，不能通过直接读取 resource 或 render prompt 绕过 catalog。若 `agent_synthesis` RPC 自身失败，Kernel 只投递受控降级回复并记录 trace，不把工具结果写成长记忆事实。

## 与平台 Adapter 的关系

NapCat 等平台 Adapter 属于 Extension/Adapter 边界。它们负责：

- 接入平台协议；
- 清洗平台 payload；
- 映射 scene/source/identity；
- 映射平台注意力窗口；
- 通过 Kernel 注入统一感知；
- 通过受控输出把结果发回平台。

Adapter 的 scene/source identity 用于会话、记忆和回复路由；attention channel 用于“当前角色是否正在关注这个外部上下文”。二者可以不同。例如群聊 scene 可以是整个群，而默认注意力窗口可以细到群内某个发送者；配置为群级注意力时，才让整个群共享同一个注意力窗口。

按照 [ADR-0002](../../decisions/ADR-0002-AttentionLease与CognitiveActivity分层.md)，`sceneAttention.requestAttentionLease()` 是 Kernel Attention Lease 的公开申请入口。Extension 可以表达外部焦点事实，但不能控制 Cognition `CognitiveActivityState`、Affect 或 Maintenance，不能强制当前角色回复，也不能因此获得工具副作用权限。

它们不负责人格判断、长期记忆写入、Kernel 生命周期总控、provider key 管理或 Avatar/Live2D 直接控制。第三方消息进入 Cognition 后，默认只产生远端回复、经历和记忆影响；本地 Avatar/Presence 外显只响应本地 surface scene。若未来要把远端平台镜像成本地身体反应，必须是用户显式开启的 surface policy，而不是 Adapter 默认行为。

NapCat adapter 把未聚焦群聊背景作为带群地址的 `ambient + observe_only` proposal 注入统一认知主线。Host 解析出的 `space_local` 作用域贯穿 Ledger、Conversation、Context Assembly 与 Memory；它不会续期注意力焦点、登记远端回复路由或生成外显回复，也不会自动泄露到本地私聊。若 Adapter 后续生成群聊摘要，应使用 `evidenceProposal` 提交带来源候选。Skill Plane 只承担可执行能力，不承担会话连续性或跨域回忆主路径。

NapCat adapter 只是压力测试样本。它通过 `glimmer.managedResource`、`glimmer.protocolBridge`、`glimmer.capability`、`glimmer.command`、`glimmer.managementSurface` 和 `glimmer.setting` 自然表达“受管外部程序 + 协议桥 + 管理 UI + 登录动作 + 业务能力 + 诊断”，并用 audience 隔离：二维码、快速登录、打开 WebUI 和自动登录账号是 `user` 管理动作；NapCat package/process 是 `host`；OneBot bridge、QQ ingress 和 QQ reply 是 `adapter`；当前没有人物可调用的 NapCat skill。WebUI 可用不代表 QQ 入站/回复能力 ready，OneBot ready 也不要求 WebUI 必须 ready。

实现入口见 [Extension 与 Skill Plane 实现](../../implementation/Extension与SkillPlane实现.md)，字段见 [Extension SDK Reference](../../../reference/extension-sdk.md)，操作见 [扩展开发](../../../guides/subsystems/扩展开发.md)。
