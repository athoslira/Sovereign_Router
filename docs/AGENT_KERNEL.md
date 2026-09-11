# Agent Kernel

The Agent Kernel is an optional local governance layer for Hermes runs. Sovereign Router 1.6.0 keeps ordinary OpenRouter chat and ungoverned Hermes compatibility unchanged; the fail-closed behavior applies only after **Enable Agent Kernel** is selected.

## What it controls

- A versioned `ExecutionEnvelopeV1` binds one Sovereign session to approved roots, explicit planned writes, and requested capabilities.
- The official Hermes `pre_tool_call` hook allows reads inside approved roots, allows exact writes named in an approved plan, asks for other writes/external effects/paid media, and blocks traversal, paths outside approved roots, and destructive commands.
- Hermes approval events appear inside Obsidian with **Allow once**, **Allow for session**, **Always allow rule**, and **Deny**. Sovereign posts the choice to Hermes' official run approval endpoint.
- Subagent start/stop events remain attached to the parent governed session.
- A local SQLite store retains sanitized summaries only. Raw arguments, prompts, file contents, and secrets are not persisted. Technical events expire after 30 days.

The bridge uses only Python's standard library and does not patch Hermes.

## Install the Hermes plugin

Requirements: a current Hermes build that supports standalone plugins, `pre_tool_call` approval directives, `/v1/runs/{run_id}/approval`, and `/v1/toolsets`.

1. Copy the repository folder `runtime-bridge/sovereign_bridge` to the active Hermes profile as `~/.hermes/plugins/sovereign_bridge`.
2. Enable it:

   ```powershell
   hermes plugins enable sovereign_bridge
   ```

   Hermes also accepts the manifest name `sovereign-bridge` on builds that enable plugins by manifest name.

3. Set `SOVEREIGN_BRIDGE_API_KEY` in the environment used to start the Hermes gateway. Use the same value as the Hermes API key referenced by Obsidian. It must contain at least 24 characters. Do not put the value in the vault or Git.
4. Restart the Hermes gateway. The bridge binds only to `127.0.0.1:8643` and allows the exact Obsidian desktop origin `app://obsidian.md`. Set `SOVEREIGN_BRIDGE_PORT` only if that port is occupied. If your Obsidian distribution reports a different origin, set an explicit comma-separated `SOVEREIGN_BRIDGE_CORS_ORIGINS`; wildcard origins are rejected.
5. In **Settings → Sovereign Router → Agent Kernel**, set the bridge URL, add the exact Hermes workspace/vault roots, enable the kernel, then select **Control → Test bridge**.

For Windows PowerShell 5.1, generate a key without newer framework methods:

```powershell
$rng = New-Object Security.Cryptography.RNGCryptoServiceProvider
$bytes = New-Object byte[] 32
$rng.GetBytes($bytes)
$ApiKey = -join ($bytes | ForEach-Object { $_.ToString('x2') })
$rng.Dispose()
$ApiKey
```

The Obsidian secret and `SOVEREIGN_BRIDGE_API_KEY` must contain the same value. Sovereign stores only the secret reference.

## Control API

All endpoints require `Authorization: Bearer <key>`:

- `GET /v1/health`
- `GET /v1/capabilities`
- `POST /v1/executions`
- `PATCH /v1/executions/{id}/bind-run`
- `GET /v1/executions/{id}`
- `GET /v1/executions/{id}/events` (SSE; supports `Last-Event-ID`)
- `POST /v1/executions/{id}/checkpoint`
- `GET /v1/grants`
- `GET /v1/events`
- `POST /v1/grants/{id}/revoke`
- `POST /v1/grants/{id}/restore`

The control center can list mirrored session/permanent grants. Revoking one creates a local deny override, so a matching action is blocked even if Hermes still has its own permanent allowlist entry. Remove the Hermes allowlist entry separately, then select **Restore requests** to let the next matching action follow Hermes approval policy again.

The database defaults to `~/.hermes/state/sovereign-router/runtime.db`. `SOVEREIGN_BRIDGE_DATA_DIR` can move it to another local directory. Sanitized events and execution envelopes expire after 30 days; session grants are removed when their Hermes session ends.

## Failure behavior

If the bridge is unreachable, Sovereign refuses to start a new governed Hermes operation. Existing OpenRouter chat and Hermes sessions with the kernel disabled remain available. A policy or approval failure is never converted into silent permission.
