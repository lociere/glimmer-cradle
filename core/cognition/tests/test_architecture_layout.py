"""M12 Slice 4 的 Cognition 物理布局与依赖方向门。"""

from __future__ import annotations

import ast
from pathlib import Path


PACKAGE_ROOT = (
    Path(__file__).parents[1]
    / "src"
    / "glimmer_cradle"
    / "cognition"
)
TARGET_ROOTS = {"domain", "application", "ports", "adapters", "host"}
LEGACY_ROOTS = {
    "activity", "affect", "context", "conversation", "cycle", "experience",
    "foundation", "identity", "inference", "maintenance", "memory",
    "observability", "persona", "protocol",
}
ALLOWED_DEPENDENCIES = {
    "domain": {"domain", "ports"},
    "application": {"domain", "application", "ports"},
    # inbound Port 使用 application command/result 类型描述调用契约。
    "ports": {"domain", "application", "ports"},
    "adapters": {"domain", "application", "ports", "adapters"},
    "host": TARGET_ROOTS,
}
FORBIDDEN_BOUNDARY_TERMS = (
    ".protocol.generated",
    "google.protobuf",
    "grpc",
    "_pb2",
    "node_modules",
)


def _python_files(root: Path = PACKAGE_ROOT) -> list[Path]:
    return sorted(
        path
        for path in root.rglob("*.py")
        if "__pycache__" not in path.parts
    )


def _imports(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    result: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            result.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            result.append(node.module)
        elif isinstance(node, ast.Call) and node.args:
            is_builtin = isinstance(node.func, ast.Name) and node.func.id == "__import__"
            is_importlib = (
                isinstance(node.func, ast.Attribute)
                and isinstance(node.func.value, ast.Name)
                and node.func.value.id == "importlib"
                and node.func.attr == "import_module"
            )
            if (is_builtin or is_importlib) and isinstance(node.args[0], ast.Constant):
                if isinstance(node.args[0].value, str):
                    result.append(node.args[0].value)
    return result


def _cognition_root(module: str) -> str | None:
    prefix = "glimmer_cradle.cognition."
    if not module.startswith(prefix):
        return None
    return module.removeprefix(prefix).split(".", 1)[0]


def test_only_target_roots_contain_cognition_source() -> None:
    actual = {
        path.relative_to(PACKAGE_ROOT).parts[0]
        for path in _python_files()
        if path != PACKAGE_ROOT / "__init__.py"
    }
    assert actual == TARGET_ROOTS
    assert not (actual & LEGACY_ROOTS)


def test_domain_application_and_ports_dependency_direction() -> None:
    violations: list[str] = []
    for path in _python_files():
        relative = path.relative_to(PACKAGE_ROOT)
        owner = relative.parts[0] if len(relative.parts) > 1 else None
        if owner not in ALLOWED_DEPENDENCIES:
            continue
        for module in _imports(path):
            target = _cognition_root(module)
            if target and target not in ALLOWED_DEPENDENCIES[owner]:
                violations.append(f"{relative}: {module}")
            if owner in {"domain", "application", "ports"} and any(
                term in module for term in FORBIDDEN_BOUNDARY_TERMS
            ):
                violations.append(f"{relative}: boundary concrete {module}")
    assert violations == []


def test_generated_contract_types_exist_only_at_kernel_adapter_edge() -> None:
    consumers = []
    for path in _python_files():
        if any(
            term in module
            for module in _imports(path)
            for term in ("google.protobuf", "_pb2")
        ):
            consumers.append(path.relative_to(PACKAGE_ROOT).as_posix())
    assert consumers == ["adapters/kernel/grpc_transport.py"]


def test_ports_are_not_manufactured_inside_internal_modules() -> None:
    violations: list[str] = []
    for path in _python_files():
        relative = path.relative_to(PACKAGE_ROOT)
        if relative.parts[0] == "ports":
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef) and node.name.endswith("Port"):
                violations.append(f"{relative}:{node.name}")
            if isinstance(node, ast.ClassDef) and node.name in {"EventBus", "ServiceLocator"}:
                violations.append(f"{relative}:{node.name}")
    assert violations == []


def test_import_gate_covers_static_and_literal_dynamic_imports(tmp_path: Path) -> None:
    sample = tmp_path / "imports.py"
    sample.write_text(
        "import illegal.static\n"
        "from illegal.export import value\n"
        "import importlib\n"
        "importlib.import_module('illegal.dynamic')\n"
        "__import__('illegal.builtin')\n",
        encoding="utf-8",
    )
    assert _imports(sample) == [
        "illegal.static",
        "illegal.export",
        "importlib",
        "illegal.dynamic",
        "illegal.builtin",
    ]
