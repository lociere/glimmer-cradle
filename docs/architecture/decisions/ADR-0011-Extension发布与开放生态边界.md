# ADR-0011 Extension 发布与开放生态边界

- 状态：accepted
- 日期：2026-07-16

## 背景

扩展既要支持官方审核目录，也要允许社区作者在自己的仓库独立发布。若 Registry 同时托管源码、制品、SBOM 或复制 manifest，它会成为生态单点、形成多份事实源，并让未收录扩展失去完整供应链信息。若 Host 直接运行仓库源码或任意 ZIP，又无法提供稳定安装、权限确认、回滚和路径安全。

## 决策

1. 扩展 ID 强制采用 `publisher.extension`；发布者命名空间是跨仓库稳定身份，不绑定 Git 平台账号。
2. 唯一安装制品是标准 `.gcex`。`extension/` 保存显式 payload，`META-INF/` 保存包元数据、全量摘要和包内 SPDX 2.3 SBOM。
3. `.gcex` 是唯一必需发布物。普通单平台或通用扩展只发布一个规范命名的 `.gcex`；多平台、发布通道、下载前摘要绑定等远程分发需求才由作者按需发布 `release-manifest.json`。签名与构建证明同样是作者侧可选 sidecar。
4. `release-manifest.json` 是发布级索引，不是安装包组成部分。它包含整个 `.gcex` 的大小和摘要，不能嵌入被摘要的归档自身；SDK 必须把包构建与发布索引构建作为两个显式步骤。
5. 支持 Registry、Release Manifest URL、仓库精确 Release tag 和本地 `.gcex` 四种来源；它们必须汇入同一个 Kernel Package Manager 和同一验证策略。仓库 Release 优先使用作者提供的 Release Manifest；缺失时只接受与当前平台唯一匹配的规范命名 `.gcex`。
6. Registry 与第一方扩展源码可以共用 `glimmer-cradle-extensions` 仓库和 CI，但保持独立目录与职责。Registry 只保存身份、所有权、仓库、审核/安全状态和作者侧发布来源指针，不托管或复制第三方源码、`.gcex`、Release Manifest、SBOM、签名或构建证明。
7. Registry 审核、发布者验证、制品签名和构建证明是四个独立信任信号。任何一个信号都不能伪装成另外一个。
8. 安装采用准备与提交事务。Kernel 在用户确认权限前后各验证一次，使用不可变版本目录和原子替换；激活选择由 Kernel 唯一写入。
9. Desktop 可通过系统文件选择器安装本地包；Personal Server 的浏览器入口禁止提交服务器本地路径，但允许认证后的浏览器把受限 `.gcex` 字节流上传到 Product Host owned 的临时目录，并换取只对当前 principal/session、有限时效和单次安装事务有效的 opaque `upload_id`。Host 在 `prepare/commit/cancel` 事务内把 `upload_id` 解析为受控文件 source 后再调用 Kernel Package Manager；上传必须校验扩展名/格式、大小上限、唯一临时文件名和路径边界，并在 prepare 完成、取消、失败或超时后清理文件与事务状态。

## 结果

- 未进入官方 Registry 的社区扩展仍能完整发布、安装、携带 SBOM 并接受同等包安全校验。
- 普通作者只需维护自己的源码仓库和一个 `.gcex` Release 资产；高级发布元数据不会成为生态准入门槛。
- Registry 提供发现和审核价值，但不成为源码托管、制品 CDN 或供应链事实源。
- 发布者可以迁移 Git 托管平台而不改变扩展身份；用户可固定精确版本并保留多个已安装版本。
- 直接安装不会获得 `listing_reviewed` 或 `publisher_verified` 信号，UI 必须如实展示，而不是阻断开放生态。

## 验证

- SDK 构建的 `.gcex` 必含 `extension-manifest.yaml`、`gcex.json`、`checksums.json` 和 `sbom.spdx.json`。
- `buildGcexPackage()` 不产生包外 JSON；只有显式调用 `buildExtensionReleaseManifest()` 才生成作者侧发布索引。
- Registry validator 拒绝非命名空间 ID、复制 manifest 字段、非 HTTPS 清单和无审核依据的已发布通道。
- SDK 包测试覆盖路径穿越、膨胀/文件数上限、摘要不符、SBOM 缺失与确定性构建；Kernel Package Manager 测试覆盖权限确认、HTTPS 重定向、原子安装、重复安装和激活版本卸载保护。
- Desktop 与 Personal Server 通过 Protocol Schema 发送同一安装事务，Renderer/浏览器不直接写安装目录、active config、服务器文件路径或临时目录。
