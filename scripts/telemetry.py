"""
遥测 CLI —— 查询 metrics / spans 事件流

数据源：
  data/observability/metrics/metrics-{proc}.jsonl    # ② metrics 事件
  data/observability/traces/spans-{proc}.jsonl       # ③ span 事件

用法：
  python scripts/telemetry.py metrics tail [N]              最近 N 条 metric
  python scripts/telemetry.py metrics names                 按 name 统计计数
  python scripts/telemetry.py metrics grep <name>           按 name 过滤
  python scripts/telemetry.py spans tail [N]                最近 N 条 span
  python scripts/telemetry.py spans latest                  最近一个 trace 的 span 树
  python scripts/telemetry.py spans tree <trace_id>         按 trace 还原 span 树
  python scripts/telemetry.py spans slowest [N]             耗时 Top N（默认 10）
"""
from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Iterator

# Windows 控制台默认 GBK，强制 stdout 为 UTF-8 防止中文乱码。
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

def resolve_repo_root(start: Path | None = None) -> Path:
    """向上查找仓库根目录，避免为读路径加载 Cognition 运行时依赖。"""
    cur = (start or Path(__file__).resolve()).resolve()
    if cur.is_file():
        cur = cur.parent
    while True:
        if (cur / "pnpm-workspace.yaml").exists() or (cur / ".git").exists():
            return cur
        parent = cur.parent
        if parent == cur:
            return Path.cwd()
        cur = parent


def resolve_metrics_dir() -> Path:
    return resolve_repo_root() / "data" / "observability" / "metrics"


def resolve_traces_dir() -> Path:
    return resolve_repo_root() / "data" / "observability" / "traces"


def _iter_jsonl(directory: Path, pattern: str) -> Iterator[dict]:
    """按文件名顺序读取目录下匹配的 JSONL 文件，跳过坏行。"""
    if not directory.exists():
        return
    for path in sorted(directory.glob(pattern)):
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    continue


# ─────────────────────────── metrics ──────────────────────────────────────────

def _print_metric(m: dict) -> None:
    labels = m.get("labels") or {}
    label_str = " ".join(f"{k}={v}" for k, v in labels.items())
    label_part = f" [{label_str}]" if label_str else ""
    print(
        f"  {m.get('ts','')}  {m.get('kind',''):<9} {m.get('name',''):<28} "
        f"= {m.get('value', '')}{label_part}"
    )


def cmd_metrics_tail(n: int) -> None:
    events = list(_iter_jsonl(resolve_metrics_dir(), "metrics-*.jsonl"))
    if not events:
        print("metrics 流为空。")
        return
    for m in events[-n:]:
        _print_metric(m)
    print(f"\n（共 {len(events)} 条，显示最近 {min(n, len(events))} 条）")


def cmd_metrics_names() -> None:
    counter: Counter[str] = Counter()
    for m in _iter_jsonl(resolve_metrics_dir(), "metrics-*.jsonl"):
        counter[m.get("name", "")] += 1
    if not counter:
        print("metrics 流为空。")
        return
    print(f"{'Name':<32} {'Count':>8}")
    print("-" * 42)
    for name, count in counter.most_common():
        print(f"{name:<32} {count:>8}")


def cmd_metrics_grep(name: str) -> None:
    matched = [m for m in _iter_jsonl(resolve_metrics_dir(), "metrics-*.jsonl") if m.get("name") == name]
    if not matched:
        print(f"未找到 name={name} 的 metric。")
        return
    for m in matched:
        _print_metric(m)
    print(f"\n共 {len(matched)} 条。")


# ─────────────────────────── spans ────────────────────────────────────────────

INTERESTING_SPAN_ATTRS = (
    "queue_wait_ms",
    "batch_size",
    "dropped_count",
    "attention_mode",
    "address_mode",
    "modality",
    "backend",
    "tier",
    "provider",
    "model",
    "scene_id",
    "request_id",
)


def _format_attr_value(value: object) -> str:
    if isinstance(value, float):
        return f"{value:.2f}"
    if isinstance(value, list):
        return "[" + ",".join(str(v) for v in value) + "]"
    return str(value)


def _format_span_attrs(s: dict) -> str:
    attrs = s.get("attributes") or {}
    if not isinstance(attrs, dict):
        return ""
    parts: list[str] = []
    for key in INTERESTING_SPAN_ATTRS:
        if key in attrs and attrs[key] is not None:
            parts.append(f"{key}={_format_attr_value(attrs[key])}")
    return "  " + " ".join(parts) if parts else ""


def _print_span(s: dict, indent: int = 0) -> None:
    pad = "  " * indent
    status = s.get("status", "")
    status_tag = "" if status == "ok" else f" !{status}"
    err = s.get("error")
    err_tag = f" error={err}" if err else ""
    attr_tag = _format_span_attrs(s)
    print(
        f"{pad}- {s.get('name',''):<22} "
        f"{s.get('duration_ms', 0):>8.2f}ms  span={s.get('span_id','')[:8]}"
        f"{status_tag}{err_tag}{attr_tag}"
    )


def cmd_spans_tail(n: int) -> None:
    events = list(_iter_jsonl(resolve_traces_dir(), "spans-*.jsonl"))
    if not events:
        print("spans 流为空。")
        return
    for s in events[-n:]:
        _print_span(s)
    print(f"\n（共 {len(events)} 条，显示最近 {min(n, len(events))} 条）")


def cmd_spans_tree(trace_id: str) -> None:
    """按 trace_id 把 spans 还原为父子树（含跨进程父 span）。"""
    _print_spans_tree(trace_id)


def _print_spans_tree(trace_id: str) -> None:
    spans = [s for s in _iter_jsonl(resolve_traces_dir(), "spans-*.jsonl") if s.get("trace_id") == trace_id]
    if not spans:
        print(f"未找到 trace_id={trace_id} 的 span。")
        return
    # 按 parent_span_id 索引，再 DFS 输出
    by_parent: dict[str | None, list[dict]] = defaultdict(list)
    for s in spans:
        by_parent[s.get("parent_span_id")].append(s)
    for children in by_parent.values():
        children.sort(key=lambda x: x.get("started_at", ""))

    # 根 = parent_span_id 不在本 trace 任何 span_id 集合内（包括 None 和外部父）
    own_ids = {s.get("span_id") for s in spans}
    roots = [s for s in spans if s.get("parent_span_id") not in own_ids]

    def dfs(node: dict, depth: int) -> None:
        _print_span(node, depth)
        for child in by_parent.get(node.get("span_id"), []):
            dfs(child, depth + 1)

    print(f"trace_id={trace_id}  共 {len(spans)} 个 span，{len(roots)} 个根:")
    for root in sorted(roots, key=lambda x: x.get("started_at", "")):
        dfs(root, 0)


def cmd_spans_latest() -> None:
    events = list(_iter_jsonl(resolve_traces_dir(), "spans-*.jsonl"))
    if not events:
        print("spans 流为空。")
        return
    latest_trace_id = events[-1].get("trace_id")
    if not latest_trace_id:
        print("最近 span 缺少 trace_id。")
        return
    _print_spans_tree(str(latest_trace_id))


def cmd_spans_slowest(n: int) -> None:
    events = list(_iter_jsonl(resolve_traces_dir(), "spans-*.jsonl"))
    if not events:
        print("spans 流为空。")
        return
    top = sorted(events, key=lambda s: s.get("duration_ms", 0.0), reverse=True)[:n]
    print(f"{'name':<24} {'duration_ms':>14}  trace_id")
    print("-" * 70)
    for s in top:
        print(
            f"{s.get('name',''):<24} {s.get('duration_ms', 0):>14.2f}  "
            f"{s.get('trace_id','')[:16]}{_format_span_attrs(s)}"
        )


# ─────────────────────────── main ─────────────────────────────────────────────

def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 0
    pillar, args = sys.argv[1], sys.argv[2:]

    if pillar == "metrics":
        if not args:
            print("用法: metrics {tail|names|grep ...}")
            return 2
        sub, rest = args[0], args[1:]
        if sub == "tail":
            cmd_metrics_tail(int(rest[0]) if rest else 20)
        elif sub == "names":
            cmd_metrics_names()
        elif sub == "grep":
            if not rest:
                print("用法: metrics grep <name>")
                return 2
            cmd_metrics_grep(rest[0])
        else:
            print(f"未知 metrics 子命令: {sub}")
            return 2
    elif pillar == "spans":
        if not args:
            print("用法: spans {tail|tree|slowest ...}")
            return 2
        sub, rest = args[0], args[1:]
        if sub == "tail":
            cmd_spans_tail(int(rest[0]) if rest else 20)
        elif sub == "latest":
            cmd_spans_latest()
        elif sub == "tree":
            if not rest:
                print("用法: spans tree <trace_id>")
                return 2
            cmd_spans_tree(rest[0])
        elif sub == "slowest":
            cmd_spans_slowest(int(rest[0]) if rest else 10)
        else:
            print(f"未知 spans 子命令: {sub}")
            return 2
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
