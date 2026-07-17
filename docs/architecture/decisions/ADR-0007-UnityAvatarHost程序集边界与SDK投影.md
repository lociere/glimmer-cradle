# ADR-0007：UnityAvatarHost 程序集边界与 SDK 投影

- 状态：accepted
- 日期：2026-07-13

## 背景

Unity 在执行 `-importPackage` 前会先编译工程脚本。项目脚本已经引用 Cubism 时，干净工程因缺少 SDK 无法进入导入阶段，形成“必须先编译才能安装编译依赖”的启动环。原有 `Domain / Application / Infrastructure / Host` 目录也没有程序集约束，Application 反向引用 Host、Infrastructure 与 Host 双向引用仍能被默认程序集掩盖。

## 决策

1. `data/packages/avatar-sdks/` 保存本机第三方供应包，Unity 工程中的 `Assets/Live2D` 只是可重建投影。
2. `.unitypackage` 在 Unity 启动前由 `unitypackage-projector.mjs` 解析；catalog 用 `projectionScopes` 分别授权目录树和精确单文件，未声明路径、链接条目和越界路径一律拒绝。
3. 投影保留供应包 `.meta` GUID，以 SDK 版本、供应包 SHA-256、投影范围和投影器版本生成有效性戳。有效性戳在重建前先失效，完成后才原子写入。
4. Unity 项目代码拆为 `GlimmerCradle.Avatar.Contracts`、`Domain`、`Application`、`Infrastructure`、`Host` 和 `Editor` 六个 Assembly Definition，依赖方向固定为：

```text
Contracts ───────> Application ──┐
Domain ──────────> Application   ├─> Host ─> Editor
Domain ──────────> Infrastructure┘
Live2D.Cubism ───> Infrastructure
```

5. Contracts 只保存 Host 帧模型；Domain 不读取文件；Application 不拥有 Unity Host 生命周期；Infrastructure 负责 Cubism 和模型资产读取；Host 负责协议、Unity 生命周期、合成与组装。
6. 不保留 Unity 原生 `-importPackage` 首次安装入口、手工 SDK 复制说明或默认程序集兼容路径。

## 结果

- 干净工程可以先投影依赖再进入 Unity 编译，首次构建和增量构建使用同一条确定性链路。
- 第三方包不能借 SDK 安装写入任意工程资产路径，中断投影不会被误判为完整安装。
- 目录职责由编译器强制，跨层反向引用会在 Unity 构建时失败。
- SDK 升级需要同步 catalog 版本、投影范围和实际 Windows Player 构建验证。

## 验证

```powershell
pnpm avatar:projector:test
pnpm avatar:doctor
pnpm avatar:build
```
