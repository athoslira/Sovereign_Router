import tempfile
import unittest
from pathlib import Path
import json
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import patch

from sovereign_bridge.policy import PolicyContext, decide_tool
from sovereign_bridge.store import RuntimeStore
from sovereign_bridge.server import BridgeServer
import sovereign_bridge


class PolicyTests(unittest.TestCase):
    def setUp(self):
        self.context = PolicyContext(
            allowed_roots=("Projects/Launch",),
            planned_write_paths=("Projects/Launch/plan.md",),
        )

    def test_balanced_policy(self):
        self.assertEqual(decide_tool("read_file", {"path": "Projects/Launch/brief.md"}, self.context).action, "allow")
        self.assertEqual(decide_tool("read_file", {}, self.context).action, "ask")
        self.assertEqual(decide_tool("get_url", {"url": "https://example.com"}, self.context).action, "ask")
        self.assertEqual(decide_tool("write_file", {"path": "Projects/Launch/plan.md"}, self.context).action, "allow")
        self.assertEqual(decide_tool("write_file", {"path": "Projects/Launch/other.md"}, self.context).action, "ask")
        self.assertEqual(decide_tool("read_file", {"path": "../secret"}, self.context).action, "deny")
        self.assertEqual(decide_tool("terminal", {"command": "rm -rf /"}, self.context).action, "deny")
        self.assertEqual(decide_tool("image_generate", {"prompt": "hero"}, self.context).action, "ask")

    def test_allows_absolute_paths_only_below_an_absolute_approved_root(self):
        windows = PolicyContext(allowed_roots=("C:/Vault",), planned_write_paths=())
        self.assertEqual(decide_tool("read_file", {"path": "C:/Vault/Projects/brief.md"}, windows).action, "allow")
        self.assertEqual(decide_tool("read_file", {"path": "C:/Other/secret.md"}, windows).action, "deny")


class StoreTests(unittest.TestCase):
    def test_persists_sanitized_events_and_expires_old_technical_logs(self):
        with tempfile.TemporaryDirectory() as folder:
            store = RuntimeStore(Path(folder) / "runtime.db")
            store.create_execution({
                "id": "exec-1", "session_id": "session-1", "mode": "governed",
                "allowed_roots": ["Projects/Launch"], "planned_write_paths": [],
            })
            store.bind_run("exec-1", "run-1")
            self.assertEqual(store.active_for_run("run-1")["id"], "exec-1")
            store.add_event("exec-1", "tool.decision", "terminal requires approval", "ask", {"api_key": "secret"}, created_at=1)
            events = store.list_events("exec-1")
            self.assertEqual(events[0]["summary"], "terminal requires approval")
            self.assertEqual(store.list_recent_events(1)[0]["execution_id"], "exec-1")
            self.assertNotIn("secret", str(events[0]))
            self.assertEqual(store.expire_events(before=2), 1)
            grant = store.save_grant("write_file:write", "always")
            self.assertEqual(store.list_grants()[0]["id"], grant["id"])
            self.assertFalse(store.is_revoked("write_file:write"))
            self.assertTrue(store.revoke_grant(grant["id"]))
            self.assertTrue(store.is_revoked("write_file:write"))
            self.assertTrue(store.restore_grant(grant["id"]))
            self.assertFalse(store.is_revoked("write_file:write"))
            session_grant = store.save_grant("terminal:external-effect", "session", "session-1")
            self.assertEqual(store.expire_session_grants("session-1"), 1)
            self.assertNotIn(session_grant["id"], {item["id"] for item in store.list_grants()})
            store.checkpoint("exec-1", "completed")
            self.assertEqual(store.expire_executions(before=store.get_execution("exec-1")["updated_at"] + 1), 1)


class ServerTests(unittest.TestCase):
    def test_authenticated_control_api_and_plugin_approval_directive(self):
        with tempfile.TemporaryDirectory() as folder:
            store = RuntimeStore(Path(folder) / "runtime.db")
            test_key = "test-" + ("x" * 24)
            server = BridgeServer(store, test_key, port=0)
            running = server.start()
            base = f"http://127.0.0.1:{running.server_address[1]}"
            headers = {"Authorization": f"Bearer {test_key}", "Content-Type": "application/json"}
            try:
                preflight = urlopen(Request(base + "/v1/health", headers={"Origin": "app://obsidian.md", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization"}, method="OPTIONS"), timeout=2)
                self.assertEqual(preflight.status, 204)
                self.assertEqual(preflight.headers["Access-Control-Allow-Origin"], "app://obsidian.md")
                health = json.loads(urlopen(Request(base + "/v1/health", headers=headers), timeout=2).read())
                self.assertEqual(health["status"], "ok")
                envelope = {"version": 1, "id": "exec-http", "session_id": "session-http", "mode": "governed", "allowed_roots": ["Projects"], "planned_write_paths": [], "capabilities": ["tools"]}
                created = json.loads(urlopen(Request(base + "/v1/executions", data=json.dumps(envelope).encode(), headers=headers, method="POST"), timeout=2).read())
                self.assertEqual(created["id"], "exec-http")
                previous = sovereign_bridge._store
                sovereign_bridge._store = store
                try:
                    directive = sovereign_bridge._pre_tool_call(tool_name="write_file", args={"path": "Projects/unplanned.md", "api_key": "secret"}, session_id="session-http")
                    self.assertEqual(directive["action"], "approve")
                    self.assertEqual(store.get_execution("exec-http")["status"], "waiting")
                    sovereign_bridge._approval_responded(choice="once", session_key="session-http")
                    self.assertEqual(store.get_execution("exec-http")["status"], "running")
                    sovereign_bridge._approval_responded(choice="always", session_key="session-http", pattern_key="plugin_rule:write_file:write")
                    self.assertEqual(store.list_grants()[0]["rule_key"], "write_file:write")
                    store.bind_run("exec-http", "run-http")
                    sovereign_bridge._approval_requested(description="Confirm write", session_key="run-http")
                    sovereign_bridge._approval_responded(choice="session", session_key="run-http", pattern_key="plugin_rule:image_generate:external-effect")
                    self.assertEqual(store.expire_session_grants("session-http"), 1)
                    sovereign_bridge._approval_responded(choice="deny", session_key="run-http")
                    self.assertEqual(store.list_events("exec-http")[-1]["type"], "approval.responded")
                    self.assertNotIn("secret", str(store.list_events("exec-http")))
                finally:
                    sovereign_bridge._store = previous
                events = json.loads(urlopen(Request(base + "/v1/events", headers=headers), timeout=2).read())
                self.assertEqual(events["data"][0]["execution_id"], "exec-http")
                with self.assertRaises(HTTPError) as denied:
                    urlopen(base + "/v1/health", timeout=2)
                self.assertEqual(denied.exception.code, 401)
            finally:
                server.stop()

    def test_register_uses_only_official_hook_surface(self):
        class Context:
            def __init__(self): self.hooks = {}
            def register_hook(self, name, callback): self.hooks[name] = callback

        with tempfile.TemporaryDirectory() as folder, patch.dict("os.environ", {"SOVEREIGN_BRIDGE_DATA_DIR": folder, "SOVEREIGN_BRIDGE_API_KEY": ""}, clear=False):
            previous_store, previous_server = sovereign_bridge._store, sovereign_bridge._server
            context = Context()
            try:
                sovereign_bridge._server = None
                sovereign_bridge.register(context)
                self.assertEqual(set(context.hooks), {"on_session_start", "on_session_end", "pre_tool_call", "post_tool_call", "pre_approval_request", "post_approval_response", "subagent_start", "subagent_stop"})
                self.assertIsNone(sovereign_bridge._server)
            finally:
                sovereign_bridge._store, sovereign_bridge._server = previous_store, previous_server


if __name__ == "__main__":
    unittest.main()
