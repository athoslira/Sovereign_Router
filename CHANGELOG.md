# Changelog

## 1.6.0

- Added local-first SVG authoring with strict validation, vault provenance, and automatic image-request handling for both Sovereign chat and Hermes sessions.
- Added local PNG/JPEG/WebP resize and conversion without upscaling or network transfer.
- Added explicit Hermes `image_gen` capability discovery; paid or external generation remains approval-gated.
- Added the optional Agent Kernel introduced for the 1.5 line: governed execution envelopes, balanced path policy, Obsidian approval UI, local grants, and 30-day sanitized audit events.
- Added an authenticated loopback Hermes bridge using only official plugin hooks, exact-origin CORS, and no third-party runtime dependencies.
- Updated vulnerable development-only transitive dependencies without changing production dependencies.

## 1.5.0

- Reserved compatibility mapping for the Agent Kernel protocol and bridge, shipped as part of the complete 1.6.0 release.
