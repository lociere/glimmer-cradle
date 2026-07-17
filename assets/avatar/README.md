# Avatar Assets

本目录只向 Git 提交 Avatar Package、动作、行为和情绪映射的公开 Schema。Live2D 模型、贴图、动作、音频、预览图、第三方 SDK 及其本机投影均不属于源码仓库。

本机 Avatar Package 放在：

```text
assets/avatar/
├── avatar-packages/<package-id>/avatar-package.json
└── <asset-root>/...
```

`avatar-package.json` 必须符合 `avatar-packages.schema.json`，并只引用 `assets/` 边界内的本机资源。基础源码构建允许没有 Avatar Package，此时 Desktop 将 Avatar 能力解释为未安装；`pnpm avatar:build` 属于专项构建，要求本机已经准备完整模型、Unity 工程和相应 SDK。

私有或第三方资源不得通过 `git add -f` 绕过本目录的忽略规则。发行前还必须核对模型、SDK、字体、音频和预览图的再分发许可证。
