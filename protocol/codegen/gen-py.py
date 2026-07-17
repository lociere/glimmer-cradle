"""
gen-py.py —— Schema-First Python 端 codegen

设计原则：
- 从 protocol/src/schemas/<rel>/X.schema.json 生成 Pydantic v2 模型到
  core/cognition/src/glimmer_cradle/cognition/protocol/generated/<rel>/x.py（snake_case）
- 调 datamodel-code-generator 子进程（Python 生态原生工具，从 Python 调最自然）
- config/ 子目录注入 frozen=True（配置不可篡改语义）
- --disable-timestamp 消除每次跑都改 git 的噪声
- 自动产 __init__.py 子目录与根聚合

用法：
  pnpm sync:contracts
"""
from __future__ import annotations

import re
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# Windows 控制台默认 GBK，强制 stdout/stderr 为 UTF-8
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

# 路径常量（相对本脚本所在位置，避免 cwd 依赖）
THIS_FILE = Path(__file__).resolve()
PROTOCOL_ROOT = THIS_FILE.parent.parent
REPO_ROOT = PROTOCOL_ROOT.parent
SCHEMA_DIR = PROTOCOL_ROOT / "src" / "schemas"
COGNITION_OUT_DIR = REPO_ROOT / "core" / "cognition" / "src" / "glimmer_cradle" / "cognition" / "protocol" / "generated"
AUDIO_ENGINE_OUT_DIR = REPO_ROOT / "engines" / "audio" / "src" / "glimmer_cradle" / "audio" / "generated"


def _to_snake_case(name: str) -> str:
    s1 = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1_\2", name)
    return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s1).lower()


def _iter_schemas(schema_dir: Path):
    """递归遍历所有 schema 文件，跳过隐藏目录与 .checksum。"""
    for path in sorted(schema_dir.rglob("*.schema.json")):
        if any(part.startswith(".") for part in path.relative_to(schema_dir).parts):
            continue
        yield path


def _output_root_for(schema_path: Path) -> Path:
    rel = schema_path.relative_to(SCHEMA_DIR)
    return AUDIO_ENGINE_OUT_DIR if rel.parts[:1] == ("engine",) else COGNITION_OUT_DIR


def _py_out_for(schema_path: Path) -> Path:
    rel = schema_path.relative_to(SCHEMA_DIR)
    stem = rel.stem.replace(".schema", "")
    root = _output_root_for(schema_path)
    parent = Path() if root == AUDIO_ENGINE_OUT_DIR else rel.parent
    return root / parent / f"{_to_snake_case(stem)}.py"


def _inject_frozen(py_file: Path) -> None:
    """把 ConfigDict(extra='forbid',) 替换为含 frozen=True 的形态。

    仅作用于 config/ 子目录 —— 配置一经注入运行时不可篡改（与 Pydantic 旧手写
    模型一致的 frozen 语义）。其余 schema（models / ipc / enums）保留默认可变性，
    业务代码可能要构造它们。
    """
    text = py_file.read_text(encoding="utf-8")
    new = text.replace(
        "ConfigDict(\n        extra='forbid',\n    )",
        "ConfigDict(\n        extra='forbid',\n        frozen=True,\n    )",
    )
    if new != text:
        py_file.write_text(new, encoding="utf-8")


def generate_schema_py(schema_file: Path) -> None:
    out_file = _py_out_for(schema_file)
    out_file.parent.mkdir(parents=True, exist_ok=True)
    rel_in = schema_file.relative_to(REPO_ROOT)
    source_file = schema_file
    temp_dir = None
    raw_schema = json.loads(schema_file.read_text(encoding="utf-8"))
    resolved_schema = _resolve_local_refs(raw_schema, schema_file.parent)
    if resolved_schema != raw_schema:
        temp_dir = tempfile.TemporaryDirectory(prefix="glimmer-schema-")
        source_file = Path(temp_dir.name) / schema_file.name
        source_file.write_text(
            json.dumps(resolved_schema, ensure_ascii=False), encoding="utf-8"
        )
    cmd = [
        sys.executable, "-m", "datamodel_code_generator",
        "--input", str(source_file),
        "--output", str(out_file),
        "--input-file-type", "jsonschema",
        "--output-model-type", "pydantic_v2.BaseModel",
        "--target-python-version", "3.12",
        "--use-standard-collections",
        "--use-union-operator",
        "--field-constraints",
        # enum 成员名大写（EPISODIC = 'episodic'）—— 符合 Python 惯例
        "--capitalise-enum-members",
        # 不在产物里写 timestamp —— 避免 codegen 每次跑都导致 git diff 噪声
        "--disable-timestamp",
    ]
    print(f"  [PY] {rel_in}")
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=str(REPO_ROOT))
    if temp_dir is not None:
        temp_dir.cleanup()
    if result.returncode != 0:
        raise RuntimeError(f"Python 生成失败 {schema_file.name}: {result.stderr.strip()}")

    # config/ 子目录注入 frozen=True
    if schema_file.relative_to(SCHEMA_DIR).parts[:1] == ("config",):
        _inject_frozen(out_file)


def _resolve_local_refs(value, base_dir: Path):
    """内联仓库内 Schema 引用，避免 Python 生成器按远程 ``$id`` 下载。"""
    if isinstance(value, list):
        return [_resolve_local_refs(item, base_dir) for item in value]
    if not isinstance(value, dict):
        return value
    ref = value.get("$ref")
    if isinstance(ref, str) and not ref.startswith(("#", "http://", "https://")):
        target = PROTOCOL_ROOT / Path(ref) if ref.startswith("src/schemas/") else base_dir / Path(ref)
        resolved = _resolve_local_refs(json.loads(target.read_text(encoding="utf-8")), target.parent)
        resolved.pop("$id", None)
        resolved.pop("$schema", None)
        return {**resolved, **{key: _resolve_local_refs(item, base_dir) for key, item in value.items() if key != "$ref"}}
    return {key: _resolve_local_refs(item, base_dir) for key, item in value.items()}


def generate_indices(output_dir: Path) -> None:
    """为 Python 产物目录生成 __init__.py：
       - 每个含 .py 产物的子目录写一份（re-export 该目录所有 .py）
       - 根目录聚合所有直接 .py 产物 + 各子目录
    """
    if not output_dir.exists():
        return

    subdir_inits: list[str] = []
    for sub in sorted(
        p for p in output_dir.iterdir()
        if p.is_dir() and not p.name.startswith("_") and not p.name.startswith(".")
    ):
        files = sorted(p for p in sub.iterdir() if p.is_file() and p.suffix == ".py" and p.name != "__init__.py")
        if not files:
            continue
        lines = ["# 自动生成 — 子目录契约聚合，勿手动修改"]
        for f in files:
            lines.append(f"from .{f.stem} import *  # noqa: F401,F403")
        (sub / "__init__.py").write_text("\n".join(lines) + "\n", encoding="utf-8")
        subdir_inits.append(sub.name)

    root_files = sorted(p for p in output_dir.iterdir() if p.is_file() and p.suffix == ".py" and p.name != "__init__.py")
    lines = ["# 自动生成 — 契约导出聚合，勿手动修改"]
    for f in root_files:
        lines.append(f"from .{f.stem} import *  # noqa: F401,F403")
    for sub_name in subdir_inits:
        lines.append(f"from .{sub_name} import *  # noqa: F401,F403")
    (output_dir / "__init__.py").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    if not SCHEMA_DIR.exists():
        print(f"❌ 未找到 schema 目录: {SCHEMA_DIR}", file=sys.stderr)
        sys.exit(1)
    schemas = list(_iter_schemas(SCHEMA_DIR))
    if not schemas:
        print(f"❌ 未找到任何 *.schema.json: {SCHEMA_DIR}", file=sys.stderr)
        sys.exit(1)

    print(f"📜 扫描 Schema: {SCHEMA_DIR.relative_to(REPO_ROOT)}（共 {len(schemas)} 份）")
    for output_dir in (COGNITION_OUT_DIR, AUDIO_ENGINE_OUT_DIR):
        shutil.rmtree(output_dir, ignore_errors=True)
        output_dir.mkdir(parents=True, exist_ok=True)
    print("── 生成 Python Pydantic 模型 ──")
    for sch in schemas:
        generate_schema_py(sch)
    print("── 生成索引文件 ──")
    generate_indices(COGNITION_OUT_DIR)
    generate_indices(AUDIO_ENGINE_OUT_DIR)
    print("✅ Python 契约同步完成")


if __name__ == "__main__":
    main()
