# Document Authoring and Explicit Skill Routing Design

**Status:** Approved conversational design — implementation not started

## Goal

Automatically produce useful vault documents only for document-oriented requests, and route an explicitly requested skill to the safe local skill library or Hermes at the start of an Auto runtime session.

## Scope

- Detect explicit skill requests such as `use the superpower skill`, `use $superpower`, and `use Graphify`.
- Prefer an approved local skill when the requested name resolves to one.
- Otherwise, route an Auto runtime session to Hermes when it is configured, passing the requested skill name as an instruction for Hermes to resolve.
- Detect document-oriented requests and create or update notes using the Obsidian Vault API after the model produces a validated document operation.
- Apply the same document-writing path for OpenRouter and Hermes responses.

## Non-goals

- Do not invoke Hermes merely because a message contains the generic word “skill”; the request must name a skill.
- Do not give OpenRouter, Hermes, MCP servers, or a model direct filesystem access through the plugin.
- Do not create notes for ordinary questions, casual conversation, analysis, or retrieval-only tasks.
- Do not overwrite a note without a validated target and a safe `Vault.process()` update.

## Explicit Skill Routing

`RequestedSkill` is extracted from a user prompt before normal routing. It contains a normalized name and the original text.

1. A local skill resolver searches only configured vault folders and approved GitHub repositories.
2. If a named local skill matches, the normal Sovereign/OpenRouter path receives that skill and no Hermes routing is forced.
3. If no local skill matches and Hermes is configured, Auto runtime resolves to Hermes. `buildHermesInstructions` states the requested skill name and tells Hermes to use it only if installed.
4. If Hermes cannot use it, its response must report that condition; Sovereign never pretends the skill executed.
5. Manual **Sovereign chat** and **Hermes Agent** selections override this automatic choice.

## Document Authoring Trigger

The Gatekeeper receives an explicit document-authoring capability and returns an optional `document` decision only for requests to plan, create, structure, update, organize, draft, or document material in the vault. A request must describe an artifact or a desired document outcome; asking a question alone does not qualify.

The decision contains a safe operation contract:

```json
{
  "action": "create | append | update",
  "path": "vault-relative/folder/note.md",
  "title": "Human-readable note title",
  "content": "Markdown document body",
  "reason": "Why this existing folder or target is appropriate"
}
```

The model may suggest the folder from the indexed vault structure and relevant source notes. The plugin validates the relative path, blocks the configuration directory and existing system files, creates missing parent folders through `Vault.createFolder()`, creates new files through `Vault.create()`, and uses `Vault.process()` for append/update so a concurrent edit is not overwritten.

## Response Flow

1. User sends a request.
2. Sovereign extracts an explicit skill request, if any, and resolves runtime/skill policy.
3. The selected executor returns its normal chat response plus an optional structured document operation.
4. The plugin validates and performs the operation through the Vault API.
5. The chat response displays links to each written note and the operation result.

For Hermes, the structured document operation is returned to Sovereign; Hermes does not write files itself through this feature. This gives OpenRouter and Hermes identical vault-writing behavior and leaves all file validation inside the plugin.

## Safety and Recovery

- Automatic vault writing is an explicit setting, disabled by default for new users and enabled only after clear disclosure.
- A dedicated allowed output root may be configured; when omitted, the plugin may choose from visible user folders but never `.obsidian` or another configuration directory.
- Invalid JSON, invalid paths, missing operations, and write failures leave the chat response intact and show a non-blocking failure notice.
- Every write records the target path, action and timestamp in the local session record.
- The plugin never deletes or renames user-authored notes through automatic document authoring.

## Verification Criteria

- `superpower` routes to Hermes in Auto runtime when no matching local skill exists and Hermes is configured.
- A matching allowed local skill remains in Sovereign chat and is not sent to Hermes.
- Manual runtime selection wins over automatic skill routing.
- A document planning request creates a valid Markdown note in a validated vault folder.
- An update uses `Vault.process()` and preserves user changes made between the initial read and write.
- Non-document requests never create notes.
- Paths attempting to escape the vault or enter the configuration directory are rejected.
