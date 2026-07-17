# Python 环境指南

月见现在不止一个 Python 子项目。每个 Python 子项目都应该拥有自己的 `.venv`，不要在仓库根目录创建统一虚拟环境。

## 环境边界

| 子项目 | 虚拟环境 | 职责 |
|---|---|---|
| `core/cognition/` | `core/cognition/.venv/` | Cognition 认知核：人格、记忆、推理、认知循环 |
| `engines/audio/` | `engines/audio/.venv/` | 官方音频引擎：Piper / FunASR / GPT-SoVITS / CosyVoice |
| `engines/vision/`（未来） | `engines/vision/.venv/` | 视觉识别与多模态预处理 |

根目录终端默认不激活任何 Python 环境。根目录主要作为 `pnpm` workspace 与项目调度入口。

## 创建环境

Cognition：

```powershell
cd core/cognition
uv venv .venv --python 3.12 --prompt glimmer-cradle-cognition-core
uv sync --extra dev
```

音频引擎：

```powershell
cd engines/audio
uv venv .venv --python 3.12 --prompt glimmer-cradle-audio
uv sync --extra dev
```

FunASR 这类重依赖只装进音频引擎环境：

```powershell
cd engines/audio
uv pip install funasr modelscope
```

## 激活

PowerShell：

```powershell
cd core/cognition
.\.venv\Scripts\Activate.ps1
```

或：

```powershell
cd engines/audio
.\.venv\Scripts\Activate.ps1
```

期望看到的提示名：

```text
(glimmer-cradle-cognition-core)
(glimmer-cradle-audio)
```

## VS Code

工作区设置关闭了 `python.terminal.activateEnvironment`。这样打开根目录终端时不会自动进入 Cognition 环境，避免把音频、视觉等子项目依赖误装到认知核里。

如果需要运行某个 Python 子项目，进入该目录后使用对应的 `uv run`：

```powershell
cd core/cognition
uv run pytest -q

cd ..\..\engines\audio
uv run pytest -q
```

## 命名规则

- Python 包名可以保持发布语义，例如 `glimmer-cradle-cognition-core`、`glimmer-cradle-audio-engine`。
- venv prompt 使用人能一眼看懂的运行域名：`glimmer-cradle-cognition-core`、`glimmer-cradle-audio`。
- 命令入口应避免旧术语；认知核入口使用 `cognition-core`，不要再新增 `glimmer-cradle-core` 这类旧命名。
