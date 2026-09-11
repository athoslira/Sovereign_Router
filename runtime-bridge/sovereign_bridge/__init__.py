"""Official Hermes standalone plugin entry point for Sovereign Router."""

from __future__ import annotations

import os
from pathlib import Path
import time
from typing import Any

from .policy import PolicyContext, decide_tool
from .server import BridgeServer
from .store import RuntimeStore

_store: RuntimeStore | None = None
_server: BridgeServer | None = None


def _data_dir() -> Path:
    configured = os.environ.get("SOVEREIGN_BRIDGE_DATA_DIR")
    if configured: return Path(configured).expanduser()
    hermes_home = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))
    return hermes_home / "state" / "sovereign-router"


def _execution(identifier: str) -> dict[str, Any] | None:
    if not _store or not identifier: return None
    return _store.active_for_session(identifier) or _store.active_for_run(identifier)


def _event(name: str, summary: str, *, session_id: str = "", decision: str | None = None) -> None:
    execution = _execution(session_id)
    if execution and _store: _store.add_event(execution["id"], name, summary, decision)


def _pre_tool_call(tool_name: str = "", args: Any = None, session_id: str = "", task_id: str = "", **_kwargs: Any):
    session = session_id or task_id
    execution = _execution(session)
    if not execution: return None
    context = PolicyContext(tuple(execution["allowed_roots"]), tuple(execution["planned_write_paths"]))
    decision = decide_tool(tool_name, args if isinstance(args, dict) else {}, context)
    _event("tool.decision", f"{tool_name or 'unknown tool'}: {decision.reason}", session_id=session, decision=decision.action)
    if decision.action == "deny": return {"action": "block", "message": decision.reason}
    if decision.action == "ask":
        if _store and _store.is_revoked(decision.rule_key):
            return {"action": "block", "message": "This previously granted rule was revoked in the Sovereign Agent Kernel."}
        if _store: _store.checkpoint(execution["id"], "waiting")
        return {"action": "approve", "message": decision.reason, "rule_key": decision.rule_key}
    return None


def _post_tool_call(tool_name: str = "", session_id: str = "", task_id: str = "", **_kwargs: Any) -> None:
    _event("tool.completed", f"{tool_name or 'Tool'} completed.", session_id=session_id or task_id)


def _approval_requested(tool_name: str = "", description: str = "", session_id: str = "", session_key: str = "", **_kwargs: Any) -> None:
    session = session_id or session_key
    execution = _execution(session)
    if execution and _store: _store.checkpoint(execution["id"], "waiting")
    summary = description or f"Approval required for {tool_name or 'Hermes tool'}."
    _event("approval.required", summary, session_id=session)


def _approval_responded(choice: str = "", session_id: str = "", session_key: str = "", pattern_key: str = "", **_kwargs: Any) -> None:
    session = session_id or session_key
    execution = _execution(session)
    if _store and choice in {"session", "always"} and pattern_key.startswith("plugin_rule:"):
        grant_session = execution["session_id"] if execution else session
        _store.save_grant(pattern_key.removeprefix("plugin_rule:"), choice, grant_session)
    _event("approval.responded", f"Approval resolved with {choice or 'a user choice'}.", session_id=session)
    if execution and _store: _store.checkpoint(execution["id"], "running" if choice != "deny" else "denied")


def _subagent_start(session_id: str = "", **_kwargs: Any) -> None: _event("subagent.started", "A bounded subagent started.", session_id=session_id)
def _subagent_stop(session_id: str = "", **_kwargs: Any) -> None: _event("subagent.stopped", "A bounded subagent stopped.", session_id=session_id)
def _session_start(session_id: str = "", **_kwargs: Any) -> None: _event("session.started", "Governed Hermes session started.", session_id=session_id)
def _session_end(session_id: str = "", **_kwargs: Any) -> None:
    execution = _execution(session_id)
    _event("session.completed", "Governed Hermes session completed.", session_id=session_id)
    if execution and _store: _store.checkpoint(execution["id"], "completed")
    if _store: _store.expire_session_grants(session_id)


def register(ctx) -> None:
    global _store, _server
    _store = RuntimeStore(_data_dir() / "runtime.db")
    cutoff = time.time() - 30 * 86400
    _store.expire_events(cutoff)
    _store.expire_executions(cutoff)
    api_key = os.environ.get("SOVEREIGN_BRIDGE_API_KEY", "")
    if api_key:
        port = int(os.environ.get("SOVEREIGN_BRIDGE_PORT", "8643"))
        origins = tuple(origin.strip() for origin in os.environ.get("SOVEREIGN_BRIDGE_CORS_ORIGINS", "app://obsidian.md").split(",") if origin.strip())
        _server = BridgeServer(_store, api_key, port=port, allowed_origins=origins)
        try:
            _server.start()
        except OSError:
            # Another Hermes process may already own the loopback bridge.
            # Hooks remain active and the Sovereign client still fails closed
            # unless it can authenticate to the existing bridge.
            _server = None
    ctx.register_hook("on_session_start", _session_start)
    ctx.register_hook("on_session_end", _session_end)
    ctx.register_hook("pre_tool_call", _pre_tool_call)
    ctx.register_hook("post_tool_call", _post_tool_call)
    ctx.register_hook("pre_approval_request", _approval_requested)
    ctx.register_hook("post_approval_response", _approval_responded)
    ctx.register_hook("subagent_start", _subagent_start)
    ctx.register_hook("subagent_stop", _subagent_stop)
