# Local Context Graph Design

**Status:** Approved design — implementation not started

## Goal

Give each Sovereign Router user a private, local and durable context system. It must preserve session continuity, provide precise retrieval from the user's vault, and let Hermes propose knowledge without silently turning every conversation into permanent memory.

## Principles

- Local-first and offline-capable. No Supabase, hosted database or account is required.
- The vault remains the source of truth for user-authored material.
- Graphify is an index and relationship map, never the canonical copy of a document or session.
- Hermes may propose memory but never writes approved memory by itself.
- Context retrieval is bounded, traceable and relevant to the current task; the system never sends the whole vault or all prior chat history to a model.
- Users can inspect, approve, edit, reject and delete all persisted context without modifying their vault files.
- Generated indexes and private session data are excluded from Git by default.

## Storage Layout

All private state belongs under the active vault, using Obsidian's plugin data location and a dedicated generated-index directory.

```text
<vault>/.obsidian/plugins/sovereign-router/context/
  manifest.json                 schema version and aggregate counts
  sessions/<session-id>.json    messages, model lock, attachments and session state
  summaries/<session-id>.json   compact, versioned session summary
  candidates/<candidate-id>.json
                                Hermes-proposed memories awaiting review
  memories/<memory-id>.json     approved memories only
  tombstones/<id>.json          deletion and invalidation history

<vault>/.sovereign-router/graphify-out/
  graph.json                    Graphify's queryable graph
  GRAPH_REPORT.md               Graphify's generated overview
  graph.html                    local graph visualization
```

`context/` uses the Obsidian plugin data adapter so it stays scoped to the vault. Graphify output is generated from source files and is ignored by the vault's Git workflow unless the user explicitly chooses otherwise.

## Data Model

### Session record

Each session has a stable UUID and stores its lifecycle state, selected route/model, advisory strategy, message references, attached document references, summary version, and timestamps. Active and ended sessions are retained separately; ending a session prevents new model selection from changing its historical metadata.

### Summary record

Each summary stores a bounded narrative of goals, decisions, open questions, relevant entities and source references. It records the source message range and the time it was generated, so a newer summary supersedes rather than overwrites the prior version.

### Memory candidate

Hermes returns candidate facts in a strict structure:

```json
{
  "kind": "decision | entity | relation | preference | project_state",
  "statement": "A concise, falsifiable memory.",
  "entityIds": ["optional-stable-identifiers"],
  "sourceRefs": [
    {
      "type": "session | vault_file | graph_node",
      "id": "stable local identifier",
      "path": "optional/relative/vault/path.md"
    }
  ],
  "confidence": 0.0,
  "rationale": "Why this is supported by the sources."
}
```

Candidates start with `status: "pending"`. A user can approve, edit, reject or delete a candidate. Only approval creates a memory record.

### Approved memory

Approved memories contain the edited-or-original candidate, a stable ID, `createdAt`, `updatedAt`, `approvedAt`, `sourceRefs`, `status: "active"`, and an optional `supersedes` list. A memory with a missing source becomes `status: "needs-review"` and is excluded from automatic context assembly until reviewed.

## Context Assembly

Before a Hermes run, Sovereign builds a compact `ContextPackage` in this order:

1. The current session's latest summary.
2. A bounded window of recent messages not represented by that summary.
3. Active approved memories matching the session goal, selected documents, paths or known entities.
4. A Graphify subgraph queried from the task terms and source paths.
5. Explicit documents selected by the user, processed through the existing document pipeline.

The package always includes provenance for every memory and graph result. A configurable budget limits each section independently. If it exceeds the budget, the least relevant graph and memory entries are omitted first; explicit attachments and the current session summary take precedence.

## Graphify Integration

Graphify runs locally against the current vault or a selected project scope. It produces `graphify-out/graph.json` and its accompanying report/visualization. Sovereign queries that local artifact to retrieve a scoped subgraph rather than placing the full Graphify output in a prompt.

Graphify refreshes only when requested by the user or when stale-source detection identifies changed selected files. It does not run during plugin startup and it does not scan the full vault on every message. A missing Graphify installation or graph is a recoverable state: Sovereign continues using session summaries and approved memories, while showing a clear action to install or rebuild the graph.

## Hermes Responsibilities

Hermes remains the executor for its own skills, MCPs and model route. Sovereign sends a `ContextPackage` as read-only task context. Hermes can return a separate memory-candidate payload, but it receives no implicit permission to access the vault, write persistent files, or approve memories.

The existing fixed-model-per-session rule remains unchanged. Context retrieval never changes the model selected for an active session.

## User Experience

The chat view gains a compact context status area with:

- current session summary status;
- Graphify status: unavailable, stale, building or ready;
- count of approved memories used for the current run;
- a review action when pending candidates exist.

New commands/settings expose: rebuild the local graph, review memory candidates, open the local graph report, export/delete local context, and set conservative context budgets. No raw vault content is transmitted by these actions unless the user already configured an external provider used by an existing feature.

## Failure, Privacy and Recovery Rules

- Failed graph builds preserve the last valid graph and report the failure without blocking chat.
- Invalid JSON records are quarantined rather than deleted; the user can export them for recovery.
- Deleting a session removes its session data and summaries but does not delete separately approved memories. The UI discloses this distinction before deletion.
- Deleting a source file marks linked memory for review rather than silently deleting it.
- Export creates a user-requested portable archive of context records only; it excludes vault content and generated model outputs unless explicitly selected.
- All private local data remains excluded from version control by default.

## Non-goals for the First Release

- Cloud synchronization, Supabase, user accounts and multi-device replication.
- A mandatory vector database or embeddings pipeline.
- Automatic approval of memories.
- Replacing Obsidian's native vault search or the user's files with graph data.
- Sending the complete vault, complete graph or full conversation history to Hermes.

## Verification Criteria

- A user can create, end, reopen and delete sessions while their state remains local and isolated to the vault.
- An approved memory always shows at least one source reference and can be edited or removed.
- A missing Graphify executable does not block ordinary chat or document attachment.
- A graph rebuild does not run on plugin startup or on every chat message.
- Context packaging is deterministic for the same session state and configured budget.
- No generated context directory or Graphify output is staged by the project's default Git workflow.
