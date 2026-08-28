# Archived: GENOST Song-Project Cutover Plan

This plan treated the song-project DAW proof of concept as the product. That product decision was incorrect. It is retained for history only. The active product specification is `/idea.md`, and the active implementation plan is `/plan.md`.

## HOWTO

Keep only unfinished work here. Move completed implementation facts to `README.md`, durable behavior/invariants to `docs/KNOWLEDGEBASE.md`, and completed milestone detail to `docs/implementation-history.md`.

Put blocking or review-needed decisions in `QnA` with a suggested answer. Do not remove this file while unresolved QnA remains.

## Working Guardrails

- The portable project browser and DAW workspace are the product; do not revive the retired session/artifact prototype as an alternate shell.
- Keep rendering behind explicit user actions and preserve all prior audio non-destructively.
- Preserve local-first project folders, atomic JSON writes, append-only command journals, and schema validation.
- Keep MLX/Metal primary on Apple Silicon; defer model/runtime tuning that does not block product structure or normal fixture-backed development.

## Next Pickup

Run the fixture-backed product walkthrough and close any navigation, labeling, or dead-control gaps that prevent the portable project workflow from behaving like the intended DAW product. Live MusicGen duration tuning remains deliberately deferred until the product workflow is closer to release.

## 1. Product Readiness

- [ ] Run a fixture-backed desktop walkthrough from folder selection through project creation, Composition, Blocks, Arranger, Graph, Components, Premix, and Player.
- [ ] Review product navigation and labels for any remaining prototype terminology or dead controls.
- [ ] Build the unsigned local macOS bundle and verify it opens directly into the product setup/project flow.

## Deferred Hardening

- [ ] Route or split long MusicGen Medium renders safely on 16 GB Macs; the retained evidence shows 4-second success, 8-second completion, a 24-second worker exit, and a valid 24-second MusicGen Small fallback.
- [ ] Resume real-model SMTV render/export, separator, mix, and restart-recovery verification after the product cutover and fixture walkthrough are complete.
- [ ] Add signing/notarization only after the product workflow and local packaging are stable.

## QnA

No unresolved questions.
