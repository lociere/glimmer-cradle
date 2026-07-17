# 阶段 P 设计 —— Protocol 契约层重构

> 文档状态：v1.0 / 2026-05-21 / 设计提案（待落地）
>
> 上游：[月见架构蓝图](../../architecture/blueprint/月见架构蓝图.md) 第一部分（"protocol 是跨层稳定边界"）+
> 当前入口见 [Protocol Reference](../../reference/protocol.md) 与 [Protocol 契约层实现](../../architecture/implementation/Protocol契约层实现.md)。
>
> 本阶段插在迁移路线**阶段 3（已完成）与阶段 4（觉醒态机）之间**，编号 P
> 表示「Protocol 重构」—— 不是新功能、是把契约层从早期形态升级为可承载长期演进的形态。
> 阶段 4 起的新协议（`ArousalState` / `ArousalSnapshot` 等）天然按本设计的新结构落地。
>
> 本文是阶段 P 的**单一事实源**。落地按第八节分批清单进行，每批独立可提交、可回滚。

---

## 一、目标与范围

**做：**
- **立三条铁律**（见 §三）作为 protocol 层长期宪法，写进 CLAUDE.md。
- **目录按职责重组**：`schemas/` 装跨语言契约、`generated/` 装 codegen 产物、TS-only 设施搬出 protocol/。
- **废弃所有手写双镜像**：`LongTermMemoryType` / `KernelMessageEnvelope` / `ErrorCode` / `Permission` 等全部走 schema codegen。
- **新建 `extension-sdk/` 独立顶级包**：扩展开发面从 protocol/ 拆出。
- **Python 侧契约目录提级改名**：`core/cognition/.../ipc_server/contracts/` → `core/cognition/.../selrena/protocol/`。
- **Zod 配置在本阶段完整迁移到 JSON Schema**（分两步走，最终零例外）。
- **CI 守门**：`sync:contracts:check` 接入 GitHub Actions（仓库当前无 `.github/workflows/`，一并补上）。

**不做（留待后续）：**
- 协议层版本号机制 / breaking change negotiation —— 月见单机部署，无多版本共存场景。
- protobuf / gRPC / TypeSpec 迁移 —— 这些方案对月见的规模（两端、单机、JSON IPC）收益不抵成本，留作未来选择项。
- 扩展 SDK 公开发布到 npm registry —— 当前 monorepo 内部使用即可，外部分发是后置话题。

---

## 二、现状盘点（问题）

### 2.1 契约权威碎成三套语言，规则不明

| 契约类型 | 当前位置 | 同步机制 |
|---|---|---|
| `PerceptionEvent` / `ActionCommand` / `VisualCommand` | `protocol/src/schemas/*.json` | ✅ schema + codegen |
| 配置 schema（578 行） | `protocol/src/config/schema.ts` | Zod TS-only，Python 端 `GlobalAIConfig` 手写镜像 |
| IPC 信封与多种 payload | `protocol/src/ipc/ipc-types.ts` | TS 手写 + `kernel_ingress_contracts.py` 手写镜像 |
| `LongTermMemoryType` | `protocol/src/models/memory.ts` | TS 手写 + `memory_types.py` 手写镜像 |
| `ErrorCode` / `Permission` / `TraceContext` | `protocol/src/core.ts` | TS 手写，Python 凭情况要么手写要么完全不存在 |

哪个该用哪个，**没有规则**。结果就是两个同类的概念（同为跨语言枚举的 `LongTermMemoryType`
和 `address_mode`）处理方式不一样。

### 2.2 目录按"早期想法"切，不是按职责切

- `protocol/src/models/` 5 个文件大多 6–10 行，半数是空壳
- `protocol/src/core.ts` 一个文件混了 4 种东西：TraceContext / ErrorCode / Permission / Exception 类
- `protocol/src/events/` 装的是 **TS EventBus 进程内**事件类（`DomainEvent` / `AppStartingEvent` 等），不是跨语言契约 —— 它根本不应该跟 schemas/ 同级
- `protocol/src/ports/` 是 TS interface（`IAICapabilityPort` 等），也不跨语言

### 2.3 TS-only 设施混在 protocol 里

`protocol/src/extension/`、Zod 配置、TS EventBus 类、TS interface ports
—— 这些都只有 TS 看见。把它们和真正的跨语言契约挤在同一棵树下，让"protocol = 跨语言契约"
这条线模糊。

### 2.4 Python 侧契约目录名误导

Python 侧的镜像放在 `selrena/ipc_server/contracts/`，把跨语言契约塞进"IPC 服务器"模块下，
暗示它"属于 IPC server"。其实契约是横切的，记忆 / 情感 / 觉醒态等模型都消费它。

### 2.5 协议演进无 CI 守门

`sync:contracts:check` 工具当时依赖 `scripts/sync_contracts.py`，
但没接进任何 CI workflow（仓库当前无 `.github/workflows/`）。漂移完全靠纪律。

---

## 三、三条铁律（写进 CLAUDE.md）

### 铁律 1：跨语言必走 schema

**凡有 ≥ 2 个语言层消费的类型**，权威定义在 `protocol/src/schemas/`，由
`pnpm sync:contracts` 多端 codegen。当前两端：TS interface（json-schema-to-typescript）+
Python Pydantic 模型（datamodel-codegen）。**手写镜像禁止**。**没有例外**。

> 规则的"语言无关"是结构性的：`core/native/` 规划中的 Rust / C++ 等未来语言层
> 加入时，**仅需在 `scripts/sync_contracts.py` 新增一个 emitter + 输出目录**
> （如 `core/native/src/protocol/generated/`），schemas/ 不动 —— 这是
> schema-first 的核心红利，也是这条铁律不绑死"TS+Python"二字的原因。

> 没有例外是这条铁律的全部价值。一旦说"除了 X 之外都走 schema"或"只这两个语言走"，
> 三年后会有 Y / Z 都来申请豁免、新语言加入时整条规则又要重写。例外即规则失败。

### 铁律 2：TS-only 设施不进 protocol

EventBus 进程内事件类（`DomainEvent` / `AppStartingEvent` 等）、TS interface ports
（`IAICapabilityPort` 等）、Exception 实现类（`CoreException extends Error`）——
这些只有 TS 看见且无法跨语言（`Error` 子类是 JS runtime 概念），住在
`core/kernel/src/core/foundation/` 各自子目录。

> Python 没有"对称的内部物子目录"是健康的，不是缺陷 ——
> TS 历史上把内部类型塞进 protocol 是要回收的坏习惯，不是 Python 缺了什么。

### 铁律 3：扩展开发面独立成包

`@glimmer-cradle/extension-sdk` 与 `@glimmer-cradle/protocol` **平级**，两个独立顶级包。
受众不同（扩展作者 vs Python 认知核），版本独立。

> 业内对照：VSCode / Chrome / JetBrains / Obsidian 全是这样做。引擎与 SDK 分包是行业共识。

---

## 四、为什么 JSON Schema + codegen 是月见的甜点位

### 4.1 codegen 原理（中性 AST）

JSON Schema 是**语言中性的类型 AST**，由 IETF 标准化。codegen 工具流程：

```
schema.json
   ↓ 解析
AST { kind: "string-enum", values: ["direct","ambient"], ... }
   ↓
   ├─ TS emitter → "type X = 'direct' | 'ambient';"
   └─ Python emitter → "X = Literal['direct', 'ambient']"
```

两端**共享同一棵 AST**，因此结构等价由工具保证，不依赖人脑同步。

### 4.2 业内对照

| 方案 | 强项 | 月见为什么不选 |
|---|---|---|
| **JSON Schema**（已选） | 标准成熟、JSON 友好、内嵌运行时校验、零新依赖 | — |
| **protobuf / gRPC** | 二进制紧凑、RPC 一体 | ZMQ 已传 JSON，二进制收益不抵 protoc 工具链负担 |
| **OpenAPI** | HTTP API 业内标杆 | 偏 REST 场景，对内部 IPC 过度 |
| **TypeSpec** | TS-like DSL、多 emitter | 生态过新 |

### 4.3 为什么对月见恰好合适

- ZMQ 传 JSON，schemas/ 产物天然兼容
- 只两端（TS + Python）：Buf / TypeSpec 等"统一多端"工具的红利吃不满
- 工具链已就位：`json-schema-to-typescript` + `datamodel-codegen` 都在跑
- 内嵌校验：`minimum/maximum/pattern/enum` 顺便给 Pydantic 当运行时校验器，不用再加一层
- 标准化：W3C-tier 标准，工具链长寿、不绑公司、有 fallback

---

## 五、最终架构

### 5.1 目录树

```
glimmer-cradle/                          # 仓库根
│
├── protocol/                            # ★ 跨语言契约（lingua franca）
│   └── src/
│       ├── schemas/                     # 唯一事实源（JSON Schema）
│       │   ├── enums/                   # ArousalState / LongTermMemoryType /
│       │   │                            # MomentKind / AddressMode / ErrorCode /
│       │   │                            # MetricKind / Permission ...
│       │   ├── models/                  # ArousalSnapshot / ArousalProfile /
│       │   │                            # AffectSnapshot / PerceptionEvent /
│       │   │                            # MemoryEntry / ActionCommand / VisualCommand
│       │   ├── ipc/                     # KernelMessageEnvelope / PerceptionMessage /
│       │   │                            # LifeHeartbeat / StateSync /
│       │   │                            # KnowledgeInit / ConsolidateMemory ...
│       │   ├── config/                  # SystemConfig / PersonaConfig / AIConfig ...
│       │   │                            # （P.4 后取代 Zod schema）
│       │   └── .checksum
│       ├── generated/                   # TS codegen 产物（不手改）
│       │   ├── enums/  models/  ipc/  config/
│       │   └── index.ts
│       ├── utils/                       # 跨层小工具（scene-id 规范化等）
│       └── index.ts                     # 仅 re-export generated/ + utils/
│
├── extension-sdk/                       # ★ 新建独立包：TS 扩展开发 SDK
│   └── src/
│       ├── manifest.ts                  # 扩展 manifest 的 Zod schema
│       ├── events.ts                    # 扩展可发布的事件类型
│       ├── sdk.ts                       # 扩展 API（ExtensionContext 等）
│       └── index.ts
│
├── core/
│   ├── kernel/                          # Kernel 内核（自留 TS-only 设施）
│   │   └── src/core/foundation/
│   │       ├── event-bus/
│   │       │   ├── event-bus.ts         # 已有
│   │       │   └── events/              # ← 从 protocol/events/ 整体搬来
│   │       │       ├── domain-event.ts
│   │       │       ├── lifecycle-events.ts
│   │       │       ├── action-stream-events.ts
│   │       │       ├── memory-events.ts
│   │       │       ├── perception-events.ts
│   │       │       └── scene-events.ts
│   │       ├── ports/                   # ← 从 protocol/ports/ 搬来
│   │       │   ├── ai-capability.port.ts
│   │       │   ├── extension-host.port.ts
│   │       │   ├── ipc-interface.ts
│   │       │   ├── storage-interface.ts
│   │       │   └── bridge.ts
│   │       ├── exceptions/              # ← 从 protocol/core.ts 拆来
│   │       │   ├── core-exception.ts    # 实现类（ErrorCode 仍 from protocol/）
│   │       │   └── extension-exception.ts
│   │       └── config/                  # ← 从 protocol/config/ 搬来（P.4 期间过渡）
│   │           └── ...
│   │
│   └── cognition/                       # Python 认知核
│       └── src/selrena/
│           └── protocol/                # ← 从 ipc_server/contracts/ 提级 + 改名
│               ├── generated/           # Python codegen 产物（不手改）
│               │   ├── enums/
│               │   ├── models/
│               │   ├── ipc/
│               │   └── config/
│               └── __init__.py          # 一站式 re-export
│
└── .github/workflows/
    └── sync-contracts.yml               # ★ 新增 CI：sync:contracts:check 双端
```

### 5.2 各类型归属表

> **2026-05-21 核查修正**：落地 P.3 前对本表逐项做了「真的跨语言吗」核查。
> 三项原列入 schemas/ 的类型未通过核查 —— 见表内"核查"列。铁律 1 是
> 「凡两端**都看见**」，投机性提前迁入违反铁律精神。

| 类型 | 性质 | 当前位置 | 核查 / 新位置 |
|---|---|---|---|
| `ArousalState` / `ArousalProfile` / `ArousalSnapshot` | 跨语言枚举 / 模型 | （新增） | ✅ `schemas/{enums,models}/`（阶段 4） |
| `LongTermMemoryType` | 跨语言枚举 | `models/memory.ts` + `memory_types.py` 双手写 | ✅ `schemas/enums/`（P.3a） |
| `MetricKind` | 跨语言枚举 | `metrics.ts` + `metrics.py` 双手写 | ✅ `schemas/enums/`（P.3a） |
| `TraceContext` | 跨语言模型 | `core.ts` 手写 | ✅ `schemas/models/`（P.3a） |
| `MemoryEntry` | 跨语言模型 | `models/memory.ts` 手写 | ✅ `schemas/models/`（P.3a） |
| `ErrorCode` | 跨语言枚举 | `core.ts`（TS 整数枚举）/ Python ad-hoc 字符串 | ⚠ **两端语义分叉** —— TS 整数枚举、Python ad-hoc 串。需先统一为字符串枚举（**P.3-error**），再 `schemas/enums/` |
| `KernelMessageEnvelope` | 跨语言 IPC 信封 | `ipc-types.ts` + `kernel_ingress_contracts.py` 双手写 | ✅ `schemas/ipc/`（P.3b） |
| 各类 IPC payload | 跨语言 IPC 消息 | `ipc-types.ts` + `kernel_ingress_contracts.py` 双手写 | ✅ `schemas/ipc/`（P.3b） |
| `AddressMode` | 跨语言枚举 | 嵌在 `PerceptionEvent.schema.json` 内 | ✅ 抽独立 `schemas/enums/`（P.3b 随 IPC 一并） |
| `MomentKind` | 枚举 | `experience/events.py`（**当前纯 Python**） | ⚠ **未达"两端都看见"** —— 经历层是认知核独占，TS 尚未消费。暂留 Python，待 TS（如 UI 渲染 Moment）真用时再迁 |
| `Permission` | 枚举（扩展沙箱权限） | `core.ts`（**TS-only**） | ⚠ Python 不做扩展权限校验 —— 非跨语言。按铁律 2 + 3 归 `extension-sdk/`（P.6），不进 schemas/ |
| `KernelMessageEnvelope` | 跨语言 IPC 信封 | `ipc-types.ts` + `kernel_ingress_contracts.py` 双手写 | `schemas/ipc/KernelMessageEnvelope.schema.json` |
| 各类 IPC payload | 跨语言 IPC 消息 | `ipc-types.ts` + `kernel_ingress_contracts.py` 双手写 | `schemas/ipc/*.schema.json` |
| 配置 schema（system/persona/ai） | 跨语言（IPC 经 SELRENA_CONFIG） | `config/schema.ts`（Zod）+ Python `GlobalAIConfig` 手写 | `schemas/config/*.schema.json`（P.4） |
| `CoreException` / `ExtensionException` 类 | TS-only（JS Error 子类） | `core.ts` | `core/kernel/.../foundation/exceptions/` |
| `DomainEvent` / `AppStartingEvent` 等类 | TS-only（EventBus 进程内） | `protocol/events/` | `core/kernel/.../foundation/event-bus/events/` |
| `IAICapabilityPort` / 其他 ports | TS-only（DI interface） | `protocol/ports/` | `core/kernel/.../foundation/ports/` |
| 扩展 manifest / SDK / 事件 | TS-only（扩展用 TS 写） | `protocol/extension/` | `extension-sdk/` 独立包 |

### 5.3 跨语言契约工作流

**新增一个跨语言契约**：

1. 在 `protocol/src/schemas/{enums,models,ipc,config}/X.schema.json` 写 schema
2. `pnpm sync:contracts` —— 自动产出：
   - `protocol/src/generated/{enums,...}/X.ts`
   - `core/cognition/src/selrena/protocol/generated/{enums,...}/x.py`
3. TypeScript 端 `import { X } from '@glimmer-cradle/protocol'`
4. Python 端 `from cognition_core.protocol import X`
5. `pnpm sync:contracts:check` CI 守门（schema 改了未跑 codegen → CI 红灯）

**改一个跨语言契约**：

1. 改 schema
2. 跑 `pnpm sync:contracts`
3. 两端业务代码顺生成产物变化适配
4. PR 一次 diff 包含 schema + 两端 generated/ + 业务代码 —— review 一目了然

---

## 六、extension SDK 独立包决策

按铁律 3，扩展开发面独立为 `@glimmer-cradle/extension-sdk`。**理性分析**：

| 维度 | 分析 |
|---|---|
| **受众** | protocol：Python ↔ TS；extension SDK：扩展作者 ↔ 内核。完全不同的对话 |
| **语言** | 扩展用 TS 写、由 Kernel 内核装载，Python 完全不参与。它是纯 TypeScript↔TypeScript 契约 |
| **依赖图** | protocol 对内核**零依赖**；extension SDK 必然依赖内核端的运行时概念。两者在依赖图里的位置不同 |
| **版本演进** | IPC 契约改 → bump protocol（影响 Python）；扩展 API 改 → bump SDK（影响扩展作者）。两个独立的演进节奏 |
| **bundle 大小** | 扩展 ship 时不需要带上 Pydantic-style codegen 产物；protocol 也不需要 ship sandbox helpers |

业内一致：**VSCode / Chrome / JetBrains / Obsidian 全是引擎与 SDK 分包**。

---

## 七、Zod 配置迁移（无例外原则）

### 7.1 为什么不留例外

按铁律 1，配置是跨 IPC 边界的数据（kernel 解 YAML → JSON 注入 → Python `GlobalAIConfig` 二次校验），
**它就是 IPC payload**。和 `PerceptionMessage` 一样性质，不该例外。

Zod ergonomics 损失逐条评估：

| Zod 特性 | 损失评估 |
|---|---|
| `.default()` | 无损失。JSON Schema `default` 关键字，ajv / Pydantic 原生支持 |
| `.transform()` | **该损失**。契约层不该带转换逻辑 —— 提到 config-processor 层 |
| `.refine()` 跨字段校验 | **该损失**。跨字段不变式属 domain 层，不属契约层 |
| `.discriminatedUnion()` | 无损失。JSON Schema `oneOf + const` 判别 union，codegen 正确处理 |
| `z.infer<T>` | 无损失。codegen 直接产 TS interface |
| TypeScript 端运行时校验 | 零损失。换 ajv（成熟、12k stars、零依赖） |

剩下的真实损失只有"JSON Schema 写起来比 Zod 啰嗦" —— 这是协议层啰嗦换业务层永不漂移，好交易。

### 7.2 分步落地

| 步骤 | 内容 | 状态 |
|---|---|---|
| **P.4a** | 写 `schemas/config/{system,persona,ai,...}.schema.json`，跑 codegen，得到 TS + Pydantic 两端。**Zod 暂留**作内核 YAML 加载校验器。Python 端 `GlobalAIConfig` 即刻切到 codegen 产物 —— Python 端先消除手写镜像 | P.4 |
| **P.4b** | TypeScript 端切 ajv 校验生成的 TS 类型；删除 Zod schema 与 ajv-zod 双轨；删除内核 `core/foundation/config/` 临时驻点 | P.4 |

P.4a 与 P.4b 之间靠 `sync:contracts:check` 强制一致性 —— schema 改了 → Zod 必须同步改，
否则 CI 红灯。这不是回到例外，而是**承认迁移本身分阶段，最终态零例外**。

---

## 八、迁移分批清单

> **2026-05-21 修正**：原 P.3 拆为 P.3a / P.3-error / P.3b（核查发现
> `ErrorCode` 需先做语义统一、`Permission` 归 extension-sdk、`MomentKind`
> 暂留 Python —— 见 §5.2 核查列）。

| 子批次 | 内容 | 触及 | 风险 |
|---|---|---|---|
| **P.0** ✅ | 本设计文档定稿 + CLAUDE.md 加三条铁律 | 文档 | 低 |
| **P.1** ✅ | `protocol/src/schemas/{enums,models,ipc,config}/` 骨架 + `generated/` 子目录化 + `sync_contracts.py` 适配递归 + 双端索引自生成 | 协议 + 工具 | 中 |
| **P.2** ✅ | 现有 3 个 schema（PerceptionEvent / ActionCommand / VisualCommand）迁入 `schemas/models/`；codegen 重跑 | 协议 | 中 |
| **P.3a** | 新增跨语言 schema：`LongTermMemoryType` / `MetricKind` enum + `TraceContext` / `MemoryEntry` model；废弃对应手写镜像（TS `models/memory.ts` 部分 + Python `memory_types.py`）；两端切 codegen 产物 | 协议 + 两端业务代码 | 中 |
| **P.3-error** | `ErrorCode` 语义统一：整数枚举 → 字符串枚举（值=名，14 值含 `CANCELLED`）；写 `schemas/enums/ErrorCode.schema.json`；TS `core.ts` 枚举切 codegen、`CoreException.code` 随之变字符串；Python `kernel_bridge.py` 等 ad-hoc 串切 generated enum | 协议 + 两端错误处理 | 高 |
| **P.3b** | `KernelMessageEnvelope` + 主要 IPC payload 迁 `schemas/ipc/`；`AddressMode` 抽独立 enum；删除 Python `kernel_ingress_contracts.py` 手写镜像、TS `ipc-types.ts` 手写类型 | 协议 + 两端业务代码 | 高 |
| **P.4a-4** ✅ | 调研：Zod 表达式障碍清查（transform/merge/strict/default/passthrough）+ codegen default 透出能力验证；唯一难点：1 处 `.transform()`（module_levels null→{}） | 协议 + 调研 | 低 |
| **P.4a-1** ✅ | 写 Python ABI 面 schema（Persona/Inference/LLM/Experience/Cognition），Python `core/config.py` 切 codegen 产物；`sync_contracts.py` 加 config/ frozen 注入 + TS index 跳过 config（Zod 仍 TS auth）；212 pytest 全过 | 协议 + Python config | 中 |
| **P.4a-2** ✅ | 写 Kernel-only 面 schema（AppConfig/IPC/Lifecycle/Extension/Renderer/IngressGate/MemoryRuntime/Observability）共 8 份；新增 `core/kernel/.../config/yaml-normalizers.ts` 落地 module_levels null→{} normalizer（P.4a-2 仅落地、P.4b 接线，Zod `.transform()` 仍现役）；codegen 双端产出（Python 端文件存在不消费）；212 pytest + 两端 TS lint 全过 | 协议 + 内核 config | 中 |
| **P.4a-3** ✅ | 写 KnowledgeBase 面 schema（含 KnowledgeScope/KnowledgeEntry/KnowledgeRetrievalConfig 内联 definitions）；与 IPC `KnowledgeInitPayload` 字段语义对齐，约束严格度以 config schema 为准（IPC 投放时已 pre-validated 故宽松）；codegen 双端产出；212 pytest + TS lint 全过。跨文件 $ref 合并留 P.4b 之后 codegen 工具升级时复审 | 协议 + 知识库 | 低 |
| **P.4b** ✅ | **TS 切 ajv，铁律 1 真正无例外**：新增 `core/kernel/.../config/ajv-validator.ts`（ajv + ajv-formats）、`protocol/src/config-schemas.ts`（14 份 schema 静态导出供 ajv 注入）；ConfigManager 分段校验（AppConfig + 7 个 kernel 子块；persona/inference/llm 三段）；`normalizeSystemYamlNulls` 接线在 ajv 前；删除 `protocol/src/config/schema.ts`、`protocol/src/ipc/ipc-types.ts` 中重复的 IPCKnowledge* / KnowledgeInitRequest；sync_contracts.py：移除 `_TS_INDEX_SKIP_SUBDIRS={"config"}` + 加 `_drop_optional_for_defaulted_fields` TS 后处理（让 ajv `useDefaults` 与 TS 类型 required-after-validation 对齐）；protocol/kernel `package.json` 删 zod 依赖。验证：212 pytest + 两端 TS lint 全过。 | 协议 + 内核 config | 中 |
| **P.5** | **从 protocol/ 搬出 TS-only**：`events/` → 内核 `event-bus/events/`；`ports/` → 内核 `ports/`；`core.ts` 异常类 → 内核 `exceptions/` | 协议 + 内核 | 中 |
| **P.6** | **新建 `extension-sdk/` 顶级包**：把 `protocol/extension/` 整体搬过去 + `Permission` 枚举一并归入；扩展 import 改为 `@glimmer-cradle/extension-sdk`；pnpm-workspace.yaml 注册 | 协议 + 扩展 + workspace | 中 |
| **P.7** | Python 侧 `ipc_server/contracts/` → `selrena/protocol/` 改名提级；两端业务 import 调整 | Python 业务代码 | 中 |
| **P.8** ✅ | `.github/workflows/sync-contracts.yml` CI 守门：codegen drift 检查 + protocol/extension-sdk lint + kernel build；P.4b 收口后追加 cognition pytest step（schema↔Python 兼容性体检，TS lint 看不到这条 gap）；触发路径扩到 protocol/src/** + core/cognition/src,tests/** + core/kernel/src/** | CI | 低 |

**建议顺序**：P.0 → P.1 → P.2 → P.3a → P.3-error → P.3b → P.4a-4 → P.4a-1 → P.5 → P.6 → P.7 → P.4a-2 → P.4a-3 → P.4b → P.8。

> P.4b 排后是因为：先让 Python 端享受零手写镜像（P.4a 即刻见效）；TypeScript 端切 ajv
> 涉及 kernel 启动路径，节奏放后稳一些。

每批独立可提交、可回滚。所有批次完成后：

- protocol/ 内只有 schemas / generated / utils / index.ts —— **纯 lingua franca**
- 内核 / 认知核 / 扩展 SDK 各自健全
- 零手写镜像、零漂移、CI 守门

---

## 九、风险与缓解

| 风险 | 缓解 |
|---|---|
| `datamodel-codegen` 对复杂 oneOf 处理不完美 | 已有 `_write_py_fallback` 退化路径；遇到时具体 schema 调整为更简单的判别 union |
| 现有 IPC payload 字段名/可选性与 schema 不一致 | P.3 落地时逐字段比对；schema 必须**精确**反映现状再 codegen；不允许"顺便修语义"，那是另一个 PR |
| Zod 中 `.transform()` 等 schema 不能直接表达 | P.4a 调查使用情况；转换逻辑下沉 config-processor；无 transform 的部分先迁 |
| 扩展 SDK 独立包后扩展 import 全改 | P.6 单批落地，PR 包含全部扩展 import 调整；当前扩展数量有限（napcat-adapter 等），可控 |
| Python 侧 `ipc_server/contracts/` 改名后大量 import 失效 | P.7 单批落地；用 sed 批量改 + 跑 pytest 验证 |
| 生成产物提交 git 引起 PR diff 噪声 | 已经在跑（PerceptionEvent.ts 等已提交）；约定 PR review 时 generated/ 折叠展示 |
| CI 守门误报（如本地 codegen 输出与 CI 不一致） | 锁死 codegen 工具版本（package.json devDependencies 精确版本）+ `.checksum` 文件比对 |

---

## 十、不在本阶段范围

- **协议层语义版本号 / breaking change 协商**：月见单机部署、无多版本共存，留空白
- **protobuf / gRPC / TypeSpec 等其他方案迁移**：留作未来评估
- **扩展 SDK 公开发布到 npm registry**：当前 monorepo 内部使用，外部分发后置
- **JSON Schema 2020-12 升级**：当前 Draft-07，工具链稳定，无必要升级
- **schema 反向生成（从 Python class 反推 schema）**：不需要 —— 单向 schema → 代码就够

---

## 附：阶段 4 与本阶段的关系

阶段 4（觉醒态机）已有 v1.1 设计文档（[阶段4-觉醒态设计.md](./阶段4-觉醒态设计.md)）。
其中 §3.7 + §5.1 已经明确 `ArousalState` / `ArousalProfile` / `ArousalSnapshot` 走 schema 路径
（4.0 前置批次）。

**本阶段（P）完成后再启动阶段 4**：

- 阶段 4 的所有 schema 直接按 P.1 的新结构（`schemas/{enums,models}/`）创建
- 阶段 4 不再需要单独的 4.0 批次 —— 直接 4.1 起从 Python 代码骨架开始
- 阶段 4 v1.1 设计文档届时把 §3.7 / §5.1 / 4.0 调整为引用本文档
