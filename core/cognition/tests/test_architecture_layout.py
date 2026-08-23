"""M12 Slice 4 的 Cognition 物理布局与依赖方向门。"""

from __future__ import annotations

import ast
from pathlib import Path
from textwrap import dedent


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
GENERATED_PACKAGE_ROOTS = (
    "glimmer.common.v1",
    "glimmer.cognition.v1",
    "glimmer.kernel.v1",
)


def _python_files(root: Path = PACKAGE_ROOT) -> list[Path]:
    return sorted(
        path
        for path in root.rglob("*.py")
        if "__pycache__" not in path.parts
    )


def _module_package(path: Path) -> str:
    relative = path.relative_to(PACKAGE_ROOT.parent.parent)
    parts = list(relative.with_suffix("").parts)
    if parts[-1] == "__init__":
        parts.pop()
    else:
        parts.pop()
    return ".".join(parts)


def _resolve_from(path: Path, node: ast.ImportFrom) -> str:
    if node.level == 0:
        return node.module or ""
    package = _module_package(path).split(".")
    keep = len(package) - node.level + 1
    base = package[:max(0, keep)]
    if node.module:
        base.extend(node.module.split("."))
    return ".".join(base)


def _imports(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    result: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            result.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            module = _resolve_from(path, node)
            if module:
                result.append(module)
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
            if owner in {"domain", "application", "ports"} and module.startswith(
                GENERATED_PACKAGE_ROOTS
            ):
                violations.append(f"{relative}: generated package {module}")
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
        owner = relative.parts[0]
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if owner != "ports" and isinstance(node, ast.ClassDef) and node.name.endswith("Port"):
                violations.append(f"{relative}:{node.name}")
            if isinstance(node, ast.ClassDef) and node.name in {"EventBus", "ServiceLocator"}:
                violations.append(f"{relative}:{node.name}")
            if owner in {"domain", "application", "ports"} and isinstance(node, ast.Global):
                violations.append(f"{relative}: module global mutation {','.join(node.names)}")
        if owner in {"domain", "application", "ports"}:
            for binding in _module_mutable_bindings(tree):
                violations.append(f"{relative}: module mutable binding {binding}")
    assert violations == []


def _module_mutable_bindings(tree: ast.Module) -> list[str]:
    """识别模块级容器被函数写入的 locator/registry 实际模式。"""
    module_names: set[str] = set()
    for statement in tree.body:
        if not isinstance(statement, (ast.Assign, ast.AnnAssign)):
            continue
        value = statement.value
        is_mutable = isinstance(value, (ast.Dict, ast.List, ast.Set)) or (
            isinstance(value, ast.Call)
            and isinstance(value.func, ast.Name)
            and value.func.id in {"dict", "list", "set"}
        )
        if not is_mutable:
            continue
        targets = statement.targets if isinstance(statement, ast.Assign) else [statement.target]
        module_names.update(target.id for target in targets if isinstance(target, ast.Name))

    mutated: set[str] = set()
    mutating_methods = {"add", "append", "clear", "discard", "extend", "pop", "remove", "setdefault", "update"}
    for node in ast.walk(tree):
        if isinstance(node, ast.Subscript) and isinstance(node.ctx, (ast.Store, ast.Del)):
            if isinstance(node.value, ast.Name) and node.value.id in module_names:
                mutated.add(node.value.id)
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            if (
                isinstance(node.func.value, ast.Name)
                and node.func.value.id in module_names
                and node.func.attr in mutating_methods
            ):
                mutated.add(node.func.value.id)
    return sorted(mutated)


def _direct_system_capabilities(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    aliases: dict[str, str] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                aliases[alias.asname or alias.name.split(".")[0]] = alias.name
        elif isinstance(node, ast.ImportFrom) and node.module:
            for alias in node.names:
                aliases[alias.asname or alias.name] = f"{node.module}.{alias.name}"
    forbidden_calls = {
        "datetime.datetime.now", "datetime.datetime.utcnow", "datetime.date.today",
        "time.time", "time.time_ns", "time.monotonic", "uuid.uuid1", "uuid.uuid4",
        "uuid.uuid5",
    }
    violations: list[str] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        parts: list[str] = []
        value = node.func
        while isinstance(value, ast.Attribute):
            parts.append(value.attr)
            value = value.value
        if isinstance(value, ast.Name):
            parts.append(value.id)
        if not parts:
            continue
        parts.reverse()
        resolved = ".".join(parts)
        root = parts[0]
        if root in aliases:
            resolved = ".".join([aliases[root], *parts[1:]])
        if resolved in forbidden_calls:
            violations.append(resolved)
    return violations


def test_domain_and_application_do_not_read_system_clock_or_generate_ids() -> None:
    violations = []
    for owner in ("domain", "application"):
        for path in _python_files(PACKAGE_ROOT / owner):
            for call in _direct_system_capabilities(path):
                violations.append(f"{path.relative_to(PACKAGE_ROOT)}: {call}")
    assert violations == []


def test_import_gate_covers_static_and_literal_dynamic_imports(tmp_path: Path) -> None:
    sample = PACKAGE_ROOT / "application" / "_architecture_gate_sample.py"
    sample.write_text(
        "import illegal.static\n"
        "from illegal.export import value\n"
        "import importlib\n"
        "importlib.import_module('illegal.dynamic')\n"
        "__import__('illegal.builtin')\n"
        "from ..adapters import forbidden_adapter\n"
        "from glimmer.cognition.v1 import cognition_service_pb2\n",
        encoding="utf-8",
    )
    try:
        assert _imports(sample) == [
            "illegal.static", "illegal.export", "importlib",
            "glimmer_cradle.cognition.adapters", "glimmer.cognition.v1",
            "illegal.dynamic", "illegal.builtin",
        ]
    finally:
        sample.unlink()


def test_gate_negative_samples_cover_locator_clock_and_uuid(tmp_path: Path) -> None:
    sample = tmp_path / "negative.py"
    sample.write_text(dedent("""
        import datetime as dt
        from uuid import uuid4 as make_uuid
        _registry = {}
        def bind(value):
            _registry["logger"] = value
        def create():
            return _registry["logger"], dt.datetime.now(), make_uuid()
    """), encoding="utf-8")
    tree = ast.parse(sample.read_text(encoding="utf-8"))
    assert _module_mutable_bindings(tree) == ["_registry"]
    assert _direct_system_capabilities(sample) == [
        "datetime.datetime.now", "uuid.uuid4",
    ]
