# Hermes model routing

Sovereign Router treats a Hermes model route as an explicit allowlist entry. Hermes is the source of truth for alias-to-model mappings: Sovereign synchronizes `/v1/models`, uses each advertised `id` as the alias and `root` as the underlying model, and caches the last successful result for offline compatibility.

## Current routes

| Alias | OpenRouter model |
|---|---|
| `sr-deepseek-deepseek-v4-flash` | `deepseek/deepseek-v4-flash` |
| `sr-deepseek-deepseek-v4-pro` | `deepseek/deepseek-v4-pro` |
| `sr-qwen-qwen3-7-max` | `qwen/qwen3.7-max` |
| `sr-qwen-qwen3-7-plus` | `qwen/qwen3.7-plus` |
| `sr-moonshotai-kimi-k2-7-code` | `moonshotai/kimi-k2.7-code` |
| `sr-x-ai-grok-4-3` | `x-ai/grok-4.3` |

For a Hermes session chosen automatically, the Gatekeeper returns an approved `hermes_model` alias. Sovereign Router validates the alias against the synchronized runtime route and takes the underlying model from Hermes rather than from a duplicated text value in the Gatekeeper response. A manual Hermes session uses **Default Hermes model route**. If Hermes renames an alias but preserves its `root` model, Sovereign automatically selects the renamed alias.

## Approving a newly researched model

The 15-day catalog refresh is discovery only. It must not grant a model new routing authority or silently change Hermes configuration.

After reviewing a new model, approve it in this order:

1. Add its OpenRouter slug to **Permitted executor models**.
2. Add an alias under `platforms.api_server.extra.model_routes` in Hermes `config.yaml`, using provider `openrouter` unless the route intentionally uses another configured provider.
3. Restart Hermes Gateway and use **Sync routes** in Sovereign Router settings, or send a Hermes task; the plugin synchronizes automatically before routing.

This policy boundary prevents an unreviewed catalog item from becoming an executable Hermes route. Discovery does not add an item to **Permitted executor models**, and synchronizing aliases never changes Hermes configuration.

## Skills and MCPs

In a **Hermes Agent** session, Hermes is the only tool authority:

- Hermes loads its own enabled skills from its profile.
- Hermes connects to its own `mcp_servers`, handles OAuth, and applies its own tool and dangerous-action approvals.
- Sovereign Router does not forward its direct MCP connections. It can pass one selected vault/GitHub skill as read-only advisory strategy text; that text grants no tools, MCP access, filesystem access, or permissions.
- Vault context and explicitly attached documents remain prepared by Sovereign Router and are supplied as task context.

Keep Sovereign-native skills and MCP connections for **Sovereign chat**. Migrating them requires an inventory and explicit re-authentication or installation in Hermes; it is not a safe blind copy.
