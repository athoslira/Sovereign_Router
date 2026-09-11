"""Authenticated loopback control API for the Sovereign Agent Kernel."""

from __future__ import annotations

import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import re
import threading
import time
from typing import Any
from urllib.parse import urlparse

from .store import RuntimeStore

VERSION = "1.5.0"


class BridgeServer:
    def __init__(self, store: RuntimeStore, api_key: str, host: str = "127.0.0.1", port: int = 8643, allowed_origins: tuple[str, ...] = ("app://obsidian.md",)):
        if host not in {"127.0.0.1", "::1", "localhost"}:
            raise ValueError("The Agent Kernel bridge may bind only to loopback.")
        if len(api_key) < 24:
            raise ValueError("SOVEREIGN_BRIDGE_API_KEY must contain at least 24 characters.")
        if any(not origin or origin == "*" for origin in allowed_origins):
            raise ValueError("Agent Kernel CORS origins must be explicit.")
        self.store, self.api_key, self.host, self.port = store, api_key, host, port
        self.allowed_origins = frozenset(allowed_origins)
        self._server: ThreadingHTTPServer | None = None

    def start(self) -> ThreadingHTTPServer:
        if self._server:
            return self._server
        store, api_key, allowed_origins = self.store, self.api_key, self.allowed_origins

        class Handler(BaseHTTPRequestHandler):
            server_version = "SovereignBridge/1"
            def log_message(self, _format: str, *_args: Any) -> None: pass
            def _origin(self) -> str | None:
                origin = self.headers.get("Origin", "")
                return origin if origin in allowed_origins else None
            def _cors(self) -> None:
                origin = self._origin()
                if origin:
                    self.send_header("Access-Control-Allow-Origin", origin)
                    self.send_header("Vary", "Origin")
            def _auth(self) -> bool:
                expected = f"Bearer {api_key}"
                if hmac.compare_digest(self.headers.get("Authorization", ""), expected): return True
                self._json(401, {"message": "Unauthorized"}); return False
            def _body(self) -> dict[str, Any] | None:
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                    if length < 0 or length > 1_000_000: return None
                    value = json.loads(self.rfile.read(length) or b"{}")
                    return value if isinstance(value, dict) else None
                except (ValueError, json.JSONDecodeError): return None
            def _json(self, status: int, value: Any) -> None:
                data = json.dumps(value, separators=(",", ":")).encode()
                self.send_response(status); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(data))); self._cors(); self.end_headers(); self.wfile.write(data)
            def do_OPTIONS(self) -> None:
                if not self._origin(): self._json(403, {"message": "Origin not allowed"}); return
                self.send_response(204)
                self._cors()
                self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, Last-Event-ID")
                self.send_header("Access-Control-Max-Age", "600")
                self.end_headers()
            def do_GET(self) -> None:
                if not self._auth(): return
                path = urlparse(self.path).path
                if path == "/v1/health":
                    cutoff = time.time() - 30 * 86400
                    store.expire_events(cutoff)
                    store.expire_executions(cutoff)
                    self._json(200, {"status": "ok", "version": VERSION, "heartbeat_at": time.time(), "pending_approvals": store.pending_approvals()}); return
                if path == "/v1/capabilities":
                    self._json(200, {"version": 1, "policy": "balanced", "approvals": ["once", "session", "always", "deny"], "image": {"local_svg": True, "hermes_discovery": True}}); return
                if path == "/v1/grants":
                    self._json(200, {"data": store.list_grants()}); return
                if path == "/v1/events":
                    self._json(200, {"data": store.list_recent_events()}); return
                match = re.fullmatch(r"/v1/executions/([^/]+)(/events)?", path)
                if not match: self._json(404, {"message": "Not found"}); return
                execution_id, events = match.group(1), match.group(2)
                if events:
                    try: after = max(0, int(self.headers.get("Last-Event-ID", "0") or 0))
                    except ValueError: after = 0
                    payload = "".join(f"id: {event['id']}\ndata: {json.dumps(event, separators=(',', ':'))}\n\n" for event in store.list_events(execution_id, after))
                    data = payload.encode(); self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.send_header("Cache-Control", "no-cache"); self.send_header("Content-Length", str(len(data))); self._cors(); self.end_headers(); self.wfile.write(data); return
                value = store.get_execution(execution_id)
                self._json(200 if value else 404, value or {"message": "Execution not found"})
            def do_POST(self) -> None:
                if not self._auth(): return
                path, body = urlparse(self.path).path, self._body()
                if body is None: self._json(400, {"message": "Invalid JSON"}); return
                if path == "/v1/executions":
                    execution_id, session_id = body.get("id"), body.get("session_id")
                    roots, writes, capabilities = body.get("allowed_roots"), body.get("planned_write_paths"), body.get("capabilities")
                    bounded_strings = lambda value, maximum: isinstance(value, list) and len(value) <= maximum and all(isinstance(item, str) and 0 < len(item) <= 1_000 for item in value)
                    required = (body.get("version") == 1 and isinstance(execution_id, str) and 0 < len(execution_id) <= 200 and isinstance(session_id, str) and 0 < len(session_id) <= 200 and body.get("mode") == "governed" and bounded_strings(roots, 100) and bounded_strings(writes, 500) and bounded_strings(capabilities, 50))
                    if not required: self._json(400, {"message": "Invalid ExecutionEnvelopeV1"}); return
                    self._json(201, store.create_execution(body)); return
                match = re.fullmatch(r"/v1/executions/([^/]+)/checkpoint", path)
                if match:
                    status = str(body.get("status", "")); ok = bool(status) and store.checkpoint(match.group(1), status); self._json(200 if ok else 404, {"ok": ok}); return
                match = re.fullmatch(r"/v1/grants/([^/]+)/(revoke|restore)", path)
                if match:
                    ok = store.revoke_grant(match.group(1)) if match.group(2) == "revoke" else store.restore_grant(match.group(1))
                    self._json(200 if ok else 404, {"ok": ok}); return
                self._json(404, {"message": "Not found"})
            def do_PATCH(self) -> None:
                if not self._auth(): return
                match = re.fullmatch(r"/v1/executions/([^/]+)/bind-run", urlparse(self.path).path)
                body = self._body()
                if not match or body is None or not isinstance(body.get("run_id"), str): self._json(400, {"message": "Invalid bind request"}); return
                ok = store.bind_run(match.group(1), body["run_id"]); self._json(200 if ok else 404, {"ok": ok})

        self._server = ThreadingHTTPServer((self.host, self.port), Handler)
        threading.Thread(target=self._server.serve_forever, name="sovereign-bridge", daemon=True).start()
        return self._server

    def stop(self) -> None:
        if self._server: self._server.shutdown(); self._server.server_close(); self._server = None
