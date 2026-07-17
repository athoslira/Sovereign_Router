# Sovereign Router

Sovereign Router is a mobile-first Obsidian Community Plugin that routes BYOK OpenRouter chats through a Gatekeeper, optionally injects controlled skills and displays per-response FinOps metadata.

## Models

The plugin includes automatic routing and a manual selector for these OpenRouter models:

- DeepSeek V4 Flash — routing, quick summaries, and everyday chat.
- DeepSeek V4 Pro — complex reasoning and software engineering.
- Qwen 3.7 Max — strategic planning and multi-document analysis.
- Qwen 3.7 Plus — visual analysis and structured documents.
- Kimi K2.7 Code — agentic software engineering.
- Grok 4.3 — current-events research and factual validation.

All six are enabled in the default permitted executor list. The canonical OpenRouter slug for Kimi is `moonshotai/kimi-k2.7-code`.

## Dynamic model catalog and model policy

The settings panel can refresh the official OpenRouter model catalog and stores only non-sensitive metadata: model ID/name, context window, supported modalities, tool support, and OpenRouter's reference token prices. It refreshes opportunistically when Obsidian is open and the cache is older than 15 days (configurable). Actual response cost continues to come exclusively from OpenRouter's `usage.cost` event.

- Add a slug to **Manual-only models** to make it selectable in a chat without granting it automatic routing.
- Add a slug to **Permitted executor models** only when it is approved for Gatekeeper routing.
- [`hermes-automation/`](hermes-automation/README.md) contains a no-dependency job that Hermes can schedule every 15 days for unattended catalog research. It produces a reviewable JSON catalog and never changes model permissions by itself.

## Hermes Agent runtime

The chat header has an execution runtime selector: **Sovereign chat** uses the existing OpenRouter, local-skill, vault-context, and remote-MCP path; **Hermes Agent** delegates an execution-oriented task to a separately configured Hermes API server; **Auto runtime** lets the Gatekeeper choose Hermes only when automatic Hermes routing is explicitly enabled.

To use Hermes, install and configure its API server separately, then set its HTTPS (or loopback HTTP) URL and API key in **Settings → Sovereign Router**. The key is kept in Obsidian SecretStorage. Sovereign Router calls Hermes' run API and streams progress/output into the session; **Cancel** also asks Hermes to stop the remote run. The plugin does not install Hermes, start a terminal, launch subprocesses, or enable local MCP servers itself.

When Hermes performs terminal, subagent, cron, or local stdio MCP work, its own approval and security policies remain authoritative. Keep the Hermes API on loopback or behind authenticated HTTPS.

## Documents with Docling

Docling is a Python project, so it is not bundled into this TypeScript/mobile plugin. Instead, Sovereign Router connects to an optional [docling-serve API](https://docling-project.github.io/docling/usage/api_server/) that converts an attached document into Markdown.

1. Start a Docling service, for example `docling-serve run`, and make its URL reachable from the device running Obsidian. The default local endpoint is `http://localhost:5001`.
2. In **Settings → Sovereign Router**, set the **Docling service URL**. If the service requires authentication, select its API key through SecretStorage.
3. Use **Attach document** to select files from the device, or **Attach vault folder** to select a folder from the current vault. Folder import walks supported files recursively: text and Markdown files are read through the Vault API, while PDFs and Office documents use Docling.
4. Converted content is available in the open chat session and is also added to the local context library so it can be retrieved automatically in future relevant chats.

The plugin supports the file formats accepted by the picker, imports at most 25 documents from a selected folder, limits individual uploads to 20 MB, and limits injected Markdown to protect context and cost. Source files are not copied, but converted Markdown from directly attached external documents is kept in the plugin's local context cache. For mobile devices, `localhost` means the phone/tablet itself; use a reachable HTTPS service or a local service on that device.

## Automatic vault context

After Obsidian finishes loading, the plugin creates and incrementally maintains a local context index for supported text files in the current vault. The central registry is stored under the plugin's `context/` folder and is ignored by Git. It contains paths, modification markers, headings, and local search terms—not a second copy of vault text.

When the Gatekeeper identifies that a request needs vault information, it returns a focused retrieval query. Only then does the plugin reread the most relevant current files, extracts bounded excerpts, and sends those excerpts to the executor. If the index is unavailable, stale, or finds no match, the executor falls back to answering without vault context.

External documents attached through Docling are cached as converted Markdown in that same local context library. Use **Settings → Sovereign Router → Clear stored external documents** to remove that cache. Existing PDFs and Office documents already in the vault are not converted automatically; attach them through Docling when needed.

## MCP tools

Sovereign Router can call tools from remote MCP servers through Streamable HTTP. In **Settings → Sovereign Router → MCP connections**, add an endpoint, optional SecretStorage key, and enable it. On the chat panel, select **MCP** only for messages where those tools may be useful.

- The plugin accepts HTTPS endpoints, plus `http://localhost` for a locally running server. It does not spawn programs or use the desktop-only stdio transport.
- Tools marked read-only by their server can run during an MCP-enabled chat. Write tools are off by default; enabling them still presents the arguments and requires explicit confirmation for every call.
- The plugin fetches the server's tool list only for an MCP-enabled message. MCP session details, tool results, and chat history remain only in the open panel.
- [`mcp-connectors/`](mcp-connectors/README.md) contains a small generator for a standalone Streamable HTTP connector. Deploy it behind HTTPS before using it from a mobile device.

## Privacy and security

- The plugin sends chat messages and selected skill content to OpenRouter when you submit a request.
- Attached files are sent only to the Docling service URL you configure; their converted Markdown is then sent to OpenRouter with the chat request.
- API keys are selected through Obsidian SecretStorage. `data.json` stores only their references.
- Conversations remain only in the open chat panel. The local context index persists file references and search terms; converted external attachments persist only in the local plugin cache until you clear them. The plugin collects no telemetry, edits no notes, and executes no remote code.
- Remote skills are fetched as Markdown only from GitHub repositories you explicitly allow. They are never executed or saved to the vault.
- MCP servers receive only the arguments of a tool call that you enabled in the chat. Their tools can be selected by OpenRouter only after their schemas have been loaded for that request.
- Hermes receives the prompt and any context selected for a Hermes session. It is an optional external runtime and is configured only when you choose to use it.

## Development

1. Install dependencies with `npm ci`.
2. Run `npm run build` and `npm test`.
3. Copy `main.js`, `manifest.json`, and `styles.css` into `<Vault>/.obsidian/plugins/sovereign-router/`.
4. In Obsidian, reload community plugins, enable **Sovereign Router**, then select an OpenRouter API key in its settings.
