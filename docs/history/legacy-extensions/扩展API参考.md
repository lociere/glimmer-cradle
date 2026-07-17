# 扩展 API 参考

> 包名：`@glimmer-cradle/extension-sdk`
> SDK 源码：`extensions/internal/sdk/`

## 1. 公共入口

```ts
import { BaseExtension, defineExtension } from '@glimmer-cradle/extension-sdk';

import type { PerceptionEvent } from '@glimmer-cradle/extension-sdk/contracts';
import type { ExtensionContext, SceneAttentionPort } from '@glimmer-cradle/extension-sdk/host';
import { ExtensionSystemEventTopics } from '@glimmer-cradle/extension-sdk/events';
import type { ExtensionManifest } from '@glimmer-cradle/extension-sdk/manifest';
import { Permission } from '@glimmer-cradle/extension-sdk/permissions';
import { WebSocketBridge } from '@glimmer-cradle/extension-sdk/utilities/websocket';
```

| 子入口 | 内容 |
|---|---|
| `contracts` | 扩展可见协议投影；权威定义仍在 `@glimmer-cradle/protocol`。 |
| `manifest` | Manifest、contribution points、`requires` 宿主端口声明。 |
| `host` | `ExtensionContext`、`ExtensionHostPorts` 与各类 Port 接口。 |
| `events` | 系统事件 topic 与 payload map。 |
| `lifecycle` | `defineExtension`、`BaseExtension`、生命周期契约。 |
| `permissions` | 权限枚举与 helper。 |
| `utilities` | 可选工具包；工具不定义扩展类型。 |

## 2. defineExtension

```ts
defineExtension<TConfig = unknown>({
  manifest?: ExtensionManifestDraft;
  extension: ExtensionModule<TConfig>;
}): ExtensionDefinition<TConfig>;
```

入口文件只导出定义，不承载业务逻辑。`ExtensionManifestDraft` 允许扩展只写与自身相关的顶层字段和 `contributes` 片段；身份、主入口及默认贡献项仍由 `extension-manifest.yaml` 与宿主统一合并、校验并补齐。运行时消费的一律是完整 `ExtensionManifest`，不能把草稿对象当作事实源。

## 3. BaseExtension

```ts
abstract class BaseExtension<TConfig = unknown> implements ExtensionModule<TConfig> {
  constructor(configSchema?: ZodTypeAny);

  protected get logger(): ExtensionLogger;
  protected get config(): TConfig;
  protected get ctx(): ExtensionContext<TConfig>;

  protected subscribe(eventName: string, handler: (payload: unknown) => void): Disposable;
  protected addDisposable(disposable: Disposable): Disposable;
  protected registerInterval(callback: () => void | Promise<void>, intervalMs: number): Disposable;
  protected registerTimeout(callback: () => void | Promise<void>, delayMs: number): Disposable;

  protected registerCommand(
    commandId: string,
    handler: ExtensionCommandHandler,
    metadata?: ExtensionCommandMetadata,
  ): Disposable;

  protected executeCommand(commandId: string, ...args: unknown[]): Promise<unknown>;
  protected listCommands(): Promise<ExtensionCommandContribution[]>;

  protected abstract activate(): Promise<void> | void;
  protected deactivate(): Promise<void>;
}
```

`subscribe()`、`registerCommand()`、`registerInterval()`、`registerTimeout()` 都会把资源加入 `ctx.subscriptions`，由 ExtensionManager 停用时清理。

## 4. ExtensionContext

```ts
interface ExtensionContext<TConfig = unknown> {
  readonly extensionId: string;
  readonly logger: ExtensionLogger;
  readonly config: TConfig;
  readonly subscriptions: Disposable[];
  readonly ports: ExtensionHostPorts;
}
```

### ExtensionHostPorts

```ts
interface ExtensionHostPorts {
  readonly storage: ExtensionKeyValueStore;
  readonly shortTermMemory: ShortTermMemoryPort;
  readonly perception: PerceptionPort;
  readonly sceneAttention: SceneAttentionPort;
  readonly events: ExtensionEventBus;
  readonly agents: AgentRegistryPort;
  readonly commands: CommandRegistryPort;
}
```

调用示例：

```ts
this.ctx.ports.perception.inject(event);
this.ctx.ports.sceneAttention.reportSceneAttention(sceneId, true);
this.ctx.ports.agents.registerSubAgent(profile);
```

## 5. 端口类型

```ts
interface ExtensionLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

interface ExtensionKeyValueStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

interface ShortTermMemoryPort {
  append(entry: ExtensionMemoryEntryInput): Promise<ExtensionMemoryEntry>;
  getRecent(sceneId: string, limit?: number): Promise<ExtensionMemoryEntry[]>;
  getByType(sceneId: string, messageType: string, limit?: number): Promise<ExtensionMemoryEntry[]>;
  clearScene(sceneId: string): Promise<void>;
}

interface PerceptionPort {
  inject(event: PerceptionEvent): void;
}

interface ExtensionEventBus {
  on(eventName: string, handler: (payload: unknown) => void): Disposable;
  emit(eventName: string, payload: unknown): void;
}
```

受保护端口由 Kernel 按 `permissions` 校验。

## 6. Manifest

```ts
interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  category?: string;
  tags: string[];
  main: string;
  minAppVersion: string;
  permissions: Permission[];
  activationEvents: string[];
  requires: HostPortId[];
  engines: ExtensionEngineConstraint;
  contributes: ExtensionContribution;
}
```

### ExtensionContribution

```ts
interface ExtensionContribution {
  commands: ExtensionCommandContribution[];
  views: ExtensionViewContribution[];
  statusBarItems: ExtensionStatusBarContribution[];
  slashCommands: ExtensionSlashCommandContribution[];
  settings: ExtensionSettingContribution[];
  themes: ExtensionThemeContribution[];
  personaSkins: ExtensionPersonaSkinContribution[];
  scenes: ExtensionSceneContribution[];
  skills: ExtensionSkillContribution[];
}

interface ExtensionSkillContribution {
  id: string;
  name: string;
  description: string;
  tools: Array<{
    name: string;
    description: string;
    parameters: unknown;
  }>;
  resources: Array<{
    id: string;
    description: string;
  }>;
  prompts: Array<{
    id: string;
    description: string;
    template: string;
  }>;
  policy: {
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    confirmationRequired: boolean;
    sideEffects: string[];
    audit: boolean;
  };
}
```

`contributes.skills` 是声明式目录项：加载扩展时进入 `SkillCatalogSnapshot`，默认 `runtime_status = "contract_only"`；激活后用 `ctx.ports.agents.registerSubAgent(...)` 绑定同一个本地 `id`，才会成为可执行 Skill。

`requires` 当前支持：

```ts
type HostPortId =
  | 'storage'
  | 'shortTermMemory'
  | 'perception'
  | 'sceneAttention'
  | 'events'
  | 'agents'
  | 'commands';
```

## 7. WebSocketBridge

```ts
const bridge = new WebSocketBridge(this.logger, {
  onJsonMessage: (data) => this.handleJsonMessage(data),
  onClientDisconnected: () => this.handleDisconnected(),
});

this.addDisposable(bridge);
bridge.start({ host: '127.0.0.1', port: 8080, accessToken });
bridge.sendRaw(JSON.stringify({ action: 'ping' }));
```

`WebSocketBridge` 是工具，不是扩展基类。扩展仍然继承 `BaseExtension` 或直接实现 `ExtensionModule`。

## 8. Permission

```ts
enum Permission {
  CHAT_SEND = 'CHAT_SEND',
  NATIVE_AUDIO_ASR = 'NATIVE_AUDIO_ASR',
  NATIVE_AUDIO_TTS = 'NATIVE_AUDIO_TTS',
  MEMORY_READ = 'MEMORY_READ',
  MEMORY_WRITE = 'MEMORY_WRITE',
  MEMORY_DELETE = 'MEMORY_DELETE',
  MEMORY_SHORT_TERM = 'MEMORY_SHORT_TERM',
  PERCEPTION_WRITE = 'PERCEPTION_WRITE',
  CONFIG_READ_SELF = 'CONFIG_READ_SELF',
  CONFIG_WRITE_SELF = 'CONFIG_WRITE_SELF',
  CONFIG_READ_GLOBAL = 'CONFIG_READ_GLOBAL',
  EVENT_SUBSCRIBE = 'EVENT_SUBSCRIBE',
  EVENT_PUBLISH = 'EVENT_PUBLISH',
  AGENT_REGISTER = 'AGENT_REGISTER',
  COMMAND_REGISTER = 'COMMAND_REGISTER',
  COMMAND_EXECUTE = 'COMMAND_EXECUTE',
}
```
