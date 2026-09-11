# Local-first image toolkit

Sovereign Router 1.6.0 adds useful image work without making a paid generator mandatory.

## Included at no additional service cost

- Image-oriented OpenRouter or Hermes prompts can return a self-contained `sovereign-image` SVG operation. Sovereign rejects traversal, scripts, event handlers, embedded data, remote resources, `foreignObject`, and oversized payloads before writing the asset beneath the configured vault image folder.
- Each accepted SVG receives a local provenance note containing the provider class, creation time, title, alt text, and vault link.
- **Sovereign Router: Optimize active image** and **Control → Open image optimizer** resize and convert an active PNG, JPEG, or WebP locally through the browser Canvas API. The default is WebP with no upscaling. The source remains unchanged and an optimization provenance note is created.
- The control center queries Hermes `/v1/toolsets` and reports whether `image_gen` is present, enabled, and configured.

## Optional Hermes generation

Hermes owns image-provider keys, models, storage, and tool execution. Sovereign does not copy those secrets and does not pretend that a provider is ready: it checks the advertised toolset. An `image_generate` call is treated as an external/cost-capable effect and therefore requires Agent Kernel approval.

Current Hermes builds may expose OpenRouter, OpenAI, Codex, FAL, Krea, DeepInfra, or xAI image backends. Availability and price are determined by the user's Hermes version and account. The local SVG path remains the fallback when no provider is configured.

Third-party options such as Higgsfield, Visual Skills, HyperFrames, AI-CLI, RunComfy, Modal, and Creatomate are not vendored or silently installed. They can be added later as optional Hermes skills/MCPs after license, data-egress, and cost review. No code from those projects is included in this release.

## Privacy boundary

Local SVG validation and raster optimization do not send image bytes over the network. A Canvas image is sent only under the existing explicit attachment flow. A Hermes provider receives only what its configured tool call sends after approval; its own retention and billing terms apply.
