# Extension Template

这是 Glimmer Cradle 的通用扩展模板。它只展示 Extension 环境本身：manifest、配置、命令注册和生命周期释放。平台 I/O、外部进程、协议适配、感知注入、出站动作和扩展私有存储都是可选能力，不应出现在每个扩展模板的默认结构里。

## 默认结构

- `extension-manifest.yaml`：扩展身份、权限、宿主端口、激活条件和贡献点。
- `package.json` / `tsconfig.json`：构建入口。
- `gcex.package.yaml`：声明进入 `.gcex` 的显式 payload；SDK 自动生成摘要、包元数据与 SPDX SBOM。
- `index.ts`：扩展入口，只导出 `defineExtension(...)`。
- `config/schema.ts`：普通配置 schema，不包含密钥。
- `src/my-extension.ts`：composition root，展示命令、配置和生命周期。

## 默认边界

- Extension 是生态单元，不是 adapter、tool、view 或外部进程的同义词。
- 默认模板不创建 `protocol`、`inbound`、`outbound`、`dependencies` 目录；只有在扩展确实需要对应职责时再新增。
- `requires` 表示需要 Host 注入哪些 Port；`permissions` 表示受保护 API 的授权边界。
- `audience` 表示能力暴露对象；模板命令是 `user` 管理动作，只有显式 `character` 的 `glimmer.skill` 才能进入人物 Skill catalog。
- `scope` 表示全局、来源、场景或会话可见范围；`requirements` 表示产品、平台与功能前提。模板显式写出两者，避免把 Desktop-only 能力错误暴露给 Personal Server。
- 所有订阅、计时器、连接、文件句柄和注册项必须由 `BaseExtension` 托管或手动加入 `subscriptions`。
- 模板默认不依赖 storage、perception、network 或 process；确实需要时再声明对应 Port 与权限。

## 可选形态

平台协议接入扩展可以按需增加：

```text
src/protocol/      平台 payload 清洗和协议类型
src/inbound/       标准感知或事件注入
src/outbound/      受控平台动作
src/connection/    WebSocket、HTTP、stdio 等连接协调
```

需要第三方包、外部进程、本地服务、设备或协议连接时，不新增 manifest 顶层字段；在 `contributes` 中向对应 contribution point 声明。官方内建的受管资源使用 `glimmer.managedResource`，声明不等于静默下载，也不等于自动授权：

```yaml
contributes:
  glimmer.managedResource:
    - id: example-service
      displayName: Example Service
      audience: host
      scope:
        kind: global
      requirements:
        products: [any]
        platforms: [any]
        features: [extensions]
      kind: localService
      required: false
      readinessGates:
        - kind: readiness
          type: http
          endpoint: http://127.0.0.1:8080/health
          timeoutMs: 3000
```

## 完成检查

- manifest、配置 schema、运行期注册项和实际 handler 一致。
- 未使用的权限不声明；使用受保护 API 前确认权限存在。
- 密钥只走 `configs/secrets/` 或环境变量。
- 停用后没有旧订阅、旧 handler、旧连接或旧计时器残留。
- 普通发布只上传一个规范命名的 `.gcex`。多平台、channel 或下载前摘要绑定场景才由作者在自己的 Release 额外上传 `release-manifest.json` 与可选签名/构建证明；Registry 只保存审核结果和作者侧来源指针，不保存这些文件。
