# Document Authoring and Explicit Skill Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route named skills to local Sovereign skills or Hermes, write validated document artifacts for document-oriented requests, and visibly confirm local session-context persistence.

**Architecture:** Add pure parsers/validators for named-skill requests and document operations. Extend the Gatekeeper contract with optional document output, then keep all vault writes inside a dedicated Obsidian Vault API service. Chat and Hermes responses are normalized through the same document-operation executor; neither model receives direct filesystem access.

**Tech Stack:** TypeScript strict mode, Obsidian Vault API (`createFolder`, `create`, `process`), current OpenRouter/Hermes transports, npm test.

## Global Constraints

- Automatic vault writing remains an explicit setting disabled by default for new users.
- Manual runtime selection overrides automatic requested-skill routing.
- Only validated vault-relative Markdown paths may be written; reject configuration folders and path traversal.
- Never delete or rename user notes automatically.
- Use `Vault.process()` for append/update; never blindly combine `read()` and `modify()`.
- Hermes and OpenRouter return plans; Sovereign alone writes files.

---

### Task 1: Parse requested skills and document contracts

**Files:**
- Create: `src/requested-skill.ts`
- Create: `src/document-authoring.ts`
- Modify: `src/types.ts`
- Modify: `tests/run-tests.ts`

- [ ] Add failing tests for `$superpower`, natural-language named skill requests, valid document payloads, traversal/config-folder rejection and missing content.
- [ ] Implement pure requested-skill parsing and normalized document operation validation.
- [ ] Run `npm test` and verify the new pure tests pass.

### Task 2: Route explicit skills safely

**Files:**
- Modify: `src/skills.ts`
- Modify: `src/routing.ts`
- Modify: `src/ui/chat-view.ts`
- Modify: `tests/run-tests.ts`

- [ ] Add a local-skill name lookup that returns only permitted local/GitHub references.
- [ ] Before normal Gatekeeper routing, resolve an explicitly requested name: local match stays local; no match routes Auto runtime to configured Hermes.
- [ ] Add the requested Hermes skill name to Hermes instructions without claiming installation or granting tools.
- [ ] Verify manual runtime selection still wins and `superpower` selects Hermes only in eligible Auto sessions.

### Task 3: Execute document plans through the Vault API

**Files:**
- Create: `src/vault-document-writer.ts`
- Modify: `src/main.ts`
- Modify: `src/settings.ts`
- Modify: `src/ui/chat-view.ts`
- Modify: `tests/run-tests.ts`

- [ ] Add settings for automatic document authoring, optional allowed output root and a visible local-context status preference.
- [ ] Add a writer that creates parents with `createFolder`, creates notes with `create`, and uses `process` for append/update.
- [ ] Execute only validated operations returned by the executor after a document-oriented route.
- [ ] Persist each write result in the session and append clickable note links to the chat result.
- [ ] Verify non-document tasks never invoke the writer and write errors preserve the normal answer.

### Task 4: Make context persistence observable

**Files:**
- Modify: `src/local-context-store.ts`
- Modify: `src/ui/chat-view.ts`
- Modify: `src/main.ts`
- Modify: `styles.css`
- Modify: `README.md`

- [ ] Expose a small local-context status for the active session: saved timestamp, summary message count, approved memories used and Graphify availability.
- [ ] Add stable commands to review pending memories and open the local-context location/status view.
- [ ] Document how a user verifies saved local context without exposing private files to Git.
- [ ] Run `npm run build`, `npm test`, `npm run lint`, and `git diff --check`.
