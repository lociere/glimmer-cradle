# Avatar、Unity 与具身展示

适用：身体语义、动作/视线/口型、C#/Unity/Cubism、Renderer、透明合成和资产生命周期。
从 [当前实现](../../../../docs/architecture/implementation/Desktop与Avatar实现.md)、[开发指南](../../../../docs/how-to/桌面与Avatar开发.md)
和实际 C# csproj/asmdef、Host scripts、模型 catalog、IDL 选择入口。

## 实施判断

当前 Avatar Core 与 Unity Host 的程序集边界继续有效；目标具身语义归 TS Embodiment、具体渲染归外部 Renderer Extension。
先检查当前 consumer 和行为等价门，不能以“官方本体”或“第三方”单独决定终态 owner。
角色模型/声音/动作资产的身份归 profile；Core 不包含 Cubism 参数、Unity 对象或本机句柄。

身体意图、传输接纳、实际资源载入、首帧 present、交互准备与播放回执分别判断。
动作、视线、口型投影包含有效期/顺序/世代；重连/取消/替换模型后旧帧不得继续表现。
无 Renderer 时文本仍可按真实条件可用，状态明确降级。

生成 DTO 仅在传输 adapter 映射，不能进入 C# 领域。程序集依赖、SDK 包投影与白名单通过真实构建核验；
SDK/Cubism 版本、许可和本地供应包从 manifest/本机材料查证，不下载、提交或复制私有资产。
材质、纹理、mesh、Native handle、listener 和帧循环有释放 owner；频繁换模型要检查内存/GPU/事件重复。

## 验证

先核对 `avatar:doctor`、`avatar:projector:test`、C# tests 和实际 build 脚本依赖/输出。
doctor 只证明投影条件，mock 首帧不证明渲染。受影响范围覆盖缺资源、错误包、重复切换、首帧/动作/口型、
隐藏/恢复、断连、退出，必要时核验透明命中、DPI、多屏和安装态。
构建产生的许可证受限 SDK、模型和大资产不进入 Git。

现有路径的删除须通过 C#→TS 语义等价、实际 consumer 切换及新 Renderer 的真实构建/展示门；
将未完成目标保留在 initiative，不能用结构测试替代迁移完成。
