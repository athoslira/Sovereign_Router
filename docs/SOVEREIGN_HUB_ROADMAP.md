# Sovereign Hub roadmap

Sovereign Hub is the local control plane for durable tasks, model policy, approved capabilities, execution evidence, and Hermes orchestration. Sovereign Router remains the Obsidian interface and vault-context surface; Hermes remains the execution runtime. The Hub never makes Obsidian execute a terminal, local MCP, renderer, or agent directly.

## Phase 1 — Task foundation

Implemented in the local `sovereign-bridge` Hermes plugin.

- Authenticated loopback `/v1/hub` API, sharing the existing Agent Kernel key and strict origin allowlist.
- Durable SQLite task and run records with explicit state transitions.
- Sanitized lifecycle events; no hidden chat prompts, tool arguments, or secrets in the Hub store. Task titles and summaries are deliberate persisted metadata and must remain non-secret.
- No Hermes execution starts from the Hub in this phase. Existing Router-to-Hermes chat remains unchanged.

The stable protocol is `HubTaskSpecV1`: a title, bounded non-secret summary, and a kind (`general`, `research`, `code`, `automation`, `media`, or `analysis`). The lifecycle is `draft → planned → queued → running → awaiting_approval → verifying → completed|failed|cancelled`. A failed task may return to `queued`.

## Phase 2 — Governed execution and MCP registry

- Implemented binding adapter: a Hub run binds to an existing governed Hermes execution and mirrors its safe lifecycle events. Late binding synchronizes the current state rather than losing events.
- Implemented verifier gate: Hermes session completion transitions the Hub run to `verifying`; only an explicit `pass` or `fail` with a non-secret evidence summary can complete it.
- Implemented run-scoped MCP registry for `stdio` and `streamable_http` server references. The registry records advertised schemas and makes a per-tool `allow`, `ask`, or `deny` decision without executing a tool.
- The registry deliberately does not launch a process, resolve a network endpoint, store credentials, or retain raw tool arguments. Hermes remains the owner of MCP transport and configuration.
- Automated tests cover task/run binding, event mirroring, verification, server/schema registration, scope enforcement, and approval decisions. A dependency-free benchmark measures SQLite and loopback API latency.

The next increment will add health checks and schema refresh from Hermes-configured MCPs. Actual MCP transport remains in Hermes rather than being duplicated by the Hub.

## Phase 3 — Router console and operational policy

Implemented in Sovereign Router and the local bridge.

- The **Control center** has a Sovereign Hub section with durable tasks, their runs, sanitized lifecycle history, registered MCP schemas, and an explicit verification action.
- A user can create a non-secret task record and plan it from the console. A governed **Hermes Agent** chat automatically creates a task and Hub run, then binds the run to the same Agent Kernel execution after Hermes accepts it.
- The console refreshes through the authenticated loopback API every five seconds while it is open, with a manual **Refresh** action. It does not open a socket, start a tool, or execute a command from Obsidian.
- Run completion is deliberately not treated as task success: it enters `verifying`. A concise non-secret evidence record must explicitly pass or fail the run.
- Direct Router-to-Hermes execution remains the safe fallback. If creating or binding the Hub record fails, the governed Hermes session continues and the chat reports that the Hub attachment was unavailable.

### Current operational boundary

The Hub is now the durable observability, lifecycle, evidence, and MCP-policy plane; Hermes still owns runtime launch, terminals, agent loops, MCP transport, credentials, and dangerous-command approvals. In particular, manually creating a Hub task does not launch Hermes, and the Hub does not yet impose a separate central model-price or time-budget policy. Model routing continues to use the existing Router settings and Hermes model catalog. These are intentional next increments, not hidden behavior: they require a Hub-to-Hermes launch hand-off that can relay an immediate request without persisting prompts or secrets.

## Acceptance boundary

Phases 1–3 validate the durable lifecycle and its allowed transitions. A verifier record is required before a Hub task completes. MCP decisions are scoped to a Hub run and its declared server schema; actual availability remains Hermes-owned. Terminal, local MCP, filesystem writes, network effects, and rendering retain the Hermes/Agent Kernel approval boundary.
