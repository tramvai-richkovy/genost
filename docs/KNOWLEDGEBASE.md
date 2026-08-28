# GENOST Knowledge Base

This file is the durable project knowledge base. Keep `README.md` concise, keep `docs/plan.md` limited to unfinished work, and archive completed implementation detail in `docs/implementation-history.md`.

## Product Intent

GENOST is a local-first macOS AI music studio. It should behave like a focused DAW-style workbench for generated stems, not a marketing page or a generic prompt toy.

The preserved workflow is:

1. Project Browser
2. Composition
3. Blocks
4. Arranger
5. Graph
6. Premix
7. Components render queue
8. Player

The user selects a projects folder, opens or creates a song project, defines the song aesthetic, declares reusable blocks, arranges block variations on layered lanes, renders only selected components, and builds a playable mix from generated stems.

## Current Implemented Behavior

- Project Browser, Composition, Blocks, Arranger, Graph, Premix, Components, and Player persist portable project state through strict Zod schemas.
- Composition stores structured BPM, time signature, swing, key, mood, genre, reference, purpose, avoid, rhythm, palette, production, arrangement, cache path, and reference-track inputs.
- Mandatory musical context and graph-cycle checks block invalid render queue actions.
- Blocks support generated and imported-audio sources, instrument focus, sound character, separator target metadata, optional meter overrides, prompt controls, effects sends, and non-destructive removal.
- Arranger supports dense layered clips, variations 1-16, dependency links, drag/drop with grab offsets, whole-bar resize, clone, split, delete, zoom, shared scrolling, variation presence indicators, and duration guards.
- Components filters/selects rows, renders selected/all, previews and reveals audio, archives revisions, shows progress/elapsed time, and exposes structured errors plus validation summaries.
- Tauri's scoped asset protocol serves project-local stems, separation outputs, waveforms, and mixes to the WebView for preview; its allowlist covers user project folders under the home directory, temporary directory, `/Volumes`, and `/home`.
- Premix keeps append-only separation history in project data but suppresses failed attempts in the workbench once a later ready bundle exists for the same source stem; current failures remain visible and ready bundles show their source filename.
- Premix schedules every output in a ready bundle against one Web Audio clock for synchronized looping. Per-output levels persist from -60 dB through +6 dB and are reused by level-aware non-destructive merges.
- Components and Arranger share project-level render requirement derivation from `apps/desktop/src/lib/project/requirements.ts`.
- Identical requirements reuse one component row. Different variation numbers remain different stem identities.
- Later same-block variations queue against the canonical variation-1 anchor. If that anchor is missing, queue planning synthesizes variation 1 before the later variation.
- Dense Components and Arranger badges consistently report missing, stale, input-missing, validation-failed, duration-blocked, and graph-cycle-blocked states.
- The worker queue is asynchronous and single-worker. Persisted `rendering` stems reconcile after restart through a pure tested decision helper.
- Offline mix build uses `OfflineAudioContext`, local Tuna-style Web Audio effects, short boundary fades, missing-clip reports, 24-bit WAV output, and mix sidecars under `MIXES/`.
- The published `tunajs@1.0.4` package dependency was removed because it pulled an obsolete nested `npm@6` runtime tree. The current local wrapper is original GENOST code and vendors no upstream TUNA source.
- Recovered `Ash Meridian` and `Covenant Breaker` projects exist as implementation history with validated current stems, clips, WAV masters, sidecars, and recoverable prior revisions.

## Planned Stack

- Desktop app: Tauri v2.
- Frontend: React, TypeScript, Vite, Tailwind.
- Icons: lucide.
- Runtime schemas: Zod.
- Playback and scheduling: Tone.js.
- Offline mix effects: local Tuna-style Web Audio wrapper.
- AI worker: Python process launched by Tauri.
- Audio generation: Meta AudioCraft MusicGen through MLX AudioCraft on Apple Silicon.
- CPU AudioCraft path: diagnostic fallback only.
- Persistence: project-local JSON and WAV files.

Avoid adding a database for MVP unless there is a concrete performance or data-integrity need.

## Repository Map

```text
apps/desktop/             Tauri + React app
genost_worker/            Python worker and generation code
scripts/                  setup, validation, recovery, and batch helpers
docs/                     detailed setup, format, history, and planning docs
```

Frontend feature folders map to product surfaces:

```text
project-browser/
composition/
blocks/
arranger/
arranger-graph/
premix/
player/
render-queue/
```

Shared frontend helpers belong under `apps/desktop/src/lib/`, grouped by purpose:

```text
audio/
project/
schema/
worker-client/
```

## Project File Invariants

Each project is a portable folder:

```text
ProjectsRoot/
|-- genost-workspace.json
`-- My Track/
    |-- genost.json
    |-- commands.json
    |-- STEMS/
    |-- MIXES/
    |-- REFERENCES/
    |-- WAVEFORMS/
    |-- JOBS/
    `-- ARCHIVE/
```

Rules:

- Treat `genost.json` as the source of truth.
- Treat `commands.json` as the append-only journal of meaningful web UI inputs and project actions.
- Validate project data through schemas before using it.
- Write `genost.json` atomically with a temp file and rename.
- Keep project folders portable and inspectable.
- Do not hide required song state in app-global storage.
- Store generated WAV files under `STEMS/`.
- Store stem metadata in a sidecar JSON beside each WAV.
- Store final mix WAV files under `MIXES/`.
- Do not overwrite or delete old stems during rerender.
- Create a new stem on rerender and mark old stems superseded.
- Stale stems remain playable and usable.
- Archive stale or detached prior revisions under `ARCHIVE/`.
- Prefix archived stems with `DETACHED_` when the source block was removed or changed enough that the stem is no longer current.

Detailed format notes live in [project-format.md](project-format.md).

## Command Journal Rules

- Append a `commands.json` entry for every meaningful project-facing UI input or action.
- UI edits use `actor: "user"` and `source: "web-ui"`.
- Code-agent edits use `actor: "code-agent"` and `source: "code-agent"`.
- Worker and system transitions use their corresponding actor/source values.
- Include enough payload data for a future code agent to understand or transform the action.
- Include project state fingerprints when available.
- Keep command entries append-only.
- Do not put secrets into `commands.json`.

## Generation And Stem Identity

Seed generation:

- No input stem.
- Uses text generation.
- Default model: `facebook/musicgen-medium`.
- Fallback model: `facebook/musicgen-small`.

Conditioned generation:

- Has an input/reference stem.
- Uses melody/chroma-conditioned generation.
- Default model: `facebook/musicgen-melody`.

Stem identity:

```text
blockId + variation + inputStemId + prompt/settings hash + seed
```

Rules:

- Variations are numbered 1 through 16.
- Identical stem requirements may reuse the same WAV.
- Different variation numbers produce different passes.
- Regenerate creates a new seed and a new stem identity.
- Variation 1 is the canonical block render.
- Later same-block variations use variation 1 as their recognizable melody-conditioned anchor.
- Editing the global composition prompt or block settings marks dependent stems stale by hash mismatch.
- If a changed stem was used as input for child stems, mark child stems stale too.
- Rendering is blocked while `findBlockGraphCycle(project)` returns a cycle.
- Nothing renders automatically. Rendering must come from an explicit user action.
- Store the exact composed prompt, model, seed, duration, device, input stem, and generation settings in stem metadata.

## Requirement Derivation

Render requirements are derived from arranger clips in shared project code:

- Source module: `apps/desktop/src/lib/project/requirements.ts`.
- Components uses requirements for render queue rows and queue mutation.
- Arranger uses requirements for compact clip status badges.
- Reuse is keyed by block, variation, clip bars, input block, and resolved input stem.
- Later generated variations require a same-block variation-1 anchor of matching duration.
- If a later variation has no anchor, queue planning creates a queued variation-1 stem before the requested later variation.
- Requirement state labels cover missing, queued, rendering, ready, stale, failed, canceled, input-missing, validation-failed, duration-blocked, and graph-cycle-blocked.

## Audio And Mix Rules

- Convert bars to seconds with `seconds = bars * beatsPerBar * 60 / bpm`.
- Default `beatsPerBar` comes from the project time signature.
- A block may override the project time signature.
- Normalize generated/imported audio to the project sample rate before reliable playback or mixdown.
- Use Tone.js for transport and scheduling.
- Use the local Tuna-style Web Audio wrapper for delay, reverb/convolver, compressor, gain, and related effects.
- Offline mix build may use `OfflineAudioContext` with the same conceptual graph.
- Add a Python mixdown fallback only if browser offline rendering is proven unreliable.
- Add short fades or crossfades at clip boundaries to avoid clicks.
- Player build must skip missing stems and report skipped clips.

## Backend And Model Notes

- Prefer Apple Silicon with MLX AudioCraft on Metal for real generation.
- Keep CPU fallback possible for diagnostics, but do not imply it will be fast.
- Provide backend validation before relying on generation.
- Validate Python version, torch import, MPS availability as a hardware diagnostic, AudioCraft, torchaudio, ffmpeg, cache writability, active backend, and active device.
- Expose model cache settings because model files may live on an external SSD.
- Relevant environment variables include `AUDIOCRAFT_CACHE_DIR` and `HF_HOME`.
- Cache loaded model instances in the Python worker so repeated renders do not reload weights unnecessarily.
- Return structured worker errors for missing cache paths, missing input stems, out-of-memory, unsupported device, failed imports, failed audio writes, validation failures, and cancellation.
- Model-backed checks should be skipped on machines without MusicGen installed.

Setup details live in [macos-setup.md](macos-setup.md).

## License Posture

AudioCraft code is MIT licensed, but official released model weights are documented as CC-BY-NC 4.0. GENOST is currently for personal, non-commercial use.

If commercial use becomes a goal, add a generation backend abstraction before deeply coupling the app to AudioCraft-specific assumptions.

## UI And Design Rules

- Build the actual studio as the first screen after folder selection.
- Do not add a landing page.
- Use a dense DAW-like layout.
- Use Tailwind with a near-black workbench base, graphite panels, cold cyan grid lines, acid green active states, red/orange warnings, and restrained violet accents.
- Avoid a one-hue palette.
- Use cards only for project tiles and repeated items.
- Do not nest cards.
- Use lucide icons for icon buttons where available.
- Use tooltips for icon-only controls.
- Keep timeline tracks, queue rows, transport controls, cards, and buttons dimensionally stable.
- Ensure text does not overflow or overlap at laptop and desktop sizes.
- Avoid explanatory in-app copy. Prefer labels, statuses, tooltips, and disabled states.

## Testing Expectations

Add focused tests as implementation appears:

- TypeScript tests for schema validation, bar-to-seconds conversion, stem identity hashing, stale detection, prompt composition, requirement derivation, queue planning, restart reconciliation, and dense state labeling.
- Python tests for generator routing with mocked AudioCraft models.
- Python tests for audio save paths and metadata sidecars.
- UI tests for project creation, tab navigation, block editing, arranger clip creation, render queue derivation, and player build with fixture WAVs.
- A no-model development mode should generate short fixture tones so UI and queue behavior can be tested without downloading MusicGen weights.
- Optional local smoke tests can use `facebook/musicgen-small` when MusicGen is installed.

Before marking meaningful implementation work complete, run relevant lint, typecheck, unit tests, and available UI tests. If model-backed tests cannot run locally, state that clearly.

Current model-free desktop checks:

```bash
cd apps/desktop
npm test
npm run build
```

## Documentation Map

- `README.md`: concise repository entry point and run commands.
- `AGENTS.md`: maintenance rules for future code agents.
- `docs/KNOWLEDGEBASE.md`: durable project knowledge and current behavior.
- `docs/plan.md`: active unfinished checklist only.
- `docs/implementation-history.md`: completed milestones and archived implementation detail.
- `docs/project-format.md`: detailed portable project format and code-agent workflow.
- `docs/macos-setup.md`: macOS setup, worker, model cache, and packaging notes.
- `docs/original-idea.md`: original product request.
- `docs/audiocraft-snippets.txt`: original MusicGen reference snippet.
