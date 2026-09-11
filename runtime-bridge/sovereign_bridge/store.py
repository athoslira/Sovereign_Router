"""Small local SQLite event store. Raw tool arguments and secrets are never stored."""

from __future__ import annotations

import json
from pathlib import Path
import sqlite3
import threading
import time
from typing import Any, Mapping
from contextlib import contextmanager
import uuid


class RuntimeStore:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self._lock = threading.RLock()
        with self._connect() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS executions (
                    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, run_id TEXT,
                    mode TEXT NOT NULL, status TEXT NOT NULL, allowed_roots TEXT NOT NULL,
                    planned_write_paths TEXT NOT NULL, created_at REAL NOT NULL, updated_at REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS executions_session ON executions(session_id, updated_at DESC);
                CREATE TABLE IF NOT EXISTS events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, execution_id TEXT NOT NULL,
                    type TEXT NOT NULL, summary TEXT NOT NULL, decision TEXT, created_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS grants (
                    id TEXT PRIMARY KEY, rule_key TEXT NOT NULL, scope TEXT NOT NULL,
                    session_id TEXT NOT NULL DEFAULT '', revoked INTEGER NOT NULL DEFAULT 0, created_at REAL NOT NULL
                );
            """)
            columns = {row[1] for row in db.execute("PRAGMA table_info(grants)").fetchall()}
            if "session_id" not in columns:
                db.execute("ALTER TABLE grants ADD COLUMN session_id TEXT NOT NULL DEFAULT ''")

    @contextmanager
    def _connect(self):
        db = sqlite3.connect(self.path, timeout=5)
        try:
            yield db
            db.commit()
        finally:
            db.close()

    def create_execution(self, envelope: Mapping[str, Any]) -> dict[str, Any]:
        now = time.time()
        execution_id = str(envelope["id"])
        session_id = str(envelope["session_id"])
        mode = str(envelope.get("mode", "governed"))
        roots = [str(item) for item in envelope.get("allowed_roots", []) if isinstance(item, str)]
        writes = [str(item) for item in envelope.get("planned_write_paths", []) if isinstance(item, str)]
        with self._lock, self._connect() as db:
            db.execute(
                "INSERT OR REPLACE INTO executions VALUES (?, ?, NULL, ?, 'created', ?, ?, ?, ?)",
                (execution_id, session_id, mode, json.dumps(roots), json.dumps(writes), now, now),
            )
        return self.get_execution(execution_id) or {}

    def bind_run(self, execution_id: str, run_id: str) -> bool:
        with self._lock, self._connect() as db:
            result = db.execute("UPDATE executions SET run_id=?, status='running', updated_at=? WHERE id=?", (run_id, time.time(), execution_id))
            return result.rowcount > 0

    def checkpoint(self, execution_id: str, status: str) -> bool:
        with self._lock, self._connect() as db:
            result = db.execute("UPDATE executions SET status=?, updated_at=? WHERE id=?", (status[:40], time.time(), execution_id))
            return result.rowcount > 0

    def get_execution(self, execution_id: str) -> dict[str, Any] | None:
        with self._connect() as db:
            row = db.execute("SELECT id, session_id, run_id, mode, status, allowed_roots, planned_write_paths, created_at, updated_at FROM executions WHERE id=?", (execution_id,)).fetchone()
        return self._execution(row) if row else None

    def active_for_session(self, session_id: str) -> dict[str, Any] | None:
        with self._connect() as db:
            row = db.execute("SELECT id, session_id, run_id, mode, status, allowed_roots, planned_write_paths, created_at, updated_at FROM executions WHERE session_id=? AND status IN ('created','running','waiting') ORDER BY updated_at DESC LIMIT 1", (session_id,)).fetchone()
        return self._execution(row) if row else None

    def active_for_run(self, run_id: str) -> dict[str, Any] | None:
        with self._connect() as db:
            row = db.execute("SELECT id, session_id, run_id, mode, status, allowed_roots, planned_write_paths, created_at, updated_at FROM executions WHERE run_id=? AND status IN ('created','running','waiting') ORDER BY updated_at DESC LIMIT 1", (run_id,)).fetchone()
        return self._execution(row) if row else None

    @staticmethod
    def _execution(row) -> dict[str, Any]:
        return {"id": row[0], "session_id": row[1], "run_id": row[2], "mode": row[3], "status": row[4], "allowed_roots": json.loads(row[5]), "planned_write_paths": json.loads(row[6]), "created_at": row[7], "updated_at": row[8]}

    def add_event(self, execution_id: str, event_type: str, summary: str, decision: str | None = None, _unsafe_details: Any = None, created_at: float | None = None) -> int:
        safe_summary = " ".join(str(summary).split())[:240]
        with self._lock, self._connect() as db:
            cursor = db.execute("INSERT INTO events(execution_id,type,summary,decision,created_at) VALUES(?,?,?,?,?)", (execution_id, event_type[:80], safe_summary, decision if decision in {"allow", "ask", "deny"} else None, created_at or time.time()))
            return int(cursor.lastrowid)

    def list_events(self, execution_id: str, after_id: int = 0, limit: int = 200) -> list[dict[str, Any]]:
        with self._connect() as db:
            rows = db.execute("SELECT id, execution_id, type, created_at, summary, decision FROM events WHERE execution_id=? AND id>? ORDER BY id LIMIT ?", (execution_id, max(0, after_id), min(max(1, limit), 500))).fetchall()
        return [{"id": row[0], "execution_id": row[1], "type": row[2], "created_at": row[3], "summary": row[4], "decision": row[5]} for row in rows]

    def list_recent_events(self, limit: int = 50) -> list[dict[str, Any]]:
        with self._connect() as db:
            rows = db.execute(
                "SELECT id, execution_id, type, created_at, summary, decision FROM events ORDER BY id DESC LIMIT ?",
                (min(max(1, limit), 200),),
            ).fetchall()
        return [{"id": row[0], "execution_id": row[1], "type": row[2], "created_at": row[3], "summary": row[4], "decision": row[5]} for row in rows]

    def pending_approvals(self) -> int:
        with self._connect() as db:
            row = db.execute("SELECT COUNT(*) FROM executions WHERE status='waiting'").fetchone()
        return int(row[0] if row else 0)

    def expire_events(self, before: float) -> int:
        with self._lock, self._connect() as db:
            result = db.execute("DELETE FROM events WHERE created_at < ?", (before,))
            return result.rowcount

    def expire_executions(self, before: float) -> int:
        with self._lock, self._connect() as db:
            result = db.execute("DELETE FROM executions WHERE updated_at < ?", (before,))
            return result.rowcount

    def revoke_grant(self, grant_id: str) -> bool:
        with self._lock, self._connect() as db:
            row = db.execute("SELECT rule_key FROM grants WHERE id=?", (grant_id,)).fetchone()
            if not row: return False
            result = db.execute("UPDATE grants SET revoked=1 WHERE rule_key=?", (row[0],))
            return result.rowcount > 0

    def restore_grant(self, grant_id: str) -> bool:
        with self._lock, self._connect() as db:
            row = db.execute("SELECT rule_key FROM grants WHERE id=?", (grant_id,)).fetchone()
            if not row: return False
            result = db.execute("UPDATE grants SET revoked=0 WHERE rule_key=?", (row[0],))
            return result.rowcount > 0

    def save_grant(self, rule_key: str, scope: str, session_id: str = "") -> dict[str, Any]:
        grant_id = f"grant-{uuid.uuid4()}"
        created_at = time.time()
        with self._lock, self._connect() as db:
            db.execute("DELETE FROM grants WHERE rule_key=? AND scope=? AND session_id=?", (rule_key[:180], scope[:20], session_id[:180]))
            db.execute("INSERT INTO grants(id,rule_key,scope,session_id,revoked,created_at) VALUES(?,?,?,?,0,?)", (grant_id, rule_key[:180], scope[:20], session_id[:180], created_at))
        return {"id": grant_id, "rule_key": rule_key[:180], "scope": scope[:20], "revoked": False, "created_at": created_at}

    def list_grants(self) -> list[dict[str, Any]]:
        with self._connect() as db:
            rows = db.execute("SELECT id, rule_key, scope, revoked, created_at FROM grants ORDER BY created_at DESC LIMIT 200").fetchall()
        return [{"id": row[0], "rule_key": row[1], "scope": row[2], "revoked": bool(row[3]), "created_at": row[4]} for row in rows]

    def is_revoked(self, rule_key: str) -> bool:
        with self._connect() as db:
            row = db.execute("SELECT revoked FROM grants WHERE rule_key=? ORDER BY created_at DESC LIMIT 1", (rule_key,)).fetchone()
        return bool(row and row[0])

    def expire_session_grants(self, session_id: str) -> int:
        with self._lock, self._connect() as db:
            result = db.execute("DELETE FROM grants WHERE scope='session' AND session_id=?", (session_id,))
            return result.rowcount
