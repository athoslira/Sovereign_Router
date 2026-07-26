# Hermes model routing

Sovereign Router treats a Hermes model route as an explicit allowlist entry. The Gatekeeper can select a route only when the alias is configured in both Sovereign Router and the Hermes API server.

## Current routes

| Alias | OpenRouter model |
|---|---|
| `sr-deepseek-deepseek-v4-flash` | `deepseek/deepseek-v4-flash` |
| `sr-deepseek-deepseek-v4-pro` | `deepseek/deepseek-v4-pro` |
| `sr-qwen-qwen3-7-max` | `qwen/qwen3.7-max` |
| `sr-qwen-qwen3-7-plus` | `qwen/qwen3.7-plus` |
| `sr-moonshotai-kimi-k2-7-code` | `moonshotai/kimi-k2.7-code` |
| `sr-x-ai-grok-4-3` | `x-ai/grok-4.3` |

For a Hermes session chosen automatically, the Gatekeeper returns an approved `hermes_model` alias. Sovereign Router verifies that Hermes advertises the alias through `/v1/models`, then sends it in the `/v1/runs` request. A manual Hermes session uses **Default Hermes model route**.

## Approving a newly researched model

The 15-day catalog refresh is discovery only. It must not grant a model new routing authority or silently change Hermes configuration.

After reviewing a new model, approve it in this order:

1. Add its OpenRouter slug to **Permitted executor models**.
2. Add a deterministic alias to **Hermes model routes** in the form `sr-provider-model = provider/model`.
3. Add the matching alias under `platforms.api_server.extra.model_routes` in Hermes `config.yaml`, using provider `openrouter` unless the route intentionally uses another configured provider.
4. Restart Hermes Gateway and verify the alias appears in `GET /v1/models`.

This two-sided approval prevents an unreviewed catalog item from becoming an executable Hermes route. If the alias is absent from Hermes, Sovereign Router stops the run with an actionable error rather than silently falling back to a different model.

## Skills and MCPs

In a **Hermes Agent** session, Hermes is the only tool authority:

- Hermes loads its own enabled skills from its profile.
- Hermes connects to its own `mcp_servers`, handles OAuth, and applies its own tool and dangerous-action approvals.
- Sovereign Router does not forward its direct MCP connections. It can pass one selected vault/GitHub skill as read-only advisory strategy text; that text grants no tools, MCP access, filesystem access, or permissions.
- Vault context and explicitly attached documents remain prepared by Sovereign Router and are supplied as task context.

Keep Sovereign-native skills and MCP connections for **Sovereign chat**. Migrating them requires an inventory and explicit re-authentication or installation in Hermes; it is not a safe blind copy.
