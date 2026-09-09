# Automatic model routing and catalog health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove duplicated Hermes model names, make model discovery observable, and let users copy chat prompts and responses.

**Architecture:** Hermes `/v1/models` is the source of truth for alias-to-model mappings. The plugin stores the last successful discovery only as an offline cache, refreshes it when possible before routing, and never expands the permitted-model policy automatically. Catalog refreshes gain durable attempt status and delta metadata. Copy controls operate only on already-rendered chat text.

**Tech Stack:** TypeScript, Obsidian Plugin API, Hermes OpenAI-compatible API, existing Node assertion test runner.

## Global Constraints

- Keep `main.ts` lifecycle-focused and use only vault/plugin storage for persisted metadata.
- Do not auto-authorize newly discovered models or modify Hermes configuration.
- Do not store secrets, raw prompts, or raw model responses in the catalog health record.
- Keep manual model sessions and offline chat usable when Hermes is unavailable.
- Test every pure parsing, mapping, and catalog-state behavior before its implementation.

---

### Task 1: Discover Hermes routes from the runtime

**Files:**
- Modify: `src/hermes.ts`
- Modify: `src/hermes-models.ts`
- Modify: `src/main.ts`
- Modify: `src/routing.ts`
- Modify: `src/settings.ts`
- Test: `tests/run-tests.ts`

**Interfaces:**
- Produces `parseHermesModelRoutesFromApi(value): HermesModelRoute[]` using only advertised `id` and `root` string values.
- Produces `refreshHermesModelRoutes(): Promise<void>` that caches only valid runtime routes.
- Consumes the existing `permittedExecutorModels` allowlist before a discovered route can be selected.

- [ ] **Step 1: Write failing tests** for API route parsing, alias replacement, and route fallback when an advertised alias changes while its root model remains allowed.
- [ ] **Step 2: Run `npm test`** and confirm the tests fail because the new parser/resolver does not exist.
- [ ] **Step 3: Implement the minimal parser and Hermes client method** that expose an alias plus its `root` model.
- [ ] **Step 4: Implement cache refresh and routing resolution** so advertised routes replace stale aliases while unpermitted models remain blocked.
- [ ] **Step 5: Run `npm test`** and confirm the model-routing tests pass.

### Task 2: Persist catalog-refresh health and show it in the control center

**Files:**
- Modify: `src/model-catalog.ts`
- Modify: `src/settings.ts`
- Modify: `src/main.ts`
- Modify: `src/ui/control-center-modal.ts`
- Test: `tests/run-tests.ts`

**Interfaces:**
- Produces `ModelCatalogHealth` with attempt time, result, source, duration, counts, delta, next due time, and a bounded error message.
- Consumes the current and previous catalog snapshots to calculate added, changed, and removed IDs.
- Persists only catalog metadata, not API keys or model prompts.

- [ ] **Step 1: Write failing tests** for successful delta computation and failed refresh status preserving the prior catalog.
- [ ] **Step 2: Run `npm test`** and confirm the tests fail because health tracking does not exist.
- [ ] **Step 3: Implement pure health/delta helpers and persist their output around each refresh attempt.**
- [ ] **Step 4: Add a concise health card and refresh description** with last result, counts, source, next due time, and last error when applicable.
- [ ] **Step 5: Run `npm test`** and confirm the catalog-health tests pass.

### Task 3: Copy prompt and response text from chat

**Files:**
- Modify: `src/ui/chat-view.ts`
- Modify: `styles.css`

**Interfaces:**
- Produces a reusable copy control accepting visible text and an accessible label.
- Uses `navigator.clipboard.writeText` with a DOM fallback only when the Clipboard API is unavailable.

- [ ] **Step 1: Identify the user-message and assistant-message render boundaries** and preserve their existing content rendering.
- [ ] **Step 2: Add copy controls** beside the user prompt and each completed model response.
- [ ] **Step 3: Add theme-compatible styles** without inline static CSS.
- [ ] **Step 4: Run TypeScript build** to verify the Obsidian view compiles.

### Task 4: Verify and document

**Files:**
- Modify: `README.md`
- Modify: `docs/HERMES_MODEL_ROUTING.md`

- [ ] **Step 1: Document automatic Hermes route discovery, catalog-health semantics, and the policy boundary.**
- [ ] **Step 2: Run `npm test`, `npm run build`, `npm run test:release`, and `git diff --check`.**
- [ ] **Step 3: Review the staged diff and commit only the intended source, styles, tests, and documentation.**
