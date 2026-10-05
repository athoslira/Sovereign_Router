# Programmatic video workflows

Sovereign Router can recognize an explicit request to create or render a video and, in **Auto runtime**, route it to Hermes. The Obsidian plugin does not install renderers, start a terminal, or encode media itself. Hermes remains the execution host and the Agent Kernel remains the approval boundary.

## Renderer choice

- **Remotion** is selected by default for explainers, product motion, MP4/ProRes delivery, and social formats. Requests for vertical, Reels, TikTok, Shorts, or 9:16 video also select the short-form workflow.
- **Manim Community Edition** is selected when the request is primarily mathematical or scientific: equations, graphs, geometry, physics, or proofs.

The choice is an initial operational default. Hermes may explain a different choice when the requested result requires it, but it must not claim that a render exists until its approved tools complete one.

## Hermes setup

Install the desired renderer and its supporting tools in the **Hermes workspace**, not in the Obsidian plugin directory. The maintained skill catalog at `iart-ai/motion-skills` is a catalog; install only the packs you need in that workspace:

```text
npx skills add iart-ai/explainer-video-skills
npx skills add iart-ai/tiktok-video-skills
npx skills add iart-ai/manim-skills
```

For remote Skill resolution in Sovereign Router, allow only the specific repositories you trust under **Settings → Sovereign Router → Allowed GitHub repositories**. The relevant repositories are `iart-ai/explainer-video-skills`, `iart-ai/tiktok-video-skills`, and `iart-ai/manim-skills`; the catalog alone does not provide an executable renderer.

Configure Hermes and, when used, Agent Kernel as usual. Add the absolute Hermes project root to **Agent Kernel allowed roots**. If final media should be delivered into the vault, ensure the vault delivery directory is deliberately exposed through an approved workspace path as well. A vault-relative video output setting alone does not grant Hermes filesystem access.

## Request lifecycle

1. Ask in **Auto runtime**, for example: “Crie um vídeo 9:16 de 20 segundos para Reels explicando este produto” or “Renderize uma animação de uma equação diferencial.”
2. Sovereign Router routes the task to Hermes, supplies a renderer-aware brief, and requests the relevant installed skill when available.
3. Hermes produces a scene and timing plan, creates editable source, and asks for approval before terminal, file-write, download, or render actions according to its own policy and the Agent Kernel.
4. It renders a representative still or short preview, verifies captions, timing, readability, and media references, then renders the final MP4 or requested format after approval.
5. The response must identify the final output path, source project, renderer, resolution, frame rate, and verification result.

## Safety and cost boundary

- Hermes never receives access to arbitrary vault paths through this feature. It works only under its allowed roots.
- Rendering can consume CPU/GPU, disk space, time, and possibly paid media-provider usage. The normal approval flow remains in force for each dangerous action.
- Do not enable an untrusted remote skill repository. Remote skills are advisory text and do not grant terminal, MCP, or filesystem permissions.
- A manual **Sovereign chat** session can plan or explain a video, but it does not render one. Select **Auto runtime** or **Hermes Agent** for execution.
