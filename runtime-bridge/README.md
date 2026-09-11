# Sovereign Agent Kernel bridge

This folder is an optional, local-only Hermes standalone plugin. It adds deterministic tool policy, approval escalation, sanitized event history, and an authenticated loopback control API. It does not fork or patch Hermes.

Copy `sovereign_bridge` to `~/.hermes/plugins/sovereign_bridge`, add `sovereign-bridge` to `plugins.enabled`, and set `SOVEREIGN_BRIDGE_API_KEY` to the same API-key value referenced by Sovereign Router's Hermes secret. The key must contain at least 24 characters. Restart the Hermes gateway after enabling it.

The service binds only to `127.0.0.1:8643` and permits the exact `app://obsidian.md` CORS origin by default. Override the explicit comma-separated allowlist with `SOVEREIGN_BRIDGE_CORS_ORIGINS`; wildcards are rejected. Technical events contain summaries, never raw tool arguments, and expire after 30 days. The SQLite database defaults to `~/.hermes/state/sovereign-router/runtime.db`; override it with `SOVEREIGN_BRIDGE_DATA_DIR`.
