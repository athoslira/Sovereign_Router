"""Small local SQLite event store. Raw tool arguments and secrets are never stored."""

from __future__ import annotations

import json
from pathlib import Path
import sqlite3
import threading
import time
import re
from typing import Any, Mapping
from contextlib import contextmanager
import uuid


HUB_TASK_STATES = frozenset({"draft", "planned", "queued", "running", "awaiting_approval", "verifying", "completed", "failed", "cancelled"})
HUB_RUN_STATES = frozenset({"queued", "running", "awaiting_approval", "verifying", "completed", "failed", "cancelled"})
HUB_TASK_TRANSITIONS = {
    "draft": frozenset({"planned", "cancelled"}),
    "planned": frozenset({"queued", "cancelled"}),
    "queued": frozenset({"running", "cancelled"}),
    "running": frozenset({"awaiting_approval", "verifying", "failed", "cancelled"}),
    "awaiting_approval": frozenset({"running", "cancelled"}),
    "verifying": frozenset({"running", "completed", "failed", "cancelled"}),
    "failed": frozenset({"queued", "cancelled"}),
    "completed": frozenset(),
    "cancelled": frozenset(),
}
HUB_RUN_TRANSITIONS = {state: HUB_TASK_TRANSITIONS[state] & HUB_RUN_STATES for state in HUB_RUN_STATES}
HUB_MCP_TRANSPORTS = frozenset({"stdio", "streamable_http"})
HUB_MCP_SESSION_STATES = frozenset({"active", "closed"})
HUB_MCP_TOOL_NAME = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")


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
                CREATE TABLE IF NOT EXISTS hub_tasks (
                    id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL, summary TEXT NOT NULL,
                    state TEXT NOT NULL, created_at REAL NOT NULL, updated_at REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS hub_tasks_updated ON hub_tasks(updated_at DESC);
                CREATE TABLE IF NOT EXISTS hub_runs (
                    id TEXT PRIMARY KEY, task_id TEXT NOT NULL, state TEXT NOT NULL,
                    executor TEXT, model TEXT, hermes_run_id TEXT, execution_id TEXT,
                    created_at REAL NOT NULL, updated_at REAL NOT NULL,
                    FOREIGN KEY(task_id) REFERENCES hub_tasks(id)
                );
                CREATE INDEX IF NOT EXISTS hub_runs_task ON hub_runs(task_id, updated_at DESC);
                CREATE TABLE IF NOT EXISTS hub_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, run_id TEXT,
                    type TEXT NOT NULL, summary TEXT NOT NULL, created_at REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS hub_events_task ON hub_events(task_id, id);
                CREATE TABLE IF NOT EXISTS hub_mcp_servers (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, transport TEXT NOT NULL,
                    server_ref TEXT NOT NULL, state TEXT NOT NULL, created_at REAL NOT NULL, updated_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS hub_mcp_tools (
                    server_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL,
                    input_schema TEXT NOT NULL, read_only INTEGER NOT NULL, external_effect INTEGER NOT NULL,
                    PRIMARY KEY(server_id, name), FOREIGN KEY(server_id) REFERENCES hub_mcp_servers(id)
                );
                CREATE TABLE IF NOT EXISTS hub_mcp_sessions (
                    id TEXT PRIMARY KEY, run_id TEXT NOT NULL, server_id TEXT NOT NULL,
                    tool_names TEXT NOT NULL, state TEXT NOT NULL, created_at REAL NOT NULL, updated_at REAL NOT NULL,
                    FOREIGN KEY(run_id) REFERENCES hub_runs(id), FOREIGN KEY(server_id) REFERENCES hub_mcp_servers(id)
                );
                CREATE INDEX IF NOT EXISTS hub_mcp_sessions_run ON hub_mcp_sessions(run_id, updated_at DESC);
            """)
            columns = {row[1] for row in db.execute("PRAGMA table_info(grants)").fetchall()}
            if "session_id" not in columns:
                db.execute("ALTER TABLE grants ADD COLUMN session_id TEXT NOT NULL DEFAULT ''")
            hub_run_columns = {row[1] for row in db.execute("PRAGMA table_info(hub_runs)").fetchall()}
            if "hermes_run_id" not in hub_run_columns:
                db.execute("ALTER TABLE hub_runs ADD COLUMN hermes_run_id TEXT")
            if "execution_id" not in hub_run_columns:
                db.execute("ALTER TABLE hub_runs ADD COLUMN execution_id TEXT")

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
            now = time.time()
            result = db.execute("UPDATE executions SET status=?, updated_at=? WHERE id=?", (status[:40], now, execution_id))
            if result.rowcount > 0:
                mapping = db.execute("SELECT id,task_id,state FROM hub_runs WHERE execution_id=? ORDER BY updated_at DESC LIMIT 1", (execution_id,)).fetchone()
                state_map = {"created": "queued", "running": "running", "waiting": "awaiting_approval", "completed": "verifying", "failed": "failed", "denied": "cancelled"}
                target = state_map.get(status)
                if mapping and target and mapping[2] != target:
                    db.execute("UPDATE hub_runs SET state=?,updated_at=? WHERE id=?", (target, now, mapping[0]))
                    db.execute("UPDATE hub_tasks SET state=?,updated_at=? WHERE id=?", (target, now, mapping[1]))
                    if target in {"failed", "cancelled"}:
                        db.execute("UPDATE hub_mcp_sessions SET state='closed',updated_at=? WHERE run_id=? AND state='active'", (now, mapping[0]))
                    self._add_hub_event(db, mapping[1], "run.synchronized", f"Governed execution checkpointed {target}.", mapping[0])
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

    @staticmethod
    def _hub_task(row) -> dict[str, Any]:
        return {"id": row[0], "title": row[1], "kind": row[2], "summary": row[3], "state": row[4], "created_at": row[5], "updated_at": row[6]}

    @staticmethod
    def _hub_run(row) -> dict[str, Any]:
        return {"id": row[0], "task_id": row[1], "state": row[2], "executor": row[3], "model": row[4], "hermes_run_id": row[5], "execution_id": row[6], "created_at": row[7], "updated_at": row[8]}

    @staticmethod
    def _hub_summary(value: str) -> str:
        return " ".join(value.split())[:1_000]

    def _add_hub_event(self, db: sqlite3.Connection, task_id: str, event_type: str, summary: str, run_id: str | None = None) -> None:
        db.execute(
            "INSERT INTO hub_events(task_id,run_id,type,summary,created_at) VALUES(?,?,?,?,?)",
            (task_id, run_id, event_type[:80], self._hub_summary(summary)[:240], time.time()),
        )

    def create_hub_task(self, title: str, kind: str, summary: str = "") -> dict[str, Any]:
        safe_title = self._hub_summary(title)[:200]
        safe_kind = kind.strip().lower()
        if not safe_title or safe_kind not in {"general", "research", "code", "automation", "media", "analysis"}:
            raise ValueError("Invalid Hub task")
        task_id, now = f"task-{uuid.uuid4()}", time.time()
        with self._lock, self._connect() as db:
            db.execute(
                "INSERT INTO hub_tasks(id,title,kind,summary,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
                (task_id, safe_title, safe_kind, self._hub_summary(summary), "draft", now, now),
            )
            self._add_hub_event(db, task_id, "task.created", "Task created in the Sovereign Hub.")
        return self.get_hub_task(task_id) or {}

    def get_hub_task(self, task_id: str) -> dict[str, Any] | None:
        with self._connect() as db:
            row = db.execute("SELECT id,title,kind,summary,state,created_at,updated_at FROM hub_tasks WHERE id=?", (task_id,)).fetchone()
        return self._hub_task(row) if row else None

    def list_hub_tasks(self, limit: int = 100) -> list[dict[str, Any]]:
        with self._connect() as db:
            rows = db.execute("SELECT id,title,kind,summary,state,created_at,updated_at FROM hub_tasks ORDER BY updated_at DESC LIMIT ?", (min(max(1, limit), 200),)).fetchall()
        return [self._hub_task(row) for row in rows]

    def transition_hub_task(self, task_id: str, state: str) -> dict[str, Any] | None:
        target = state.strip().lower()
        with self._lock, self._connect() as db:
            row = db.execute("SELECT state FROM hub_tasks WHERE id=?", (task_id,)).fetchone()
            if not row or target not in HUB_TASK_STATES or target not in HUB_TASK_TRANSITIONS.get(row[0], frozenset()):
                return None
            now = time.time()
            db.execute("UPDATE hub_tasks SET state=?,updated_at=? WHERE id=?", (target, now, task_id))
            self._add_hub_event(db, task_id, "task.transitioned", f"Task entered {target}.")
        return self.get_hub_task(task_id)

    def create_hub_run(self, task_id: str, executor: str | None = None, model: str | None = None) -> dict[str, Any] | None:
        safe_executor = self._hub_summary(executor or "")[:200] or None
        safe_model = self._hub_summary(model or "")[:200] or None
        with self._lock, self._connect() as db:
            task = db.execute("SELECT state FROM hub_tasks WHERE id=?", (task_id,)).fetchone()
            if not task or task[0] not in {"planned", "queued"}:
                return None
            now, run_id = time.time(), f"run-{uuid.uuid4()}"
            db.execute("UPDATE hub_tasks SET state='queued',updated_at=? WHERE id=?", (now, task_id))
            db.execute("INSERT INTO hub_runs(id,task_id,state,executor,model,hermes_run_id,execution_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)", (run_id, task_id, "queued", safe_executor, safe_model, None, None, now, now))
            self._add_hub_event(db, task_id, "run.created", "A Hub run was queued.", run_id)
        return self.get_hub_run(run_id)

    def get_hub_run(self, run_id: str) -> dict[str, Any] | None:
        with self._connect() as db:
            row = db.execute("SELECT id,task_id,state,executor,model,hermes_run_id,execution_id,created_at,updated_at FROM hub_runs WHERE id=?", (run_id,)).fetchone()
        return self._hub_run(row) if row else None

    def list_hub_runs(self, task_id: str, limit: int = 100) -> list[dict[str, Any]]:
        with self._connect() as db:
            rows = db.execute("SELECT id,task_id,state,executor,model,hermes_run_id,execution_id,created_at,updated_at FROM hub_runs WHERE task_id=? ORDER BY updated_at DESC LIMIT ?", (task_id, min(max(1, limit), 200))).fetchall()
        return [self._hub_run(row) for row in rows]

    def transition_hub_run(self, run_id: str, state: str) -> dict[str, Any] | None:
        target = state.strip().lower()
        with self._lock, self._connect() as db:
            row = db.execute("SELECT task_id,state FROM hub_runs WHERE id=?", (run_id,)).fetchone()
            if not row or target not in HUB_RUN_STATES or target not in HUB_RUN_TRANSITIONS.get(row[1], frozenset()):
                return None
            task_id, now = row[0], time.time()
            db.execute("UPDATE hub_runs SET state=?,updated_at=? WHERE id=?", (target, now, run_id))
            db.execute("UPDATE hub_tasks SET state=?,updated_at=? WHERE id=?", (target, now, task_id))
            if target in {"completed", "failed", "cancelled"}:
                db.execute("UPDATE hub_mcp_sessions SET state='closed',updated_at=? WHERE run_id=? AND state='active'", (now, run_id))
            self._add_hub_event(db, task_id, "run.transitioned", f"Run entered {target}.", run_id)
        return self.get_hub_run(run_id)

    def bind_hub_run(self, run_id: str, execution_id: str, hermes_run_id: str) -> dict[str, Any] | None:
        if not execution_id.strip() or not hermes_run_id.strip():
            return None
        with self._lock, self._connect() as db:
            run = db.execute("SELECT task_id,state FROM hub_runs WHERE id=?", (run_id,)).fetchone()
            execution = db.execute("SELECT id,run_id,status FROM executions WHERE id=?", (execution_id,)).fetchone()
            if not run or not execution or run[1] != "queued" or execution[1] not in {None, hermes_run_id}:
                return None
            now = time.time()
            state_map = {"created": "queued", "running": "running", "waiting": "awaiting_approval", "completed": "verifying", "failed": "failed", "denied": "cancelled"}
            synchronized_state = state_map.get(execution[2], "queued")
            db.execute("UPDATE hub_runs SET execution_id=?,hermes_run_id=?,state=?,updated_at=? WHERE id=?", (execution_id[:200], hermes_run_id[:200], synchronized_state, now, run_id))
            db.execute("UPDATE hub_tasks SET state=?,updated_at=? WHERE id=?", (synchronized_state, now, run[0]))
            self._add_hub_event(db, run[0], "run.bound", "The Hub run was bound to a governed Hermes execution.", run_id)
            if synchronized_state != "queued":
                self._add_hub_event(db, run[0], "run.synchronized", f"Bound execution was already {synchronized_state}.", run_id)
        return self.get_hub_run(run_id)

    def transition_hub_run_for_execution(self, execution_id: str, state: str) -> dict[str, Any] | None:
        with self._connect() as db:
            row = db.execute("SELECT id,state FROM hub_runs WHERE execution_id=? ORDER BY updated_at DESC LIMIT 1", (execution_id,)).fetchone()
        if not row or row[1] == state:
            return self.get_hub_run(row[0]) if row else None
        return self.transition_hub_run(row[0], state)

    def add_hub_event_for_execution(self, execution_id: str, event_type: str, summary: str) -> None:
        with self._lock, self._connect() as db:
            row = db.execute("SELECT id,task_id FROM hub_runs WHERE execution_id=? ORDER BY updated_at DESC LIMIT 1", (execution_id,)).fetchone()
            if row:
                self._add_hub_event(db, row[1], event_type, summary, row[0])

    def verify_hub_run(self, run_id: str, verdict: str, evidence_summary: str) -> dict[str, Any] | None:
        target = "completed" if verdict.strip().lower() == "pass" else "failed" if verdict.strip().lower() == "fail" else ""
        safe_evidence = self._hub_summary(evidence_summary)
        if not target or not safe_evidence:
            return None
        with self._lock, self._connect() as db:
            run = db.execute("SELECT task_id,state FROM hub_runs WHERE id=?", (run_id,)).fetchone()
            if not run or run[1] != "verifying":
                return None
            now = time.time()
            db.execute("UPDATE hub_runs SET state=?,updated_at=? WHERE id=?", (target, now, run_id))
            db.execute("UPDATE hub_tasks SET state=?,updated_at=? WHERE id=?", (target, now, run[0]))
            if target in {"completed", "failed"}:
                db.execute("UPDATE hub_mcp_sessions SET state='closed',updated_at=? WHERE run_id=? AND state='active'", (now, run_id))
            self._add_hub_event(db, run[0], "run.verified", f"Verifier returned {verdict.strip().upper()}: {safe_evidence}", run_id)
        return self.get_hub_run(run_id)

    @staticmethod
    def _hub_mcp_server(row, tools: list[dict[str, Any]]) -> dict[str, Any]:
        return {"id": row[0], "name": row[1], "transport": row[2], "server_ref": row[3], "state": row[4], "created_at": row[5], "updated_at": row[6], "tools": tools}

    def _list_hub_mcp_tools(self, db: sqlite3.Connection, server_id: str) -> list[dict[str, Any]]:
        rows = db.execute("SELECT name,description,input_schema,read_only,external_effect FROM hub_mcp_tools WHERE server_id=? ORDER BY name", (server_id,)).fetchall()
        results: list[dict[str, Any]] = []
        for row in rows:
            try:
                schema = json.loads(row[2])
            except json.JSONDecodeError:
                schema = {}
            results.append({"name": row[0], "description": row[1], "input_schema": schema, "read_only": bool(row[3]), "external_effect": bool(row[4])})
        return results

    def register_hub_mcp_server(self, name: str, transport: str, server_ref: str, tools: list[Mapping[str, Any]]) -> dict[str, Any] | None:
        safe_name, safe_transport, safe_ref = self._hub_summary(name)[:160], transport.strip().lower(), self._hub_summary(server_ref)[:200]
        if not safe_name or safe_transport not in HUB_MCP_TRANSPORTS or not safe_ref or not 0 < len(tools) <= 100:
            return None
        normalized_tools: list[tuple[str, str, str, int, int]] = []
        names: set[str] = set()
        for tool in tools:
            tool_name = tool.get("name") if isinstance(tool, Mapping) else None
            description = tool.get("description", "") if isinstance(tool, Mapping) else ""
            schema = tool.get("input_schema", {}) if isinstance(tool, Mapping) else {}
            read_only = tool.get("read_only", False) if isinstance(tool, Mapping) else False
            external_effect = tool.get("external_effect", True) if isinstance(tool, Mapping) else True
            if not isinstance(tool_name, str) or not HUB_MCP_TOOL_NAME.fullmatch(tool_name) or tool_name in names or not isinstance(description, str) or not isinstance(schema, Mapping) or not isinstance(read_only, bool) or not isinstance(external_effect, bool):
                return None
            try:
                encoded_schema = json.dumps(dict(schema), separators=(",", ":"))
            except (TypeError, ValueError):
                return None
            if len(encoded_schema) > 20_000:
                return None
            names.add(tool_name)
            normalized_tools.append((tool_name, self._hub_summary(description)[:500], encoded_schema, int(read_only), int(external_effect)))
        server_id, now = f"mcp-{uuid.uuid4()}", time.time()
        with self._lock, self._connect() as db:
            db.execute("INSERT INTO hub_mcp_servers(id,name,transport,server_ref,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?)", (server_id, safe_name, safe_transport, safe_ref, "registered", now, now))
            db.executemany("INSERT INTO hub_mcp_tools(server_id,name,description,input_schema,read_only,external_effect) VALUES(?,?,?,?,?,?)", [(server_id, *tool) for tool in normalized_tools])
        return self.get_hub_mcp_server(server_id)

    def get_hub_mcp_server(self, server_id: str) -> dict[str, Any] | None:
        with self._connect() as db:
            row = db.execute("SELECT id,name,transport,server_ref,state,created_at,updated_at FROM hub_mcp_servers WHERE id=?", (server_id,)).fetchone()
            return self._hub_mcp_server(row, self._list_hub_mcp_tools(db, server_id)) if row else None

    def list_hub_mcp_servers(self, limit: int = 100) -> list[dict[str, Any]]:
        with self._connect() as db:
            rows = db.execute("SELECT id,name,transport,server_ref,state,created_at,updated_at FROM hub_mcp_servers ORDER BY updated_at DESC LIMIT ?", (min(max(1, limit), 200),)).fetchall()
            return [self._hub_mcp_server(row, self._list_hub_mcp_tools(db, row[0])) for row in rows]

    def create_hub_mcp_session(self, run_id: str, server_id: str, tool_names: list[str]) -> dict[str, Any] | None:
        if not 0 < len(tool_names) <= 100 or len(set(tool_names)) != len(tool_names) or not all(isinstance(name, str) and HUB_MCP_TOOL_NAME.fullmatch(name) for name in tool_names):
            return None
        with self._lock, self._connect() as db:
            run = db.execute("SELECT task_id,state FROM hub_runs WHERE id=?", (run_id,)).fetchone()
            server = db.execute("SELECT id FROM hub_mcp_servers WHERE id=? AND state='registered'", (server_id,)).fetchone()
            available = {row[0] for row in db.execute("SELECT name FROM hub_mcp_tools WHERE server_id=?", (server_id,)).fetchall()}
            if not run or run[1] not in {"queued", "running", "awaiting_approval"} or not server or not set(tool_names).issubset(available):
                return None
            now, session_id = time.time(), f"mcp-session-{uuid.uuid4()}"
            db.execute("INSERT INTO hub_mcp_sessions(id,run_id,server_id,tool_names,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?)", (session_id, run_id, server_id, json.dumps(tool_names), "active", now, now))
            self._add_hub_event(db, run[0], "mcp.session.created", "An MCP session was scoped to this run.", run_id)
        return self.get_hub_mcp_session(session_id)

    def get_hub_mcp_session(self, session_id: str) -> dict[str, Any] | None:
        with self._connect() as db:
            row = db.execute("SELECT id,run_id,server_id,tool_names,state,created_at,updated_at FROM hub_mcp_sessions WHERE id=?", (session_id,)).fetchone()
        return self._hub_mcp_session(row) if row else None

    @staticmethod
    def _hub_mcp_session(row) -> dict[str, Any]:
        return {"id": row[0], "run_id": row[1], "server_id": row[2], "tool_names": json.loads(row[3]), "state": row[4], "created_at": row[5], "updated_at": row[6]}

    def list_hub_mcp_sessions(self, run_id: str) -> list[dict[str, Any]]:
        with self._connect() as db:
            rows = db.execute("SELECT id,run_id,server_id,tool_names,state,created_at,updated_at FROM hub_mcp_sessions WHERE run_id=? ORDER BY updated_at DESC", (run_id,)).fetchall()
        return [self._hub_mcp_session(row) for row in rows]

    def decide_hub_mcp_tool(self, session_id: str, tool_name: str) -> dict[str, str]:
        with self._connect() as db:
            session = db.execute("SELECT run_id,server_id,tool_names,state FROM hub_mcp_sessions WHERE id=?", (session_id,)).fetchone()
            if not session or session[3] != "active":
                return {"decision": "deny", "reason": "The MCP session is unavailable."}
            if tool_name not in json.loads(session[2]):
                return {"decision": "deny", "reason": "The tool is outside this run's MCP scope."}
            tool = db.execute("SELECT read_only,external_effect FROM hub_mcp_tools WHERE server_id=? AND name=?", (session[1], tool_name)).fetchone()
            if not tool:
                return {"decision": "deny", "reason": "The MCP tool is no longer registered."}
            if bool(tool[0]) and not bool(tool[1]):
                return {"decision": "allow", "reason": "Read-only MCP tool is in the approved run scope."}
            return {"decision": "ask", "reason": "MCP tool can create an external effect or write data."}

    def close_hub_mcp_sessions(self, run_id: str) -> int:
        with self._lock, self._connect() as db:
            result = db.execute("UPDATE hub_mcp_sessions SET state='closed',updated_at=? WHERE run_id=? AND state='active'", (time.time(), run_id))
            return result.rowcount

    def list_hub_events(self, task_id: str, limit: int = 200) -> list[dict[str, Any]]:
        with self._connect() as db:
            rows = db.execute("SELECT id,task_id,run_id,type,summary,created_at FROM hub_events WHERE task_id=? ORDER BY id DESC LIMIT ?", (task_id, min(max(1, limit), 500))).fetchall()
        return [{"id": row[0], "task_id": row[1], "run_id": row[2], "type": row[3], "summary": row[4], "created_at": row[5]} for row in rows]
