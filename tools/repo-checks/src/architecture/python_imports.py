"""Parse Python source for architecture checks without importing product code."""

import ast
import json
import re
import sys


COGNITION_PREFIX = "core/cognition/src/glimmer_cradle/cognition/"
COGNITION_OWNERS = {
    "attention", "context", "inference", "knowledge", "loop", "memory",
    "perception", "persona", "planning", "ports", "state",
}


def cognition_architecture(tree, file):
    if not file.startswith(COGNITION_PREFIX):
        return []
    relative = file.removeprefix(COGNITION_PREFIX)
    owner = relative.split("/", 1)[0]
    if owner not in COGNITION_OWNERS:
        return []

    findings = []
    module_mutables = {}
    for statement in tree.body:
        if not isinstance(statement, (ast.Assign, ast.AnnAssign)):
            continue
        value = statement.value
        mutable = isinstance(value, (ast.Dict, ast.List, ast.Set)) or (
            isinstance(value, ast.Call)
            and isinstance(value.func, ast.Name)
            and value.func.id in {"dict", "list", "set"}
        )
        if not mutable:
            continue
        targets = statement.targets if isinstance(statement, ast.Assign) else [statement.target]
        for target in targets:
            if isinstance(target, ast.Name):
                module_mutables[target.id] = statement.lineno

    mutated = set()
    mutating_methods = {
        "add", "append", "clear", "discard", "extend", "pop", "remove",
        "setdefault", "update",
    }
    aliases = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                aliases[alias.asname or alias.name.split(".")[0]] = alias.name
        elif isinstance(node, ast.ImportFrom) and node.module:
            for alias in node.names:
                aliases[alias.asname or alias.name] = f"{node.module}.{alias.name}"
        if isinstance(node, ast.Subscript) and isinstance(node.ctx, (ast.Store, ast.Del)):
            if isinstance(node.value, ast.Name) and node.value.id in module_mutables:
                mutated.add(node.value.id)
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            if (
                isinstance(node.func.value, ast.Name)
                and node.func.value.id in module_mutables
                and node.func.attr in mutating_methods
            ):
                mutated.add(node.func.value.id)
        if isinstance(node, ast.Global):
            findings.append({
                "rule": "module-global",
                "detail": ",".join(node.names),
                "line": node.lineno,
            })
        if (
            isinstance(node, ast.ClassDef)
            and node.name.endswith("Port")
            and owner != "ports"
            and not (owner == "inference" and relative.endswith("model_port.py"))
        ):
            findings.append({
                "rule": "internal-port",
                "detail": node.name,
                "line": node.lineno,
            })

    if owner != "ports":
        for name in sorted(mutated):
            findings.append({
                "rule": "module-mutable",
                "detail": name,
                "line": module_mutables[name],
            })

    if owner != "ports":
        forbidden_calls = {
            "datetime.datetime.now", "datetime.datetime.utcnow", "datetime.date.today",
            "time.time", "time.time_ns", "time.monotonic", "uuid.uuid1", "uuid.uuid4",
            "uuid.uuid5",
        }
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            parts = []
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
            if parts[0] in aliases:
                resolved = ".".join([aliases[parts[0]], *parts[1:]])
            if resolved in forbidden_calls:
                findings.append({
                    "rule": "direct-system-capability",
                    "detail": resolved,
                    "line": node.lineno,
                })
    return findings


def parse_source(item):
    tree = ast.parse(item["text"], filename=item["file"])
    parts = item["file"].removesuffix(".py").split("/")
    parts = parts[parts.index("src") + 1:] if "src" in parts else parts
    package = parts[:-1]
    module = ".".join(package if parts[-1] == "__init__" else parts)
    imports, vendors = [], []
    pattern = re.compile(r"QQ|Discord|Telegram|VRChat|Live2D|OpenAI|Anthropic|Gemini|GitHub|CosyVoice|FunASR", re.I)
    docstrings = {
        id(node.body[0].value)
        for node in ast.walk(tree)
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef))
        and node.body and isinstance(node.body[0], ast.Expr)
        and isinstance(node.body[0].value, ast.Constant)
        and isinstance(node.body[0].value.value, str)
    }
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend({"value": alias.name, "line": node.lineno} for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            base = node.module or ""
            if node.level:
                base = ".".join(package[:len(package) - node.level + 1] + ([base] if base else []))
            imports.append({"value": base, "line": node.lineno,
                            "members": [alias.name for alias in node.names]})
        value = None
        if isinstance(node, ast.Name):
            value = node.id
        elif isinstance(node, ast.Attribute):
            value = node.attr
        elif isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            value = node.name
        elif isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in docstrings:
            value = node.value
        if value:
            vendors.extend({"value": match.group(), "line": node.lineno} for match in pattern.finditer(value))
    return {
        "file": item["file"],
        "module": module,
        "imports": imports,
        "vendors": vendors,
        "architecture": cognition_architecture(tree, item["file"]),
    }


def main():
    results = []
    for item in json.load(sys.stdin):
        try:
            results.append(parse_source(item))
        except SyntaxError as error:
            raise SystemExit(f'{item["file"]}:{error.lineno}: Python syntax error') from None
    json.dump(results, sys.stdout)


if __name__ == "__main__":
    main()
