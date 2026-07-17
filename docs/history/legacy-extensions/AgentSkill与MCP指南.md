# Skill Plane 与 MCP 指南

> 本文描述月见运行时里的 **Skill Plane（技能平面）**。它不是 Codex/IDE 的 skill，而是月见统一管理 Core / Extension / MCP Server / User Script 能力的运行时平面。
>
> 当前代码已经支持 `contributes.skills` 声明式目录项；运行时 handler 仍以 `ctx.ports.agents.registerSubAgent(...)` 绑定。Kernel 内部会把两者都归入 `SkillRegistry` 中的 Extension Skill。

## 1. 概念关系

理想模型：

```text
Skill Plane
└── Skill Registry
    └── Skill
        ├── Tools       # 可执行动作，对齐 MCP tools
        ├── Resources   # 可读取上下文，对齐 MCP resources
        ├── Prompts     # 可复用任务模板，对齐 MCP prompts
        ├── Policy      # 权限、风险、确认、审计
        └── Provider    # 来源：core / extension / mcp_server / user
```

当前 Extension 实现：

```text
Extension
├── contributes.skills         # 静态声明：contract_only catalog entry
└── ctx.ports.agents.registerSubAgent(...)
    └── MCPTool[] + handler    # 运行时绑定：ready catalog entry
        ↓
Kernel Skill Plane / SkillRegistry
```

| 概念 | 含义 |
|---|---|
| Skill Plane | 月见可用技能的统一运行平面，负责注册、发现、权限、调用和审计。 |
| Skill | 月见层面的能力单元；可以包含 tools / resources / prompts / policy。 |
| Tool | Skill 内具体可执行动作；命名和语义对齐 MCP `tools`。 |
| Resource | Skill 暴露的上下文数据；对齐 MCP `resources`。 |
| Prompt | Skill 暴露的任务模板或使用范式；对齐 MCP `prompts`。 |
| Provider | Skill 来源，可以是 `core`、`extension`、`mcp_server` 或 `user`。 |
| Extension | 一种可安装、可卸载、可声明、可授权的 Skill Provider。 |
| SubAgentProfile | 当前运行时绑定结构：一组工具的能力画像与 handler。 |
| MCPTool | 当前实现中的工具结构；后续应成为 Skill.tools 的标准项。 |

Skill 是月见“我会什么”的上层概念；MCP 的 `tools/resources/prompts` 是底层标准契约。Extension 给月见提供无限可能，但 Extension 不是 Skill 的唯一来源：打开网页、截图、剪贴板这类基础桌面能力应作为 Core Skill 进入同一个 Skill Registry；外部 MCP server 则作为 MCP Server Provider 接入。

当前 `SkillRegistry` 已提供 `SkillCatalogSnapshot`，用于把已注册能力整理成可发现的目录。目录快照只暴露描述、Provider、Tool/Resource/Prompt 摘要、Policy 与 Metadata，不暴露 handler；planner、调试工具和未来 Control Center 能力页都应通过 `SkillCatalogAppService` 读取能力清单，而不是直接依赖注册表单例。`contributes.skills` 产生的目录项会标记为 `contract_only`，只有运行时绑定 handler 后才可执行。

### 1.1 Core Skill Provider 位置

当前实现中，月见自带能力写在 Kernel Application 层的 Skill Plane 下：

```text
core/kernel/src/core/application/skill-plane/
├── skill-registry.ts
├── skill-policy-engine.ts
├── skill-invocation-gateway.ts
├── types.ts
└── providers/
    ├── index.ts
    ├── core/
    │   ├── index.ts
    │   ├── core-skill-provider.ts
    │   ├── desktop/
    │   │   ├── manifest.ts
    │   │   └── tools.ts
    │   ├── clipboard/
    │   │   ├── manifest.ts
    │   │   └── tools.ts
    │   ├── notification/
    │   │   ├── manifest.ts
    │   │   └── tools.ts
    │   ├── screen-context/
    │   │   ├── manifest.ts
    │   │   └── tools.ts
    │   └── confirmation/
    │       ├── manifest.ts
    │       └── tools.ts
    ├── extension/
    │   └── extension-skill-provider.ts
    ├── mcp-server/
    │   ├── index.ts
    │   └── mcp-server-skill-provider.ts
    └── user/
        ├── index.ts
        └── user-skill-provider.ts
```

`providers/core/` 只放 **Minimal Universal Skills（最小通用核心技能）**，例如：

- `desktop.open_url`
- `desktop.open_file`
- `clipboard.read`
- `clipboard.write`
- `notification.show`
- `screen.capture`
- `screen.active_window`
- `confirmation.request`

当前 Skill Plane 已定义统一 `SkillProvider` 生命周期接口，并由 `DEFAULT_SKILL_PROVIDERS` 在 Kernel 启动时统一启动。`providers/core/` 已落地为契约型 Core Skill Provider：`core.desktop`、`core.clipboard`、`core.notification`、`core.screen_context`、`core.confirmation` 会在 Kernel 启动时注册到 `SkillRegistry`。这些技能的 `metadata.runtime_status` 仍为 `contract_only`，代表“能力边界与策略已正式存在，但真实平台服务待接线”。调用必须经过 `SkillInvocationGateway` 与 `SkillPolicyEngine`，不会绕过策略直接执行；对外发现则通过 `SkillCatalogAppService.getCatalogSnapshot()` 返回的 `SkillCatalogSnapshot`，不会把执行函数暴露给 planner 或 UI。

`providers/mcp-server/` 已使用官方 MCP TypeScript SDK 读取 `configs/system/skills.yaml` 中启用的连接目标，托管 stdio / Streamable HTTP / WebSocket 会话，并完成 initialize、tools/resources/prompts 枚举与调用。每个 Server 映射为一个 `provider=mcp_server` 的 ready Skill；远端断连、超时或刷新失败会撤销目录项并保留 Provider 降级状态，而不是留下不可调用的假能力。`providers/user/` 当前只落地 Provider 生命周期骨架，不注册假技能。

不要把具体平台、具体服务、复杂工作流或业务自动化写进 Core Skill。GitHub、Notion、QQ、Discord、日历、浏览器深度自动化、文件整理、游戏或直播接入都应通过 Extension Skill Provider 或 MCP Server Provider 进入。

### 1.2 MCP Server Provider 配置

MCP Server Provider 的本地配置入口是 `configs/system/skills.yaml`：

```yaml
mcp_servers:
  - id: filesystem
    enabled: false
    transport: stdio
    command: "node"
    args:
      - "path/to/mcp-server.js"
    capability_prefix: filesystem
    timeout_ms: 30000

  - id: web-tools
    enabled: false
    transport: http
    url: "http://127.0.0.1:9000/mcp"

user_skills:
  enabled: false
  root_dir: "skills"
```

当前阶段的语义：

- `enabled=false` 的 server 不进入生命周期目标。
- `stdio` 必须有 `command`；`http` / `websocket` 必须有 `url`。
- `capability_prefix` 映射为 `mcp.<capability_prefix>` Skill ID；缺省使用 server `id`，启用目标之间不得重复。
- `env` 只注入 stdio 子进程，且只能放非敏感值；密钥应走 `configs/secrets/` 或系统环境变量。远程 HTTP / WebSocket 的 OAuth 与凭据存储属于后续授权能力，当前不从普通 YAML 读取令牌。
- Provider 在后台建立连接，不阻塞 Kernel 主启动；真实 MCP 能力只有在握手与枚举成功后才进入 catalog。
- 一次调用或枚举超过 `timeout_ms` 会被标为该 Provider 不可用；停止 Kernel 时会关闭会话、终止受管 stdio 子进程并撤销目录项。

### 1.3 推荐命名

| 推荐术语 | 不推荐用法 |
|---|---|
| Skill Plane | 不要叫 Agent 工具堆、MCP 插件堆。 |
| Skill Registry | 不要把它写成只服务 extension 的 SubAgentRegistry 终态。 |
| Skill Provider | 不要把 core / extension / mcp server 都混叫 extension。 |
| Tool | 单个可执行动作用 Tool，不把每个函数都叫 Skill。 |
| Extension | 可安装贡献单元，不是所有本体基础能力的容器。 |

## 2. 权限与策略

注册 SubAgent 需要在 `extension-manifest.yaml` 中声明：

```yaml
permissions:
  - AGENT_REGISTER

requires:
  - agents
```

`requires` 表示需要宿主开放的端口，`permissions` 是实际授权。缺少 `AGENT_REGISTER` 时，Kernel 会拒绝注册。

Skill policy 以 Skill 为默认策略，Tool 可以收紧覆盖。这样一个 MCP Server 同时提供只读查询和写外部系统的工具时，不会被粗糙地套用同一种风险等级。当前 MCP 映射规则是：`readOnlyHint=true` 的 tool 为 low 且可直接调用；标记 `destructiveHint` 或 `openWorldHint` 的 tool 为 high 且必须确认；未声明语义的远端 tool 保守地视为 medium 且必须确认。

长期 Skill Plane 还需要在 policy 中表达：

- `risk_level`：low / medium / high / critical。
- `confirmation_required`：是否调用前需要用户确认。
- `side_effects`：是否会写文件、发消息、联网、改变外部系统。
- `sandbox`：调用运行在哪个隔离边界。
- `audit`：是否写入技能调用审计与经历日志。

当前 Kernel 策略实现已经具备两条硬边界：`contract_only` 技能不可执行；需要用户确认但确认通道尚未接入的技能不可执行。后续接入确认 UI 后，再把对应能力从拒绝态切换为可确认执行。

## 3. 最小示例

```ts
import { z } from 'zod';
import { BaseExtension } from '@glimmer-cradle/extension-sdk';

export class TimerSkillExtension extends BaseExtension {
  protected override activate(): void {
    const disposable = this.ctx.ports.agents.registerSubAgent({
      id: 'timer-skill',
      name: '计时提醒',
      description: '创建短时间提醒和倒计时。',
      tools: [
        {
          name: 'set_timer',
          description: '设置一个倒计时提醒。',
          parameters: z.object({
            minutes: z.number().int().min(1).max(180),
            message: z.string().min(1),
          }),
          handler: async ({ minutes, message }) => {
            this.logger.info('timer requested', { minutes, message });
            return { ok: true, minutes, message };
          },
        },
      ],
      memoryImpact: true,
      allowInterrupt: true,
    });

    this.addDisposable(disposable);
  }
}
```

## 4. SubAgentProfile

```ts
interface SubAgentProfile {
  id: string;
  name: string;
  description: string;
  tools: MCPTool[];
  memoryImpact?: boolean;
  allowInterrupt?: boolean;
}
```

| 字段 | 说明 |
|---|---|
| `id` | 全局唯一，建议使用 `<extension-id>.<skill-id>` 或与扩展 ID 明确关联。 |
| `name` | 展示名。 |
| `description` | Cognition 选择该 Skill 的主要依据，必须说明能力边界。 |
| `tools` | 工具列表。 |
| `memoryImpact` | 是否可能影响记忆或用户长期状态。 |
| `allowInterrupt` | 是否允许在任务中被中断。 |

## 5. MCPTool

```ts
interface MCPTool<TArgs = unknown> {
  name: string;
  description: string;
  parameters: z.ZodType<TArgs>;
  handler(args: TArgs): Promise<unknown> | unknown;
}
```

### 5.1 参数 schema

参数必须显式建模，优先使用 Zod：

```ts
const SearchArgs = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(10).default(5),
});
```

不要把自由文本塞进一个 `payload` 字段后再手写解析。Cognition 调用工具时需要结构化参数。

### 5.2 handler

handler 应满足：

- 只做工具声明范围内的事。
- 返回可 JSON 序列化的数据。
- 错误要抛出清晰 message，由 Kernel 统一记录。
- 外部请求应设置超时，不要无限等待。
- 涉及用户长期状态、记忆或外部副作用时，要让 `description` 明确说明。

## 6. 调用链路

理想链路：

```text
Cognition CognitiveLoop
  -> Skill Planner 选择候选 Skill / Tool
  -> Kernel Skill Registry 查找可用 provider
  -> Policy Engine 校验权限、风险、确认与沙箱
  -> Invocation Gateway 调用 core / extension / mcp_server / user provider
  -> 返回结构化 tool result
  -> Cognition 综合结果并决定回复 / 行动
```

当前过渡链路：

```text
Cognition 产生工具意图
  -> Kernel 根据 SubAgentProfile 与 Tool 描述选择工具
  -> Extension Host 调用对应 handler
  -> handler 返回结构化结果
  -> Kernel 把结果交回 Cognition 综合回应
```

Extension 不应该直接操纵 Cognition 内部 prompt、记忆图谱或对话状态。它只暴露工具，是否调用由 Cognition 与 Kernel 的任务链路决定。

## 7. 与 Contribution Points 的关系

`contributes.skills` 是声明式事实；Agent Skill 注册是运行时能力绑定。二者应使用同一个本地 `id`：manifest 先让目录知道“这个扩展会什么”，激活后 `registerSubAgent` 再绑定真实 handler。如果运行时没有绑定，Skill 仍可被发现，但会因为 `contract_only` 被策略层拒绝执行。

```yaml
requires:
  - agents
  - commands

permissions:
  - AGENT_REGISTER
  - COMMAND_REGISTER

contributes:
  commands:
    - command: timer-skill.open
      title: 打开计时提醒
  skills:
    - id: timer-skill
      name: 计时提醒
      description: 创建短时间提醒和倒计时。
      tools:
        - name: set_timer
          description: 设置一个倒计时提醒。
          parameters:
            type: object
            properties:
              minutes:
                type: number
              message:
                type: string
      policy:
        riskLevel: medium
        confirmationRequired: false
        sideEffects:
          - reminder
        audit: true
```

这表示扩展既提供可被 Cognition 调用的工具，也给 UI 或命令面板提供可见入口。

## 8. 边界

- Skill 不应绕过 Kernel 直接调用 Cognition 私有模块。
- Skill 不应把平台原始 payload 泄露给 Cognition。
- Skill 不应在没有权限声明的情况下访问配置、记忆、事件或命令。
- Skill 的 `description` 不应夸大能力，否则 Cognition 会错误选择它。

## 9. 验证

改 Agent Skill 后至少检查：

```bash
pnpm --filter @glimmer-cradle/extension-sdk typecheck
pnpm --filter @glimmer-cradle/kernel typecheck
```

如果扩展有自己的包，也运行该扩展的 build/typecheck。
