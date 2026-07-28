# Local Context Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist private Sovereign sessions and approved memories locally, supply bounded context to chat and Hermes, and expose an optional local Graphify graph without starting external processes from Obsidian.

**Architecture:** A `LocalContextStore` owns vault-scoped JSON records under the plugin directory. Pure helpers create bounded summaries, rank approved memories, and parse Hermes memory proposals. The chat view serializes session state through the store and gives Hermes the retrieved package; Graphify is detected by an existing configured graph path and remains an Hermes-owned CLI/skill integration.

**Tech Stack:** TypeScript strict mode, Obsidian VaultAdapter, existing Hermes REST/SSE client, npm test and esbuild.

## Global Constraints

- Keep all data under the active vault; do not introduce Supabase, accounts, telemetry, or a remote database.
- Do not start Graphify, Python, shell commands, MCP servers, or terminals from the plugin.
- Do not change current fixed-model-per-session behavior.
- Never automatically approve a Hermes memory proposal.
- Never persist API keys or raw attached-document contents in session records.
- Generated data remains outside Git by default.

---

### Task 1: Define local context records and deterministic retrieval

**Files:**
- Create: `src/local-context.ts`
- Modify: `tests/run-tests.ts`

**Interfaces:**
- Produces `PersistedSession`, `LocalMemoryCandidate`, `LocalMemory`, `ContextPackage`.
- Produces `summarizeSession`, `selectMemoriesForContext`, `parseMemoryCandidates` and `formatContextPackage`.

- [ ] **Step 1: Write failing pure tests** for bounded summaries, source-backed candidate parsing, and term-ranked approved-memory retrieval.
- [ ] **Step 2: Run `npm test`** and verify imports/functions are missing.
- [ ] **Step 3: Implement pure records and helpers** with bounded character budgets, explicit source references and JSON-fence tolerant parsing.
- [ ] **Step 4: Run `npm test`** and verify the new helpers pass.

### Task 2: Persist sessions, candidates and approved memories locally

**Files:**
- Create: `src/local-context-store.ts`
- Modify: `src/main.ts`
- Modify: `tests/run-tests.ts`

**Interfaces:**
- `LocalContextStore.start(): Promise<void>`
- `saveSession(record)`, `listSessions()`, `endSession(id)`, `deleteSession(id)`
- `saveCandidate(candidate)`, `listCandidates()`, `approveCandidate(id)`, `rejectCandidate(id)`
- `buildContext(session, query, graphStatus): Promise<ContextPackage>`

- [ ] **Step 1: Add failing tests** for record round-trips and source invalidation through the pure helper boundary.
- [ ] **Step 2: Implement the VaultAdapter-backed store** at `<vault>/.obsidian/plugins/sovereign-router/context/`, with independent directories for sessions, summaries, candidates, memories and tombstones.
- [ ] **Step 3: Initialize the store in plugin `onload`** without scanning or reading user content on startup beyond its small JSON records.
- [ ] **Step 4: Run `npm test` and `npm run build`**.

### Task 3: Add Graphify detection and local-context settings

**Files:**
- Create: `src/graphify-context.ts`
- Modify: `src/settings.ts`
- Modify: `src/main.ts`
- Modify: `.gitignore`
- Modify: `tests/run-tests.ts`

**Interfaces:**
- `GraphifyContext.getStatus(): Promise<{ state: 'unavailable' | 'ready'; path: string }>`
- Settings: `graphifyGraphPath`, `localContextSummaryBudget`, `localContextMemoryBudget`.

- [ ] **Step 1: Write tests** for safe relative graph paths and status text.
- [ ] **Step 2: Implement passive detection** through `VaultAdapter.exists`; no process creation and no parsing of arbitrary graph schema.
- [ ] **Step 3: Add settings UI** explaining the Graphify path must already be generated locally and be accessible to Hermes if it is used there.
- [ ] **Step 4: Add vault-local Graphify output exclusions** without ignoring source or release files.
- [ ] **Step 5: Run `npm test` and `npm run build`**.

### Task 4: Persist and recover chat sessions; assemble bounded context

**Files:**
- Modify: `src/ui/chat-view.ts`
- Modify: `styles.css`
- Modify: `tests/run-tests.ts`

**Interfaces:**
- Chat sessions serialize through `LocalContextStore` after mutations and request completion.
- Ended sessions remain readable but are non-interactive.
- `ContextPackage` is included in direct-chat and Hermes instructions with explicit provenance.

- [ ] **Step 1: Add failing helper tests** for serializing a locked session without document bodies or runtime handles.
- [ ] **Step 2: Restore stored sessions in `onOpen`**, create a new session only when no active record exists, and persist model/runtime locks and message history after each completed request.
- [ ] **Step 3: Change end-session behavior** to mark the record ended and create/switch to another active session rather than deleting its history.
- [ ] **Step 4: Build context before each run** from the current summary, approved memories and Graphify status; preserve current explicit attachments and vault-context behavior.
- [ ] **Step 5: Render compact session/context status** and verify normal chat still works when Graphify is absent.
- [ ] **Step 6: Run `npm test`, `npm run build`, and `npm run lint`**.

### Task 5: Require review for Hermes-proposed memories

**Files:**
- Create: `src/ui/memory-review-modal.ts`
- Modify: `src/ui/chat-view.ts`
- Modify: `src/hermes.ts`
- Modify: `styles.css`
- Modify: `tests/run-tests.ts`
- Modify: `README.md`

**Interfaces:**
- `MemoryReviewModal` exposes approve, edit, reject and delete actions for local candidates.
- An explicit `Propose memory` action performs a separate Hermes run using the session's fixed Hermes model and accepts only valid structured candidates.

- [ ] **Step 1: Add tests** for rejection of unstructured/unsourced Hermes candidate output.
- [ ] **Step 2: Implement the review modal** so approval creates a memory and rejection keeps an auditable tombstone.
- [ ] **Step 3: Add the explicit proposal action** with clear cost/permission messaging; never run it automatically and never call Hermes when credentials or an advertised model alias are absent.
- [ ] **Step 4: Update README privacy/setup documentation** with Graphify generation and local-context behavior.
- [ ] **Step 5: Run `npm test`, `npm run build`, `npm run lint`, and `git diff --check`**.
