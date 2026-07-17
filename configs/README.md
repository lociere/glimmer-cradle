# Glimmer Cradle 配置目录

本目录是 Glimmer Cradle 运行配置的单一入口。目录代表架构层，文件代表职责面；不要把不相关的配置项继续塞进同一个大 YAML。

## 目录结构

```text
configs/
├── system/
│   ├── identity.yaml        # 应用身份、当前角色与备份策略
│   ├── kernel.yaml          # IPC、生命周期、入站治理
│   ├── avatar.yaml          # Avatar 与 UnityAvatarHost
│   ├── surfaces.yaml        # 产品控制表面网关
│   ├── skills.yaml          # Skill Plane、MCP Server、用户技能入口
│   ├── memory.yaml          # 记忆运行时参数
│   ├── embedding.yaml       # 可选语义向量增强与 provider
│   ├── audio.yaml           # TTS/ASR 路由、provider 与资源策略
│   └── observability.yaml   # 日志、trace、模型调用观测、保留期、index、bundle
├── characters/
│   └── selrena/
│       ├── character.manifest.yaml # 角色包身份、persona mode 与目录声明
│       ├── profile.yaml         # Character Package 作者人格种子
│       ├── dialogue.yaml        # 对话呈现策略
│       ├── safety.yaml          # 红线和安全边界
│       ├── assets/              # 角色包私有资产占位
│       ├── knowledge/
│       │   ├── index.yaml       # Knowledge Vault 索引
│       │   └── *.md             # 外部知识资料正文
│       ├── migrations/          # 角色包迁移脚本占位
│       ├── inference.yaml       # 角色推理、注意力、上下文与多模态策略
│       ├── voice.yaml           # 角色声音身份、表达策略与 provider 声线绑定
│       └── providers.yaml       # LLM provider 路由，API key 由 secrets 注入
├── extensions/
│   ├── active.yaml          # 当前激活扩展的 ID + 精确版本
│   └── <extension-id>.yaml  # 每个扩展自己的私有配置
└── secrets/
    ├── secrets.example.yaml # 敏感配置模板，可提交
    └── secrets.yaml         # 本机真实密钥，不提交
```

## 分区规则

`system/` 只放 Kernel 与桌面运行时的系统面。它不负责人格、prompt、世界知识和真实密钥。`system/identity.yaml` 的 `character.active_id` 只选择当前角色 profile，不承载角色设定正文。
`system/skills.yaml` 是 Skill Plane 的外部 provider 配置入口，当前承载 MCP Server 连接声明与用户技能入口开关；它不放扩展宿主沙箱配置，也不放 LLM provider。
`system/embedding.yaml` 是可选语义向量增强的系统事实源。默认关闭时，词项、时间、显著度、置信度和关系召回仍构成完整的最小运行形态；启用后显式选择一个云端或本地 provider。

`characters/<character-id>/` 放该角色的 Character Package、推理策略、模型 provider 和 Knowledge Vault。`character.manifest.yaml` 声明角色包身份、`persona_mode` 和目录；`profile.yaml` 承载作者写定的人格种子；`dialogue.yaml` 承载对外回复呈现策略；`safety.yaml` 承载红线和边界；`knowledge/index.yaml` 只索引外部知识和世界事实的 Markdown 正文。

`extensions/` 是扩展装载面。`active.yaml` 以 `{ id, version }` 精确选择 `data/packages/extensions/<id>/<version>/` 中的一个已安装版本；每个 `<extension-id>.yaml` 只属于该扩展自己。

`secrets/` 是本体敏感信息分区。`secrets.example.yaml` 只提供空值槽位；真实 token 只进本机 `secrets.yaml` 或环境变量，普通配置只保留 provider、模型和 env 引用。扩展密钥不并入本体模板，由扩展自己的公开配置与授权边界负责。

## 格式与事实源原则

Glimmer Cradle 当前是本地客户端优先的桌面应用，`configs/` 里的文件是**本地配置事实源**。Control Center 后续可以提供设置界面，但 UI 写入的目标仍是这些结构化配置文件，而不是另建一套隐藏状态。

- **人维护的本地配置优先 YAML**：适合注释、diff、手工排障和版本管理。
- **知识资料正文用 Markdown**：`knowledge/index.yaml` 只做索引，知识正文放入同目录 `*.md`，便于作者维护和审阅。
- **运行时消费冻结投影**：Kernel 只把 YAML/JSON 解析、归一化、schema 校验后的 `GlobalConfig` 传给各层；业务代码不直接依赖原始文件格式。
- **跨进程与 API 只传 JSON 结构**：IPC、HTTP、WebSocket、云端同步都传 schema 约束后的 JSON 数据，不在线路上发送 YAML。
- **未来无客户端 / 云端形态使用配置服务**：云端部署时，事实源应迁移为数据库或配置服务；YAML 只作为导入、导出、bootstrap 和开发模板。业务层仍只消费同一份 schema 校验后的配置投影。

## 加载顺序

Kernel `ConfigManager` 启动时读取多个文件并组合为一个冻结后的运行时投影：

1. `system/identity.yaml`
2. `system/kernel.yaml`
3. `system/surfaces.yaml`
4. `system/skills.yaml`
5. `system/memory.yaml`
6. `system/observability.yaml`：日志级别、trace/metrics、模型调用观测 capture mode、retention、`observability.db` 索引与诊断 bundle 导出策略
7. `system/audio.yaml`
8. `system/embedding.yaml`
9. `characters/<active-id>/character.manifest.yaml`
10. `characters/<active-id>/profile.yaml`
11. `characters/<active-id>/dialogue.yaml`
12. `characters/<active-id>/safety.yaml`
13. `characters/<active-id>/inference.yaml`
14. `characters/<active-id>/voice.yaml`
15. `characters/<active-id>/providers.yaml`
16. `secrets/secrets.yaml` 注入 LLM、Embedding 与 Audio API Key
17. `characters/<active-id>/knowledge/index.yaml` 按需加载，并读取 `knowledge/*.md`
18. `extensions/active.yaml`
19. `extensions/<extension-id>.yaml`

## 维护规则

1. 新配置优先放入已有职责面；只有出现新的架构职责，才新增文件。
2. 修改配置结构时，同步更新 protocol schema、ConfigManager、默认模板和本文档。
3. 人维护的配置优先 YAML；机器摄入的大型结构化条目可用 JSON；跨进程传输与云端 API 使用 JSON 结构。
4. 禁止恢复历史单文件配置入口或旧目录壳；架构升级必须同步落地文件名、目录结构、Schema、加载代码、默认生成和测试。
5. 真实密钥永远不入 git。
