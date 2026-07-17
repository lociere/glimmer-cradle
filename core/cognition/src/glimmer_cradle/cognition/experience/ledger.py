"""单写者、分包、可校验的 Experience Ledger。"""
from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import threading
from collections import Counter
from contextlib import closing
from dataclasses import asdict, replace
from datetime import datetime, timezone
from pathlib import Path

from glimmer_cradle.cognition.experience.events import AffectSnapshot, Moment, SourceDescriptor

_PACK_DDL = """
CREATE TABLE IF NOT EXISTS moments (
  position INTEGER PRIMARY KEY, moment_id TEXT NOT NULL UNIQUE,
  occurred_at TEXT NOT NULL, recorded_at TEXT NOT NULL, kind TEXT NOT NULL,
  content_json TEXT NOT NULL, scene_id TEXT, conversation_id TEXT NOT NULL,
  continuity_id TEXT NOT NULL, thread_id TEXT NOT NULL, interaction_id TEXT NOT NULL,
  actor_id TEXT, actor_name TEXT, affect_json TEXT, importance REAL NOT NULL,
  trace_id TEXT NOT NULL, origin_json TEXT NOT NULL,
  retention_ceiling TEXT NOT NULL, recall_scope TEXT NOT NULL,
  disclosure_scope TEXT NOT NULL, schema_version INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS moment_causes (
  moment_id TEXT NOT NULL, cause_moment_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
  PRIMARY KEY(moment_id, cause_moment_id)
);
CREATE INDEX IF NOT EXISTS idx_moments_occurred ON moments(occurred_at);
CREATE INDEX IF NOT EXISTS idx_moments_interaction ON moments(interaction_id, position);
CREATE INDEX IF NOT EXISTS idx_moments_conversation ON moments(conversation_id, thread_id, position);
CREATE INDEX IF NOT EXISTS idx_moments_scene ON moments(scene_id, position);
CREATE INDEX IF NOT EXISTS idx_causes_parent ON moment_causes(cause_moment_id);
"""


class ExperienceLedger:
    """Moment 的唯一事实源；catalog 只管理位置与分包元数据。"""

    def __init__(self, base_dir: Path, *, pack_max_size_mb: int = 256) -> None:
        self.base_dir = base_dir
        self.catalog_path = base_dir / "catalog.db"
        self.packs_dir = base_dir / "packs"
        self.pack_max_bytes = max(16, pack_max_size_mb) * 1024 * 1024
        self._pending: list[Moment] = []
        self._last_position = 0
        self._lock = threading.RLock()
        self._writer_guard = None
        self._started = False

    @property
    def last_position(self) -> int:
        return self._last_position

    async def start(self) -> None:
        if self._started:
            return
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self.packs_dir.mkdir(parents=True, exist_ok=True)
        self._acquire_writer_guard()
        try:
            await asyncio.to_thread(self._initialize)
        except Exception:
            self._release_writer_guard()
            raise
        self._started = True

    async def stop(self) -> None:
        if not self._started:
            return
        await self.flush()
        self._release_writer_guard()
        self._started = False

    def append(self, moment: Moment) -> Moment:
        with self._lock:
            self._last_position += 1
            stored = replace(moment, seq=self._last_position)
            self._pending.append(stored)
            return stored

    async def flush(self) -> None:
        with self._lock:
            pending, self._pending = self._pending, []
        if not pending:
            return
        try:
            await asyncio.to_thread(self._write_batch, pending)
        except Exception:
            with self._lock:
                self._pending = pending + self._pending
            raise

    def recent(self, *, limit: int, kinds: set[str] | None = None,
               scene_id: str | None = None, exclude_trace_id: str | None = None) -> list[Moment]:
        persisted = self.query(limit=max(limit * 4, limit), descending=True)
        with self._lock:
            candidates = persisted + list(reversed(self._pending))
        dedup: dict[str, Moment] = {}
        for moment in candidates:
            if kinds is not None and moment.kind not in kinds:
                continue
            if scene_id is not None and moment.scene_id != scene_id:
                continue
            if exclude_trace_id and moment.trace_id == exclude_trace_id:
                continue
            dedup[moment.moment_id] = moment
        selected = sorted(dedup.values(), key=lambda item: item.seq, reverse=True)[:limit]
        return list(reversed(selected))

    def query(self, *, after_position: int = 0, limit: int | None = None,
              descending: bool = False) -> list[Moment]:
        results: list[Moment] = []
        order = "DESC" if descending else "ASC"
        for pack in self._pack_paths(reverse=descending):
            with closing(sqlite3.connect(pack)) as conn:
                sql = f"SELECT * FROM moments WHERE position > ? ORDER BY position {order}"
                params: list[object] = [after_position]
                if limit is not None:
                    sql += " LIMIT ?"
                    params.append(max(0, limit - len(results)))
                rows = conn.execute(sql, params).fetchall()
                causes = self._read_causes(conn, [row[1] for row in rows])
                results.extend(self._row_to_moment(row, causes.get(row[1], ())) for row in rows)
                if limit is not None and len(results) >= limit:
                    break
        return results[:limit] if limit is not None else results

    def verify(self) -> dict[str, object]:
        moments = self.query()
        positions = [item.seq for item in moments]
        ids = [item.moment_id for item in moments]
        position_set = set(positions)
        gaps = [value for value in range(1, max(positions, default=0) + 1)
                if value not in position_set]
        duplicates = sorted(value for value, count in Counter(ids).items() if count > 1)
        return {"ok": not duplicates and not gaps, "moments": len(moments),
                "last_position": max(positions, default=0), "duplicate_ids": duplicates,
                "position_gaps": gaps[:100]}

    def _initialize(self) -> None:
        with closing(sqlite3.connect(self.catalog_path)) as conn:
            conn.executescript("""
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS ledger_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS packs(
              pack_id TEXT PRIMARY KEY, relative_path TEXT NOT NULL UNIQUE,
              first_position INTEGER NOT NULL, last_position INTEGER NOT NULL,
              created_at TEXT NOT NULL, sealed_at TEXT
            );
            """)
            known_paths: set[str] = set()
            last_position = 0
            for pack in sorted(self.packs_dir.rglob("*.experience.db")):
                with closing(sqlite3.connect(pack)) as pack_conn:
                    row = pack_conn.execute(
                        "SELECT MIN(position),MAX(position),MIN(occurred_at) FROM moments").fetchone()
                if row is None or row[0] is None:
                    continue
                relative = pack.relative_to(self.base_dir).as_posix()
                pack_id = relative.replace("/", ":")
                known_paths.add(relative)
                conn.execute("""
                  INSERT INTO packs VALUES(?,?,?,?,?,NULL)
                  ON CONFLICT(pack_id) DO UPDATE SET
                    relative_path=excluded.relative_path,
                    first_position=excluded.first_position,
                    last_position=excluded.last_position
                """, (pack_id, relative, int(row[0]), int(row[1]), row[2]))
                last_position = max(last_position, int(row[1]))
            for relative, in conn.execute("SELECT relative_path FROM packs").fetchall():
                if relative not in known_paths:
                    conn.execute("DELETE FROM packs WHERE relative_path=?", (relative,))
            conn.execute(
                "INSERT INTO ledger_meta VALUES('last_position',?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (str(last_position),))
            conn.commit()
            self._last_position = last_position

    def _write_batch(self, moments: list[Moment]) -> None:
        groups: dict[Path, list[Moment]] = {}
        for moment in moments:
            groups.setdefault(self._pack_path_for(moment), []).append(moment)
        for pack, batch in groups.items():
            pack.parent.mkdir(parents=True, exist_ok=True)
            with closing(sqlite3.connect(pack)) as conn:
                conn.execute("PRAGMA journal_mode=WAL")
                conn.executescript(_PACK_DDL)
                conn.execute("BEGIN IMMEDIATE")
                for moment in batch:
                    conn.execute("INSERT INTO moments VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                                 self._moment_values(moment))
                    conn.executemany("INSERT INTO moment_causes VALUES(?,?,?)",
                                     [(moment.moment_id, cause, index)
                                      for index, cause in enumerate(moment.causation_ids)])
                conn.commit()
            self._update_catalog(pack, batch)

    def _pack_path_for(self, moment: Moment) -> Path:
        dt = datetime.fromisoformat(moment.occurred_at.replace("Z", "+00:00"))
        base = self.packs_dir / f"{dt.year:04d}" / f"{dt.year:04d}-{dt.month:02d}.experience.db"
        if not base.exists() or base.stat().st_size < self.pack_max_bytes:
            return base
        index = 2
        while True:
            candidate = base.with_name(f"{dt.year:04d}-{dt.month:02d}-{index}.experience.db")
            if not candidate.exists() or candidate.stat().st_size < self.pack_max_bytes:
                return candidate
            index += 1

    def _update_catalog(self, pack: Path, batch: list[Moment]) -> None:
        relative = pack.relative_to(self.base_dir).as_posix()
        pack_id = relative.replace("/", ":")
        with closing(sqlite3.connect(self.catalog_path)) as conn:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute(
                "INSERT INTO packs VALUES(?,?,?,?,?,NULL) ON CONFLICT(pack_id) DO UPDATE SET last_position=excluded.last_position",
                (pack_id, relative, batch[0].seq, batch[-1].seq, batch[0].occurred_at))
            conn.execute(
                "INSERT INTO ledger_meta VALUES('last_position', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (str(batch[-1].seq),))
            conn.commit()

    def _pack_paths(self, *, reverse: bool = False) -> list[Path]:
        if not self.catalog_path.exists():
            return []
        with closing(sqlite3.connect(self.catalog_path)) as conn:
            rows = conn.execute(
                f"SELECT relative_path FROM packs ORDER BY first_position {'DESC' if reverse else 'ASC'}"
            ).fetchall()
        return [self.base_dir / row[0] for row in rows if (self.base_dir / row[0]).exists()]

    @staticmethod
    def _moment_values(moment: Moment) -> tuple[object, ...]:
        recorded_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        return (moment.seq, moment.moment_id, moment.occurred_at, recorded_at, moment.kind,
                json.dumps(moment.content, ensure_ascii=False), moment.scene_id,
                moment.conversation_id, moment.continuity_id, moment.thread_id,
                moment.interaction_id,
                moment.actor_id, moment.actor_name,
                json.dumps(asdict(moment.affect), ensure_ascii=False) if moment.affect else None,
                moment.importance, moment.trace_id, json.dumps(asdict(moment.origin), ensure_ascii=False),
                moment.retention_ceiling, moment.recall_scope,
                moment.disclosure_scope, moment.schema_version)

    @staticmethod
    def _read_causes(conn: sqlite3.Connection, ids: list[str]) -> dict[str, tuple[str, ...]]:
        if not ids:
            return {}
        placeholders = ",".join("?" for _ in ids)
        rows = conn.execute(
            f"SELECT moment_id,cause_moment_id FROM moment_causes WHERE moment_id IN ({placeholders}) ORDER BY ordinal",
            ids).fetchall()
        result: dict[str, list[str]] = {}
        for moment_id, cause_id in rows:
            result.setdefault(moment_id, []).append(cause_id)
        return {key: tuple(value) for key, value in result.items()}

    @staticmethod
    def _row_to_moment(row: tuple, causes: tuple[str, ...]) -> Moment:
        affect_raw = json.loads(row[13]) if row[13] else None
        return Moment(seq=row[0], moment_id=row[1], occurred_at=row[2], kind=row[4],
                      content=json.loads(row[5]), causation_ids=causes, scene_id=row[6],
                      conversation_id=row[7], continuity_id=row[8], thread_id=row[9],
                      interaction_id=row[10], actor_id=row[11], actor_name=row[12],
                      affect=AffectSnapshot(**affect_raw) if affect_raw else None,
                      importance=row[14], trace_id=row[15],
                      origin=SourceDescriptor(**json.loads(row[16])),
                      retention_ceiling=row[17], recall_scope=row[18],
                      disclosure_scope=row[19], schema_version=row[20])

    def _acquire_writer_guard(self) -> None:
        handle = open(self.base_dir / ".writer.lock", "a+b")
        try:
            if os.name == "nt":
                import msvcrt
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            handle.close()
            raise RuntimeError("Experience Ledger 已有写入者") from exc
        self._writer_guard = handle

    def _release_writer_guard(self) -> None:
        handle = self._writer_guard
        if handle is None:
            return
        try:
            if os.name == "nt":
                import msvcrt
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        finally:
            handle.close()
            self._writer_guard = None
