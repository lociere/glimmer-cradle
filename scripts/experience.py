"""
经历之流 CLI — 当前角色 Moment 流查询与检视工具（Glimmer Cradle 架构蓝图 §4.1）

用法:
  python scripts/experience.py tail [N]             查看最近 N 条 Moment（默认 20）
  python scripts/experience.py show <trace_id>      查看带某 trace_id 的全部 Moment
  python scripts/experience.py causes <moment_id>   查看由某 Moment 催生的下游 Moment
  python scripts/experience.py kinds                按 kind 统计 Moment 数量
  python scripts/experience.py verify               校验经历日志 seq 完整性
"""
import sys
from collections import Counter
from pathlib import Path

# Windows 控制台默认 GBK 编码，强制 stdout 为 UTF-8，避免中文输出乱码。
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "core" / "cognition" / "src"))

from glimmer_cradle.cognition.foundation.path_utils import resolve_experience_dir
from glimmer_cradle.cognition.experience.events import Moment
from glimmer_cradle.cognition.experience.replay import (
    iter_moments,
    replay_causation,
    replay_trace,
    verify,
)


def _print_moment(m: Moment) -> None:
    scene = f" scene={m.scene_id}" if m.scene_id else ""
    trace_tag = f" trace={m.trace_id[:12]}" if m.trace_id else ""
    causes = f" causes={len(m.causation_ids)}" if m.causation_ids else ""
    print(
        f"  #{m.seq:<6} {m.occurred_at}  {m.kind:<11} "
        f"imp={m.importance:.2f}{trace_tag}{causes}{scene}  id={m.moment_id[:8]}"
    )
    if m.content:
        text = m.content.get("text")
        if text:
            print(f"          {str(text)[:100]}")
    if m.affect:
        print(
            f"          affect: valence={m.affect.valence:+.2f} arousal={m.affect.arousal:.2f}"
            + (f" [{m.affect.label}]" if m.affect.label else "")
        )


def cmd_tail(base_dir: Path, n: int) -> None:
    moments = list(iter_moments(base_dir))
    if not moments:
        print("经历之流为空。")
        return
    for m in moments[-n:]:
        _print_moment(m)
    print(f"\n（共 {len(moments)} 个 Moment，显示最近 {min(n, len(moments))} 个）")


def cmd_show(base_dir: Path, trace_id: str) -> None:
    moments = replay_trace(base_dir, trace_id)
    if not moments:
        print(f"未找到 trace_id={trace_id} 的 Moment。")
        return
    for m in moments:
        _print_moment(m)
    print(f"\n共 {len(moments)} 个 Moment。")


def cmd_causes(base_dir: Path, moment_id: str) -> None:
    """检视 causation_ids 包含 moment_id 的下游 Moment。"""
    moments = replay_causation(base_dir, moment_id)
    if not moments:
        print(f"未找到由 moment_id={moment_id[:12]}… 直接催生的下游 Moment。")
        return
    for m in moments:
        _print_moment(m)
    print(f"\n共 {len(moments)} 个下游 Moment。")


def cmd_kinds(base_dir: Path) -> None:
    counter: Counter[str] = Counter()
    total = 0
    for m in iter_moments(base_dir):
        counter[m.kind] += 1
        total += 1
    if total == 0:
        print("经历之流为空。")
        return
    print(f"{'Kind':<14} {'Count':>8}")
    print("-" * 24)
    for kind, count in counter.most_common():
        print(f"{kind:<14} {count:>8}")
    print(f"\n共 {total} 个 Moment。")


def cmd_verify(base_dir: Path) -> int:
    result = verify(base_dir)
    print(f"Moment 总数: {result.total}")
    print(f"最后 seq: {result.last_seq}")
    if result.ok:
        print("完整性: OK（seq 单调连续无断号）")
        return 0
    print(f"完整性: 失败 — 发现 {len(result.gaps)} 处断号:")
    for expected, actual in result.gaps[:20]:
        print(f"  期望 seq={expected}，实际 seq={actual}")
    return 1


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 0
    command, args = sys.argv[1], sys.argv[2:]
    base_dir = resolve_experience_dir()

    if command == "tail":
        cmd_tail(base_dir, int(args[0]) if args else 20)
    elif command == "show":
        if not args:
            print("用法: python scripts/experience.py show <trace_id>")
            return 2
        cmd_show(base_dir, args[0])
    elif command == "causes":
        if not args:
            print("用法: python scripts/experience.py causes <moment_id>")
            return 2
        cmd_causes(base_dir, args[0])
    elif command == "kinds":
        cmd_kinds(base_dir)
    elif command == "verify":
        return cmd_verify(base_dir)
    else:
        print(f"未知命令: {command}")
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
