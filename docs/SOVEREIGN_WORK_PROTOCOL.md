# Sovereign Work Protocol

The Work Protocol is a local-first lifecycle for governed work. It turns an intent into durable artifacts without turning the Obsidian plugin into a terminal, Git client, or desktop agent host.

```text
Requirement → Plan → User approval → Hermes execution → Independent verification → Evidence
```

## Work item states

| State | Meaning |
| --- | --- |
| `draft` | Requirement exists; no plan has been accepted. |
| `planned` | A plan artifact exists and awaits human approval. |
| `approved` | The plan may be sent to a configured executor. |
| `running` | Hermes is executing the approved plan. |
| `verifying` | Execution ended; an independent verifier must assess evidence. |
| `completed` | Verification returned `VERDICT: PASS`. |
| `blocked` | Evidence is incomplete, verification was partial, or the user stopped the run. |
| `failed` | The executor or verifier failed. |
| `cancelled` | The item was deliberately cancelled before or after planning. |

Only valid transitions are accepted. A task cannot jump from draft directly to execution or from completed back to execution.

## Storage and artifacts

Private metadata is stored in the active vault at:

```text
.obsidian/plugins/sovereign-router/context/work-items/<work-id>.json
```

Human-readable artifacts are stored below the configurable **Work item output root** (`Sovereign/Tasks` by default):

```text
Sovereign/Tasks/<safe-title>-<work-id>/
  requirement.md
  plan.md
  execution.md
  evidence.md
```

The metadata contains the lifecycle, artifact paths and a short append-only event history. It does not contain API keys. The Markdown files are the review surface; the JSON file is the machine-readable state.

## Ownership boundaries

- **Sovereign Router:** creates tasks, plans, records, artifacts, policy checks, status and verification.
- **Hermes:** terminal, subagents, MCP stdio, actual worktree preparation, tool permissions and dangerous-command approvals.
- **VS Code adapter:** opens task artifacts in a coding workspace and may prepare a Git worktree after a local confirmation. It uses the same local task JSON; it does not expose a network service.

An `isolated-worktree` task is an explicit request, not a filesystem permission. If Hermes or the VS Code adapter cannot prepare it, the task remains blocked instead of silently changing the primary checkout.

## Cross-model review

Planning and verification are separate OpenRouter calls. The verifier receives the requirement, plan and execution evidence, and must return one of:

```text
VERDICT: PASS
VERDICT: PARTIAL
VERDICT: FAIL
```

Only `PASS` completes the work item. `PARTIAL` blocks it for review; `FAIL` marks it failed. Choose a different permitted model manually for the planning/verification session when stronger independent review is needed.

## VS Code adapter

The standalone adapter lives in [`vscode-extension/`](../vscode-extension/). It is deliberately separate from the Obsidian plugin because VS Code extensions can use desktop Git APIs while the plugin must stay mobile-compatible and must not use Node/Electron APIs.

The adapter reads only the configured vault path and current VS Code Git workspace. It does not receive SecretStorage keys and it never creates a network listener.
