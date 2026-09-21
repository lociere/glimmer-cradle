"""从 ordered Conversation fact 构建的持久 History 查询投影。"""

from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime
from pathlib import Path

import aiosqlite

from glimmer_cradle.conversation.log.fact import ConversationFact
from glimmer_cradle.conversation.message.models import ConversationMessage

logger = logging.getLogger("glimmer_cradle.conversation.history")
SCHEMA_VERSION = 4
_TOKENS = re.compile(r"[a-zA-Z0-9_]+|[\u4e00-\u9fff]{1,2}")

_DDL = """
CREATE TABLE schema_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE projection_meta(name TEXT PRIMARY KEY,position INTEGER NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE conversation_threads(
  conversation_id TEXT NOT NULL, thread_id TEXT NOT NULL, scene_id TEXT NOT NULL,
  recall_scope TEXT NOT NULL, disclosure_scope TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY(conversation_id,thread_id)
);
CREATE TABLE conversation_messages(
  position INTEGER PRIMARY KEY, moment_id TEXT NOT NULL UNIQUE,
  conversation_id TEXT NOT NULL, chapter_id TEXT, scene_id TEXT NOT NULL, thread_id TEXT NOT NULL,
  interaction_id TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL, actor_id TEXT, actor_name TEXT, occurred_at TEXT NOT NULL,
  importance REAL NOT NULL, recall_scope TEXT NOT NULL, disclosure_scope TEXT NOT NULL,
  FOREIGN KEY(conversation_id,thread_id)
    REFERENCES conversation_threads(conversation_id,thread_id)
);
CREATE INDEX idx_conversation_messages_thread
  ON conversation_messages(conversation_id,thread_id,position DESC);
CREATE TABLE conversation_chapters(
  chapter_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, thread_id TEXT NOT NULL,
  sequence INTEGER NOT NULL, status TEXT NOT NULL,
  first_position INTEGER NOT NULL, last_position INTEGER NOT NULL,
  started_at TEXT NOT NULL, ended_at TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
  UNIQUE(conversation_id,thread_id,sequence)
);
CREATE INDEX idx_conversation_chapters_active
  ON conversation_chapters(conversation_id,thread_id,status,last_position);
CREATE TABLE conversation_segments(
  segment_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, thread_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  level INTEGER NOT NULL, parent_segment_id TEXT,
  first_position INTEGER NOT NULL, last_position INTEGER NOT NULL,
  summary TEXT NOT NULL, keywords_json TEXT NOT NULL, actor_ids_json TEXT NOT NULL,
  recall_scope TEXT NOT NULL, disclosure_scope TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(conversation_id,thread_id,level,first_position,last_position)
);
CREATE INDEX idx_conversation_segments_lookup
  ON conversation_segments(conversation_id,thread_id,level,last_position DESC);
CREATE TABLE conversation_segment_members(
  segment_id TEXT NOT NULL,position INTEGER NOT NULL,
  PRIMARY KEY(segment_id,position)
);
CREATE TABLE conversation_state(
  conversation_id TEXT NOT NULL,thread_id TEXT NOT NULL,
  version INTEGER NOT NULL,through_position INTEGER NOT NULL,
  state_json TEXT NOT NULL,updated_at TEXT NOT NULL,
  PRIMARY KEY(conversation_id,thread_id)
);
"""


class ConversationStore:
    """History 是 ordered fact 的投影；所有写入都以 fact id 幂等。"""

    def __init__(self, db_path: Path, *, config=None) -> None:
        self._db_path = db_path
        self._config = config
        self._conn: aiosqlite.Connection | None = None

    async def connect(self) -> None:
        if self._conn is not None:
            return
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = await aiosqlite.connect(str(self._db_path))
        await self._conn.execute("PRAGMA journal_mode=WAL")
        await self._conn.execute("PRAGMA foreign_keys=ON")
        cursor = await self._conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_meta'"
        )
        if await cursor.fetchone() is None:
            await self._conn.executescript(_DDL)
            await self._conn.execute(
                "INSERT INTO schema_meta VALUES('schema_version',?)", (str(SCHEMA_VERSION),)
            )
            await self._conn.commit()
        else:
            cursor = await self._conn.execute(
                "SELECT value FROM schema_meta WHERE key='schema_version'"
            )
            row = await cursor.fetchone()
            if row is None:
                raise RuntimeError("Conversation 投影缺少 schema_version")
            version = int(row[0])
            if version == 3:
                await self._migrate_v3_to_v4()
            elif version != SCHEMA_VERSION:
                raise RuntimeError(f"不支持的 Conversation 投影版本: {version}")
        logger.info("Conversation 投影已就绪: %s", self._db_path)

    async def _migrate_v3_to_v4(self) -> None:
        """把 v3 单 thread 投影无损扩展为 conversation+thread 复合拓扑。"""
        conn = self._connection
        await conn.execute("PRAGMA foreign_keys=OFF")
        await conn.execute("BEGIN IMMEDIATE")
        try:
            tables = (
                "schema_meta", "projection_meta", "conversation_threads",
                "conversation_messages", "conversation_chapters",
                "conversation_segments", "conversation_segment_members",
                "conversation_state",
            )
            for table in tables:
                await conn.execute(f"ALTER TABLE {table} RENAME TO v3_{table}")
            for statement in _DDL.split(";"):
                if statement.strip():
                    await conn.execute(statement)
            await conn.execute(
                "INSERT INTO schema_meta VALUES('schema_version',?)",
                (str(SCHEMA_VERSION),),
            )
            await conn.execute(
                "INSERT INTO projection_meta SELECT * FROM v3_projection_meta"
            )
            await conn.execute(
                """
                INSERT INTO conversation_threads
                SELECT conversation_id,thread_id,scene_id,recall_scope,disclosure_scope,
                       created_at,updated_at FROM v3_conversation_threads
                """
            )
            await conn.execute(
                "INSERT INTO conversation_messages SELECT * FROM v3_conversation_messages"
            )
            await conn.execute(
                """
                INSERT INTO conversation_chapters
                SELECT c.chapter_id,c.conversation_id,t.thread_id,c.sequence,c.status,
                       c.first_position,c.last_position,c.started_at,c.ended_at,c.summary
                FROM v3_conversation_chapters c
                JOIN v3_conversation_threads t USING(conversation_id)
                """
            )
            await conn.execute(
                """
                INSERT INTO conversation_segments
                SELECT s.segment_id,s.conversation_id,t.thread_id,s.chapter_id,s.level,
                       s.parent_segment_id,s.first_position,s.last_position,s.summary,
                       s.keywords_json,s.actor_ids_json,s.recall_scope,
                       s.disclosure_scope,s.created_at
                FROM v3_conversation_segments s
                JOIN v3_conversation_threads t USING(conversation_id)
                """
            )
            await conn.execute(
                "INSERT INTO conversation_segment_members SELECT * FROM v3_conversation_segment_members"
            )
            await conn.execute(
                """
                INSERT INTO conversation_state
                SELECT s.conversation_id,t.thread_id,s.version,s.through_position,
                       s.state_json,s.updated_at
                FROM v3_conversation_state s
                JOIN v3_conversation_threads t USING(conversation_id)
                """
            )
            for table in reversed(tables):
                await conn.execute(f"DROP TABLE v3_{table}")
            await conn.commit()
        except Exception:
            await conn.rollback()
            raise
        finally:
            await conn.execute("PRAGMA foreign_keys=ON")

    async def close(self) -> None:
        if self._conn is not None:
            await self._conn.close()
            self._conn = None

    async def checkpoint(self) -> int:
        cursor = await self._connection.execute(
            "SELECT position FROM projection_meta WHERE name='conversation'"
        )
        row = await cursor.fetchone()
        return int(row[0]) if row else 0

    async def project(self, moment: ConversationFact) -> bool:
        conn = self._connection
        await conn.execute("BEGIN IMMEDIATE")
        try:
            inserted = False
            if moment.kind in {"perception", "reply"}:
                content = str(moment.content.get("text") or "").strip()
                if content and moment.conversation_id:
                    inserted = await self._project_message(conn, moment, content)
            await conn.execute(
                """
                INSERT INTO projection_meta VALUES('conversation',?,?)
                ON CONFLICT(name) DO UPDATE SET position=MAX(position,excluded.position),
                  updated_at=excluded.updated_at
                """,
                (moment.seq, moment.occurred_at),
            )
            await conn.commit()
            return inserted
        except Exception:
            await conn.rollback()
            raise

    async def _project_message(self, conn, moment: ConversationFact, content: str) -> bool:
        cursor = await conn.execute(
            "SELECT 1 FROM conversation_messages WHERE moment_id=?", (moment.moment_id,)
        )
        if await cursor.fetchone() is not None:
            return False
        cursor = await conn.execute(
            """
            SELECT scene_id,recall_scope,disclosure_scope
            FROM conversation_threads WHERE conversation_id=? AND thread_id=?
            """,
            (moment.conversation_id, moment.thread_id),
        )
        existing = await cursor.fetchone()
        identity = (
            moment.scene_id or moment.conversation_id,
            moment.recall_scope,
            moment.disclosure_scope,
        )
        if existing is not None and tuple(str(value) for value in existing) != identity:
            raise ValueError(
                "canonical Conversation Thread 的 scene 与权限域不可在投影中漂移"
            )
        await conn.execute(
            """
            INSERT INTO conversation_threads VALUES(?,?,?,?,?,?,?)
            ON CONFLICT(conversation_id,thread_id) DO UPDATE SET
              updated_at=excluded.updated_at
            """,
            (
                moment.conversation_id, moment.thread_id,
                moment.scene_id or moment.conversation_id,
                moment.recall_scope, moment.disclosure_scope,
                moment.occurred_at, moment.occurred_at,
            ),
        )
        chapter_id = await self._resolve_chapter(conn, moment)
        role = "user" if moment.kind == "perception" else "assistant"
        await conn.execute(
            """
            INSERT INTO conversation_messages VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                moment.seq, moment.moment_id, moment.conversation_id, chapter_id,
                moment.scene_id or moment.conversation_id, moment.thread_id,
                moment.interaction_id, role, content, moment.actor_id, moment.actor_name,
                moment.occurred_at, moment.importance, moment.recall_scope,
                moment.disclosure_scope,
            ),
        )
        await conn.execute(
            "UPDATE conversation_chapters SET last_position=?,ended_at=? WHERE chapter_id=?",
            (moment.seq, moment.occurred_at, chapter_id),
        )
        await self._project_segment_if_due(conn, moment.conversation_id, chapter_id, moment)
        await self._project_state_if_due(
            conn, moment.conversation_id, moment.thread_id, moment
        )
        return True

    async def _resolve_chapter(self, conn, moment: ConversationFact) -> str:
        cursor = await conn.execute(
            """
            SELECT chapter_id,sequence,ended_at FROM conversation_chapters
            WHERE conversation_id=? AND thread_id=? AND status='active'
            ORDER BY sequence DESC LIMIT 1
            """,
            (moment.conversation_id, moment.thread_id),
        )
        row = await cursor.fetchone()
        should_close = False
        if row is not None:
            elapsed = datetime.fromisoformat(moment.occurred_at.replace("Z", "+00:00")) - datetime.fromisoformat(str(row[2]).replace("Z", "+00:00"))
            should_close = elapsed.total_seconds() >= self._chapter_idle_minutes * 60
            cursor = await conn.execute(
                "SELECT COUNT(*) FROM conversation_segments WHERE chapter_id=? AND level=0",
                (row[0],),
            )
            should_close = should_close or int((await cursor.fetchone())[0]) >= self._chapter_segment_limit
        if row is not None and not should_close:
            return str(row[0])
        if row is not None:
            await conn.execute(
                "UPDATE conversation_chapters SET status='closed' WHERE chapter_id=?", (row[0],)
            )
            await self._project_chapter_segment(conn, str(row[0]), moment.occurred_at)
            sequence = int(row[1]) + 1
        else:
            cursor = await conn.execute(
                """SELECT COALESCE(MAX(sequence),0)+1 FROM conversation_chapters
                   WHERE conversation_id=? AND thread_id=?""",
                (moment.conversation_id, moment.thread_id),
            )
            sequence = int((await cursor.fetchone())[0])
        chapter_id = uuid.uuid5(
            uuid.NAMESPACE_URL,
            f"glimmer:chapter:{moment.conversation_id}:{moment.thread_id}:{sequence}",
        ).hex
        await conn.execute(
            "INSERT INTO conversation_chapters VALUES(?,?,?,?,'active',?,?,?,?, '')",
            (
                chapter_id, moment.conversation_id, moment.thread_id, sequence,
                moment.seq, moment.seq,
                moment.occurred_at, moment.occurred_at,
            ),
        )
        return chapter_id

    async def _project_segment_if_due(
        self, conn, conversation_id: str, chapter_id: str, moment: ConversationFact
    ) -> None:
        cursor = await conn.execute(
            """
            SELECT m.position,m.content,m.actor_id,m.recall_scope,m.disclosure_scope
            FROM conversation_messages m
            WHERE m.chapter_id=? AND NOT EXISTS(
              SELECT 1 FROM conversation_segment_members sm WHERE sm.position=m.position
            ) ORDER BY m.position
            """,
            (chapter_id,),
        )
        rows = await cursor.fetchall()
        if len(rows) < self._segment_target_messages:
            return
        scope = (rows[0][3], rows[0][4])
        contiguous = []
        for row in rows:
            if (row[3], row[4]) != scope:
                break
            contiguous.append(row)
        rows = contiguous[:self._segment_target_messages]
        if len(rows) < self._segment_target_messages:
            return
        first, last = int(rows[0][0]), int(rows[-1][0])
        segment_id = uuid.uuid5(
            uuid.NAMESPACE_URL, f"glimmer:segment:{conversation_id}:{first}:{last}"
        ).hex
        summary = self._summary([str(row[1]) for row in rows])
        keywords = sorted({token.lower() for token in _TOKENS.findall(summary)})[:32]
        actors = sorted({str(row[2]) for row in rows if row[2]})
        await conn.execute(
            "INSERT OR IGNORE INTO conversation_segments VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                segment_id, conversation_id, moment.thread_id, chapter_id, 0, None, first, last,
                summary, json.dumps(keywords, ensure_ascii=False),
                json.dumps(actors, ensure_ascii=False), rows[0][3], rows[0][4],
                moment.occurred_at,
            ),
        )
        await conn.executemany(
            "INSERT OR IGNORE INTO conversation_segment_members VALUES(?,?)",
            [(segment_id, int(row[0])) for row in rows],
        )

    async def _project_chapter_segment(self, conn, chapter_id: str, occurred_at: str) -> None:
        cursor = await conn.execute(
            """
            SELECT segment_id,conversation_id,thread_id,first_position,last_position,summary,
                   recall_scope,disclosure_scope FROM conversation_segments
            WHERE chapter_id=? AND level=0 ORDER BY first_position
            """,
            (chapter_id,),
        )
        rows = await cursor.fetchall()
        if len(rows) < 2:
            return
        scopes = {(str(row[6]), str(row[7])) for row in rows}
        if len(scopes) != 1:
            return
        first, last = int(rows[0][3]), int(rows[-1][4])
        parent_id = uuid.uuid5(
            uuid.NAMESPACE_URL, f"glimmer:chapter-segment:{chapter_id}:{first}:{last}"
        ).hex
        summary = self._summary([str(row[5]) for row in rows])
        await conn.execute(
            "INSERT OR IGNORE INTO conversation_segments VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                parent_id, rows[0][1], rows[0][2], chapter_id, 1, None, first, last, summary,
                json.dumps(sorted(set(_TOKENS.findall(summary)))[:48], ensure_ascii=False),
                "[]", rows[0][6], rows[0][7], occurred_at,
            ),
        )
        await conn.executemany(
            "UPDATE conversation_segments SET parent_segment_id=? WHERE segment_id=?",
            [(parent_id, row[0]) for row in rows],
        )
        await conn.execute(
            "UPDATE conversation_chapters SET summary=? WHERE chapter_id=?",
            (summary, chapter_id),
        )

    async def _project_state_if_due(
        self, conn, conversation_id: str, thread_id: str, moment: ConversationFact
    ) -> None:
        cursor = await conn.execute(
            """SELECT through_position FROM conversation_state
               WHERE conversation_id=? AND thread_id=?""",
            (conversation_id, thread_id),
        )
        row = await cursor.fetchone()
        through = int(row[0]) if row else 0
        cursor = await conn.execute(
            """
            SELECT role,content,position,recall_scope,disclosure_scope
            FROM conversation_messages
            WHERE conversation_id=? AND thread_id=? AND position>?
              AND recall_scope=? AND disclosure_scope=?
            ORDER BY position
            """,
            (
                conversation_id, thread_id, through, moment.recall_scope,
                moment.disclosure_scope,
            ),
        )
        messages = await cursor.fetchall()
        if len(messages) < self._state_update_messages and row is not None:
            return
        recent = messages[-self._state_update_messages:]
        user_lines = [str(item[1]) for item in recent if item[0] == "user"]
        questions = [line for line in user_lines if line.rstrip().endswith(("?", "？"))]
        state = {
            "active_topic": user_lines[-1][:160] if user_lines else "",
            "open_questions": questions[-3:],
            "recent_user_intents": user_lines[-3:],
            "_recall_scope": moment.recall_scope,
            "_disclosure_scope": moment.disclosure_scope,
        }
        await conn.execute(
            """
            INSERT INTO conversation_state VALUES(?,?,1,?,?,?)
            ON CONFLICT(conversation_id,thread_id) DO UPDATE SET
              version=version+1,through_position=excluded.through_position,
              state_json=excluded.state_json,updated_at=excluded.updated_at
            """,
            (
                conversation_id, thread_id, moment.seq,
                json.dumps(state, ensure_ascii=False), moment.occurred_at,
            ),
        )

    async def load_working_set(
        self, conversation_id: str, thread_id: str, *, limit: int
    ) -> tuple[dict, list[ConversationMessage]]:
        cursor = await self._connection.execute(
            """SELECT state_json FROM conversation_state
               WHERE conversation_id=? AND thread_id=?""",
            (conversation_id, thread_id),
        )
        row = await cursor.fetchone()
        state = json.loads(row[0]) if row else {}
        cursor = await self._connection.execute(
            """
            SELECT position,moment_id,conversation_id,scene_id,thread_id,interaction_id,
                   role,content,actor_id,actor_name,occurred_at,importance,
                   recall_scope,disclosure_scope
            FROM conversation_messages WHERE conversation_id=? AND thread_id=?
            ORDER BY position DESC LIMIT ?
            """,
            (conversation_id, thread_id, limit),
        )
        fetched_rows = list(await cursor.fetchall())
        rows = list(reversed(fetched_rows))
        return state, [ConversationMessage(*row) for row in rows]

    async def load_history_page(
        self,
        conversation_id: str,
        thread_id: str,
        *,
        allowed_scopes: set[str],
        cursor: str | None,
        limit: int,
        scene_id: str | None = None,
        actor_id: str | None = None,
    ) -> tuple[dict, list[ConversationMessage], str | None, bool]:
        if not allowed_scopes:
            return {}, [], None, False
        thread = await self._load_thread(conversation_id, thread_id)
        if not thread:
            return {}, [], None, False

        before_position = _decode_history_cursor(cursor)
        page_limit = max(1, min(limit, 200))
        base_clauses, base_params = self._build_history_filters(
            conversation_id,
            thread_id,
            allowed_scopes=allowed_scopes,
            scene_id=scene_id,
            actor_id=actor_id,
            before_position=before_position,
        )
        anchor_position = await self._resolve_history_anchor(
            conversation_id,
            thread_id,
            allowed_scopes=allowed_scopes,
            scene_id=scene_id,
            actor_id=actor_id,
            before_position=before_position,
        )
        if anchor_position is None:
            return thread, [], None, False

        clauses = [*base_clauses, "position <= ?"]
        params = [*base_params, anchor_position, page_limit + 1]

        cursor_obj = await self._connection.execute(
            f"""
            SELECT position,moment_id,conversation_id,scene_id,thread_id,interaction_id,
                   role,content,actor_id,actor_name,occurred_at,importance,
                   recall_scope,disclosure_scope
            FROM conversation_messages
            WHERE {" AND ".join(clauses)}
            ORDER BY position DESC LIMIT ?
            """,
            tuple(params),
        )
        rows_desc = list(await cursor_obj.fetchall())
        has_more = len(rows_desc) > page_limit
        selected_desc = rows_desc[:page_limit]
        messages = [ConversationMessage(*row) for row in reversed(selected_desc)]
        next_cursor = _encode_history_cursor(anchor_position) if has_more and messages else None
        return thread, messages, next_cursor, has_more

    async def retrieve_segments(
        self, conversation_id: str, thread_id: str, query: str, *,
        allowed_scopes: set[str], limit: int
    ) -> list[str]:
        if not allowed_scopes:
            return []
        cursor = await self._connection.execute(
            """
            SELECT summary,keywords_json,last_position,recall_scope FROM conversation_segments
            WHERE conversation_id=? AND thread_id=?
            ORDER BY level DESC,last_position DESC LIMIT ?
            """,
            (conversation_id, thread_id, self._history_candidate_limit),
        )
        query_tokens = {item.lower() for item in _TOKENS.findall(query)}
        ranked = []
        for summary, keywords_json, position, scope in await cursor.fetchall():
            if scope not in allowed_scopes:
                continue
            tokens = set(json.loads(keywords_json)) | {item.lower() for item in _TOKENS.findall(summary)}
            score = len(query_tokens & tokens) / max(1, len(query_tokens))
            ranked.append((score, int(position), str(summary)))
        ranked.sort(key=lambda item: (item[0], item[1]), reverse=True)
        return [item[2] for item in ranked[:limit]]

    @property
    def _segment_target_messages(self) -> int:
        return int(getattr(self._config, "segment_target_messages", 20) or 20)

    @property
    def _chapter_idle_minutes(self) -> int:
        return int(getattr(self._config, "chapter_idle_minutes", 360) or 360)

    @property
    def _chapter_segment_limit(self) -> int:
        return int(getattr(self._config, "chapter_segment_limit", 8) or 8)

    @property
    def _state_update_messages(self) -> int:
        return int(getattr(self._config, "state_update_messages", 6) or 6)

    @property
    def _history_candidate_limit(self) -> int:
        return int(getattr(self._config, "history_candidate_limit", 12) or 12)

    @property
    def history_result_limit(self) -> int:
        return int(getattr(self._config, "history_result_limit", 4) or 4)

    def _summary(self, values: list[str]) -> str:
        maximum = int(getattr(self._config, "summary_max_chars", 2400) or 2400)
        return "\n".join(value.replace("\n", " ").strip() for value in values if value.strip())[-maximum:]

    @property
    def _connection(self) -> aiosqlite.Connection:
        if self._conn is None:
            raise RuntimeError("ConversationStore 尚未连接")
        return self._conn

    async def _load_thread(self, conversation_id: str, thread_id: str) -> dict:
        cursor = await self._connection.execute(
            """
            SELECT conversation_id,scene_id,thread_id,recall_scope,disclosure_scope
            FROM conversation_threads WHERE conversation_id=? AND thread_id=?
            """,
            (conversation_id, thread_id),
        )
        row = await cursor.fetchone()
        if row is None:
            return {}
        return {
            "conversation_id": str(row[0]),
            "scene_id": str(row[1]),
            "thread_id": str(row[2]),
            "recall_scope": str(row[3]),
            "disclosure_scope": str(row[4]),
        }

    def _build_history_filters(
        self,
        conversation_id: str,
        thread_id: str,
        *,
        allowed_scopes: set[str],
        scene_id: str | None,
        actor_id: str | None,
        before_position: int | None,
    ) -> tuple[list[str], list[object]]:
        if not allowed_scopes:
            return ["0=1"], []
        clauses = ["conversation_id=?", "thread_id=?"]
        params: list[object] = [conversation_id, thread_id]
        if before_position is not None:
            clauses.append("position < ?")
            params.append(before_position)
        if scene_id:
            clauses.append("scene_id=?")
            params.append(scene_id)
        placeholders = ",".join("?" for _ in sorted(allowed_scopes))
        clauses.append(f"recall_scope IN ({placeholders})")
        params.extend(sorted(allowed_scopes))
        if actor_id:
            clauses.append("(actor_id=? OR role='assistant')")
            params.append(actor_id)
        return clauses, params

    async def _resolve_history_anchor(
        self,
        conversation_id: str,
        thread_id: str,
        *,
        allowed_scopes: set[str],
        scene_id: str | None,
        actor_id: str | None,
        before_position: int | None,
    ) -> int | None:
        base_clauses, base_params = self._build_history_filters(
            conversation_id,
            thread_id,
            allowed_scopes=allowed_scopes,
            scene_id=scene_id,
            actor_id=actor_id,
            before_position=before_position,
        )

        assistant_cursor = await self._connection.execute(
            f"""
            SELECT position FROM conversation_messages
            WHERE {" AND ".join([*base_clauses, "role='assistant'"])}
            ORDER BY position DESC LIMIT 1
            """,
            tuple(base_params),
        )
        assistant_row = await assistant_cursor.fetchone()
        if assistant_row is not None:
            return int(assistant_row[0])

        fallback_cursor = await self._connection.execute(
            f"""
            SELECT position FROM conversation_messages
            WHERE {" AND ".join(base_clauses)}
            ORDER BY position DESC LIMIT 1
            """,
            tuple(base_params),
        )
        fallback_row = await fallback_cursor.fetchone()
        return int(fallback_row[0]) if fallback_row is not None else None


def _decode_history_cursor(cursor: str | None) -> int | None:
    if not cursor:
        return None
    value = cursor.strip()
    if not value.startswith("pos:"):
        return None
    try:
        position = int(value[4:])
    except ValueError:
        return None
    return position if position > 0 else None


def _encode_history_cursor(position: int) -> str:
    return f"pos:{position}"
