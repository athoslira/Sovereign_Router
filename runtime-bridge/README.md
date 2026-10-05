# Sovereign Agent Kernel bridge

This folder is an optional, local-only Hermes standalone plugin. It adds deterministic tool policy, approval escalation, sanitized event history, an authenticated loopback control API, and the first foundation of the Sovereign Hub task protocol. It does not fork or patch Hermes.

Copy `sovereign_bridge` to `~/.hermes/plugins/sovereign_bridge`, add `sovereign-bridge` to `plugins.enabled`, and set `SOVEREIGN_BRIDGE_API_KEY` to the same API-key value referenced by Sovereign Router's Hermes secret. The key must contain at least 24 characters. Restart the Hermes gateway after enabling it.

The service binds only to `127.0.0.1:8643` and permits the exact `app://obsidian.md` CORS origin by default. Override the explicit comma-separated allowlist with `SOVEREIGN_BRIDGE_CORS_ORIGINS`; wildcards are rejected. Technical events contain summaries, never raw tool arguments, and expire after 30 days. The SQLite database defaults to `~/.hermes/state/sovereign-router/runtime.db`; override it with `SOVEREIGN_BRIDGE_DATA_DIR`.

## Sovereign Hub foundation (phase 1)

The same authenticated loopback API exposes a durable, local task state machine at `/v1/hub`. It stores only bounded task titles and explicit non-secret summaries, task/run state, selected executor/model labels, and sanitized lifecycle events. It does **not** store hidden chat prompts, tool arguments, secrets, or a Hermes execution payload. Treat the persisted `summary` as task metadata and never include credentials or private source text in it.

`POST /v1/hub/tasks` accepts `HubTaskSpecV1` with `version`, `title`, optional `summary`, and a `kind` of `general`, `research`, `code`, `automation`, `media`, or `analysis`. Tasks use the explicit lifecycle `draft → planned → queued → running → awaiting_approval → verifying → completed|failed|cancelled`; failed tasks may be queued again. A run can be queued only for a planned task.

Phase 1 deliberately does not start Hermes work. Phase 2 adds a binding adapter and MCP registry: a queued Hub run can bind to an already-created governed Hermes execution, then inherits its sanitized lifecycle events and enters `verifying` when Hermes ends. The Hub requires a separate non-secret verifier result before it marks that run complete. The bridge does not launch a new Hermes run itself; Hermes remains the execution authority.

The Phase 2 MCP registry accepts metadata and advertised schemas for a Hermes-configured server reference. Each MCP session is scoped to one Hub run and an explicit allowlist of tool names. Read-only tools without external effects are allowed; every other registered tool produces an approval decision. The registry deliberately never stores a command, endpoint credential, raw tool arguments, or starts a stdio/HTTP server. Hermes owns its own MCP configuration and transport.

Run `python tests/benchmark_hub.py` from `runtime-bridge` for a local, dependency-free latency baseline. It creates an isolated temporary SQLite database and loopback bridge only; it does not call Hermes, a model, or an MCP server.
