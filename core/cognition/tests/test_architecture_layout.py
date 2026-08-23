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
COGNITION_PACKAGE = "glimmer_cradle.cognition"
COGNITION_ROOT = "<cognition-root>"


def _python_files(root: Path = PACKAGE_ROOT) -> list[Path]:
    return sorted(
        path
        for path in root.rglob("*.py")
        if "__pycache__" not in path.parts
    )


def _module_package(path: Path) -> str:
    relative = path.relative_to(PACKAGE_ROOT.parent.parent)
    parts = list(relative.with_suffix("").parts)
    parts.pop()
    return ".".join(parts)


def _resolve_relative(module_package: str, level: int, module: str | None) -> str:
    if level == 0:
        return module or ""
    package = module_package.split(".") if module_package else []
    keep = max(0, len(package) - level + 1)
    base = package[:keep]
    if module:
        base.extend(module.split("."))
    return ".".join(base)


def _import_candidates(tree: ast.Module, module_package: str) -> list[str]:
    """展开静态/动态 import 的完整候选，ImportFrom 不丢失 alias。"""
    result: list[str] = []
    importlib_aliases = {"importlib"}
    import_module_aliases: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name == "importlib":
                    importlib_aliases.add(alias.asname or alias.name)
        elif isinstance(node, ast.ImportFrom) and node.module == "importlib":
            for alias in node.names:
                if alias.name == "import_module":
                    import_module_aliases.add(alias.asname or alias.name)

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            result.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            module = _resolve_relative(module_package, node.level, node.module)
            for alias in node.names:
                candidate = module if alias.name == "*" else ".".join(
                    part for part in (module, alias.name) if part
                )
                if candidate:
                    result.append(candidate)
        elif isinstance(node, ast.Call) and node.args:
            is_builtin = isinstance(node.func, ast.Name) and node.func.id == "__import__"
            is_importlib_attribute = (
                isinstance(node.func, ast.Attribute)
                and isinstance(node.func.value, ast.Name)
                and node.func.value.id in importlib_aliases
                and node.func.attr == "import_module"
            )
            is_importlib_name = (
                isinstance(node.func, ast.Name)
                and node.func.id in import_module_aliases
            )
            if (
                is_builtin or is_importlib_attribute or is_importlib_name
            ) and isinstance(node.args[0], ast.Constant):
                if isinstance(node.args[0].value, str):
                    name = node.args[0].value
                    level = len(name) - len(name.lstrip("."))
                    result.append(
                        _resolve_relative(module_package, level, name[level:])
                        if level else name
                    )
    return result


def _imports(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    return _import_candidates(tree, _module_package(path))


def _cognition_root(module: str) -> str | None:
    if module == COGNITION_PACKAGE:
        return COGNITION_ROOT
    prefix = f"{COGNITION_PACKAGE}."
    if not module.startswith(prefix):
        return None
    return module.removeprefix(prefix).split(".", 1)[0]


def _is_generated_import(module: str) -> bool:
    leaf = module.rsplit(".", 1)[-1]
    return (
        any(module == root or module.startswith(f"{root}.") for root in GENERATED_PACKAGE_ROOTS)
        or leaf.endswith("_pb2")
        or leaf.endswith("_pb2_grpc")
    )


def _dependency_violations(
    tree: ast.Module,
    *,
    module_package: str,
    owner: str,
    label: str,
) -> list[str]:
    violations: list[str] = []
    for module in dict.fromkeys(_import_candidates(tree, module_package)):
        target = _cognition_root(module)
        if target and target not in ALLOWED_DEPENDENCIES[owner]:
            violations.append(f"{label}: forbidden dependency {module}")
        if owner in {"domain", "application", "ports"} and any(
            term in module for term in FORBIDDEN_BOUNDARY_TERMS
        ):
            violations.append(f"{label}: boundary concrete {module}")
        if owner in {"domain", "application", "ports"} and _is_generated_import(module):
            violations.append(f"{label}: generated package {module}")
    return violations


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
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        violations.extend(_dependency_violations(
            tree,
            module_package=_module_package(path),
            owner=owner,
            label=str(relative),
        ))
    assert violations == []


def test_generated_contract_types_exist_only_at_kernel_adapter_edge() -> None:
    consumers = []
    for path in _python_files():
        if any(_is_generated_import(module) for module in _imports(path)):
            consumers.append(path.relative_to(PACKAGE_ROOT).as_posix())
    assert consumers == ["adapters/kernel/grpc_transport.py"]


def test_ports_are_not_manufactured_inside_internal_modules() -> None:
    violations: list[str] = []
    for path in _python_files():
        relative = path.relative_to(PACKAGE_ROOT)
        owner = relative.parts[0]
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        violations.extend(_structure_violations(
            tree,
            owner=owner,
            label=str(relative),
        ))
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


def _structure_violations(
    tree: ast.Module,
    *,
    owner: str,
    label: str,
) -> list[str]:
    violations: list[str] = []
    for node in ast.walk(tree):
        if owner != "ports" and isinstance(node, ast.ClassDef) and node.name.endswith("Port"):
            violations.append(f"{label}:{node.name}")
        if isinstance(node, ast.ClassDef) and node.name in {"EventBus", "ServiceLocator"}:
            violations.append(f"{label}:{node.name}")
        if owner in {"domain", "application", "ports"} and isinstance(node, ast.Global):
            violations.append(f"{label}: module global mutation {','.join(node.names)}")
    if owner in {"domain", "application", "ports"}:
        violations.extend(
            f"{label}: module mutable binding {binding}"
            for binding in _module_mutable_bindings(tree)
        )
    return violations


def _direct_system_capabilities_tree(tree: ast.Module) -> list[str]:
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


def _direct_capability_violations(tree: ast.Module, *, label: str) -> list[str]:
    return [
        f"{label}: direct system capability {call}"
        for call in _direct_system_capabilities_tree(tree)
    ]


def test_domain_and_application_do_not_read_system_clock_or_generate_ids() -> None:
    violations = []
    for owner in ("domain", "application"):
        for path in _python_files(PACKAGE_ROOT / owner):
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            violations.extend(_direct_capability_violations(
                tree,
                label=str(path.relative_to(PACKAGE_ROOT)),
            ))
    assert violations == []


def test_import_gate_reports_alias_relative_generated_and_dynamic_violations() -> None:
    tree = ast.parse(dedent("""
        from glimmer_cradle.cognition import adapters
        from .. import adapters as relative_adapters
        from safe_package import cognition_service_pb2
        from glimmer.cognition.v1 import cognition_service_pb2 as generated_pb
        import importlib as loader
        from importlib import import_module as load_module
        loader.import_module("glimmer_cradle.cognition.adapters.hidden")
        load_module("glimmer.common.v1.service_contract_pb2")
        __import__("glimmer.kernel.v1.kernel_control_service_pb2")
    """))
    violations = _dependency_violations(
        tree,
        module_package="glimmer_cradle.cognition.application",
        owner="application",
        label="synthetic_imports.py",
    )

    for expected in (
        "glimmer_cradle.cognition.adapters",
        "safe_package.cognition_service_pb2",
        "glimmer.cognition.v1.cognition_service_pb2",
        "glimmer_cradle.cognition.adapters.hidden",
        "glimmer.common.v1.service_contract_pb2",
        "glimmer.kernel.v1.kernel_control_service_pb2",
    ):
        assert any(expected in violation for violation in violations), violations
    assert _cognition_root("glimmer_cradle.cognition") == COGNITION_ROOT
    assert _cognition_root("glimmer_cradle.cognition.adapters") == "adapters"


def test_gate_negative_samples_report_locator_clock_and_uuid() -> None:
    tree = ast.parse(dedent("""
        import datetime as dt
        from uuid import uuid4 as make_uuid
        _registry = {}
        def bind(value):
            _registry["logger"] = value
        def create():
            return _registry["logger"], dt.datetime.now(), make_uuid()
    """))
    structure_violations = _structure_violations(
        tree,
        owner="application",
        label="synthetic_locator.py",
    )
    capability_violations = _direct_capability_violations(
        tree,
        label="synthetic_locator.py",
    )
    assert structure_violations == [
        "synthetic_locator.py: module mutable binding _registry"
    ]
    assert capability_violations == [
        "synthetic_locator.py: direct system capability datetime.datetime.now",
        "synthetic_locator.py: direct system capability uuid.uuid4",
    ]
