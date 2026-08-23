"""路径工具：统一解析仓库根目录与 Local Data Domain。"""

from __future__ import annotations

import os
from pathlib import Path


def resolve_repo_root(start: Path | None = None) -> Path:
    """优先使用发布安装根；开发环境再向上查找 workspace 或 Git 仓库。"""
    configured = os.environ.get("GLIMMER_CRADLE_APP_ROOT")
    if configured:
        return Path(configured).resolve()

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


def resolve_global_data_dir() -> Path:
    """解析全局 data 目录。相对路径按仓库根目录解释。"""
    configured = os.environ.get("GLIMMER_CRADLE_DATA_ROOT")
    if configured:
        p = Path(configured)
        if p.is_absolute():
            return p
        return resolve_repo_root() / p
    return resolve_repo_root() / "data"


def resolve_state_dir() -> Path:
    """解析长期状态目录。默认 <repo>/data/state。"""
    return resolve_global_data_dir() / "state"


def resolve_work_dir() -> Path:
    """解析短生命周期工作材料目录。默认 <repo>/data/work。"""
    return resolve_global_data_dir() / "work"


def resolve_run_dir() -> Path:
    """解析短生命周期协调目录；内容不具备跨启动保留契约。"""
    configured = os.environ.get("GLIMMER_CRADLE_RUN_ROOT")
    if configured:
        path = Path(configured)
        return path if path.is_absolute() else resolve_repo_root() / path
    return resolve_global_data_dir() / "run"


def resolve_packages_dir() -> Path:
    """解析本机托管外部包目录。默认 <repo>/data/packages。"""
    return resolve_global_data_dir() / "packages"


def resolve_models_dir() -> Path:
    """解析模型资产目录。默认 <repo>/data/models。"""
    return resolve_global_data_dir() / "models"


def resolve_cache_dir() -> Path:
    """解析可重建缓存目录。默认 <repo>/data/cache。"""
    return resolve_global_data_dir() / "cache"


def resolve_global_log_dir() -> Path:
    """解析全局日志目录；日志是 Local Data Domain 的固定子域。"""
    return resolve_observability_dir() / "logs"


def resolve_observability_dir() -> Path:
    """解析可观测性数据目录。默认 <repo>/data/observability。"""
    return resolve_global_data_dir() / "observability"


def resolve_experience_dir() -> Path:
    """解析 Cognition 拥有的经历账本目录。"""
    return resolve_state_dir() / "cognition" / "experience"


def resolve_cognition_db_path() -> Path:
    """解析 Cognition 记忆事实库路径。"""
    return resolve_state_dir() / "cognition" / "memory" / "memory.db"


def resolve_conversation_db_path() -> Path:
    """解析 Cognition 会话事实库路径。"""
    return resolve_state_dir() / "cognition" / "conversations" / "conversations.db"


def resolve_episode_projection_path() -> Path:
    """解析 Episode 派生投影数据库路径。"""
    return resolve_state_dir() / "cognition" / "projections" / "episodes.db"


def resolve_cognition_dlq_path() -> Path:
    """解析认知核 DLQ 数据库路径。默认 <repo>/data/state/cognition/dead_letters.db。"""
    return resolve_state_dir() / "cognition" / "dead_letters.db"


def resolve_metrics_dir() -> Path:
    """解析 metrics 目录。默认 <repo>/data/observability/metrics。"""
    return resolve_observability_dir() / "metrics"


def resolve_traces_dir() -> Path:
    """解析 traces 目录。默认 <repo>/data/observability/traces。"""
    return resolve_observability_dir() / "traces"


def resolve_events_dir() -> Path:
    """解析结构化事件日志目录。"""
    return resolve_global_log_dir() / "events"


def resolve_audit_dir() -> Path:
    """解析审计日志目录。"""
    return resolve_global_log_dir() / "audit"


def resolve_model_invocations_dir() -> Path:
    """解析模型调用观测目录。"""
    return resolve_observability_dir() / "model-invocations"


def resolve_observability_index_dir() -> Path:
    """解析 observability index 目录。默认 <repo>/data/observability/index。"""
    return resolve_observability_dir() / "index"


def resolve_observability_bundles_dir() -> Path:
    """解析 observability bundles 目录。默认 <repo>/data/observability/bundles。"""
    return resolve_observability_dir() / "bundles"


def ensure_dir(path: Path) -> Path:
    """确保目录存在并返回该路径。"""
    os.makedirs(path, exist_ok=True)
    return path
