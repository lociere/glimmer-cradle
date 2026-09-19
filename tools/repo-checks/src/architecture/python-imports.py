"""Parse Python source for architecture checks without importing product code."""

import ast
import json
import re
import sys


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
    return {"file": item["file"], "module": module, "imports": imports, "vendors": vendors}


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
