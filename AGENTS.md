# GENOST Maintenance Guide

These instructions apply to the whole repository.

## Project Intent

GENOST is a local-first macOS AI music studio. Preserve the core workflow: project browser, Composition tab, Blocks tab, Arranger tab, Player tab, and Components render queue. The app should behave like a focused DAW-style workbench for generated stems, not a marketing page or a generic prompt toy.

Before implementation work, read `README.md`, `docs/plan.md`, `docs/original-idea.md`, and `docs/audiocraft-snippets.txt` for context.

## Current Planning State

- `docs/plan.md` is the active working checklist. Keep it current while implementing.
- Check off completed items as they are finished.
- Add new required work to `Open Items`.
- Put blocking or review-needed decisions in `QnA` with a suggested answer.
- Do not remove `docs/plan.md` while unresolved QnA remains.

## Planned Stack

- Desktop app: Tauri v2.
- Frontend: React, TypeScript, Vite, Tailwind.
- Icons: lucide.
- Runtime schemas: Zod on the TypeScript side.
- AI backend: Python worker process launched by Tauri.
- Audio generation: Meta AudioCraft MusicGen.
- Playback and scheduling: Tone.js.
- Effects: TUNA Web Audio effects.
- Persistence: project-local JSON and WAV files. Avoid adding a database for MVP unless there is a concrete performance or data-integrity need.

## Expected Repository Shape

Use this structure unless there is a strong reason to change it:

```text
apps/desktop/             Tauri + React app
genost_worker/            Python worker and generation code
scripts/                  setup, validation, and dev helpers
docs/                     detailed setup and format docs
```

Frontend feature folders should map to product surfaces:

```text
project-browser/
composition/
blocks/
arranger/
player/
render-queue/
```

Shared frontend helpers belong under `apps/desktop/src/lib/`, grouped by purpose such as `audio`, `project`, `schema`, and `worker-client`.

## Project File Invariants

Each song project is a folder containing `genost.json` plus generated assets:

```text
commands.json
STEMS/
MIXES/
REFERENCES/
WAVEFORMS/
JOBS/
ARCHIVE/
```

Rules:

- Treat `genost.json` as the source of truth.
- Treat `commands.json` as the append-only journal of meaningful web UI inputs and project actions.
- Validate project data through schemas before using it.
- Write `genost.json` atomically with a temp file and rename.
- Keep project folders portable and inspectable. Do not hide required song state in app-global storage.
- Store generated WAV files under `STEMS/`.
- Store stem metadata in a sidecar JSON beside each WAV.
- Store final mix WAV files under `MIXES/`.
- Do not overwrite or delete old stems during rerender. Create a new stem and mark old stems superseded.
- Stale stems remain playable and usable.
- Archive stale or detached prior revisions under `ARCHIVE/`.
- Prefix archived stems with `DETACHED_` when the source block was removed or changed enough that the stem is no longer current.

## Command Journal Rules

- Append a `commands.json` entry for every meaningful project-facing UI input or action.
- UI edits use `actor: "user"` and `source: "web-ui"`.
- Code-agent edits use `actor: "code-agent"` and `source: "code-agent"`.
- Include enough payload data for a future code agent to understand or transform the action.
- Include project state fingerprints when available.
- Keep command entries append-only.
- Do not put secrets into `commands.json`.

## Generation Invariants

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
- Editing the global composition prompt or block settings marks dependent stems stale by hash mismatch.
- If a changed stem was used as input for child stems, mark child stems stale too.
- The Graph tab is the block dependency view. It edits `inputBlockId` links and must mark target/downstream stems stale after remapping.
- Rendering must be blocked while `findBlockGraphCycle(project)` returns a cycle.
- Nothing renders automatically. Rendering must come from an explicit user action.
- Store the exact composed prompt, model, seed, duration, device, input stem, and generation settings in stem metadata.

## Audio Rules

- Convert bars to seconds with `seconds = bars * beatsPerBar * 60 / bpm`.
- Default `beatsPerBar` is 4.
- Normalize generated/imported audio to the project sample rate before reliable playback or mixdown.
- Use Tone.js for transport and scheduling.
- Use TUNA for delay, reverb/convolver, compressor, gain, and related effects.
- MVP mix build may use `OfflineAudioContext` with the same Web Audio/TUNA graph.
- Add a Python mixdown fallback only if browser offline rendering is proven unreliable.
- Add short fades or crossfades at clip boundaries to avoid clicks.
- Player build must skip missing stems and report skipped clips.

## macOS Backend Rules

- Prefer Apple Silicon with PyTorch `mps` when available.
- Assume the target Mac has at least 16 GB unified memory unless the user says otherwise.
- Keep CPU fallback possible for diagnostics, but do not imply it will be fast.
- Provide a backend validation script before relying on generation.
- Validate Python version, `torch`, MPS availability, AudioCraft, `torchaudio`, ffmpeg, and model cache writability.
- Expose model cache settings. Large model files may live on an external SSD.
- Relevant environment variables include `AUDIOCRAFT_CACHE_DIR` and `HF_HOME`.
- Cache loaded model instances in the Python worker so repeated renders do not reload weights unnecessarily.
- Return structured worker errors for missing cache paths, missing input stems, out-of-memory, unsupported device, failed imports, and failed audio writes.

## License Rule

AudioCraft code is MIT licensed, but the official released model weights are documented as CC-BY-NC 4.0. This project is currently for personal, non-commercial use.

If commercial use becomes a goal, add a generation backend abstraction before deeply coupling the app to AudioCraft-specific assumptions.

## UI And Design Rules

- Build the actual studio as the first screen after folder selection. Do not add a landing page.
- Use a dense DAW-like layout.
- Use Tailwind with a near-black workbench base, graphite panels, cold cyan grid lines, acid green active states, red/orange warnings, and restrained violet accents.
- Avoid a one-hue palette.
- Use cards only for project tiles and repeated items. Do not nest cards.
- Use lucide icons for icon buttons where available.
- Use tooltips for icon-only controls.
- Keep timeline tracks, queue rows, transport controls, cards, and buttons dimensionally stable.
- Ensure text does not overflow or overlap at laptop and desktop sizes.
- Avoid explanatory in-app copy. Prefer labels, statuses, tooltips, and disabled states.

## Testing Expectations

Add focused tests as implementation appears:

- TypeScript tests for schema validation, bar-to-seconds conversion, stem identity hashing, stale detection, and prompt composition.
- Python tests for generator routing with mocked AudioCraft models.
- Python tests for audio save paths and metadata sidecars.
- UI tests for project creation, tab navigation, block editing, arranger clip creation, render queue derivation, and player build with fixture WAVs.
- A no-model development mode should generate short fixture tones so UI and queue behavior can be tested without downloading MusicGen weights.
- Optional local smoke tests can use `facebook/musicgen-small`.

Before marking meaningful implementation work complete, run the relevant lint, typecheck, unit tests, and available UI tests. If model-backed tests cannot run locally, state that clearly.

## Editing Discipline

- Keep changes scoped to the active plan item.
- Preserve local-first behavior.
- Do not introduce cloud services, telemetry, accounts, or background uploads unless explicitly requested.
- Do not add automatic rendering as a side effect of editing prompts, blocks, or arrangements.
- Do not delete generated user audio unless the user explicitly asks for cleanup behavior.
- Do not skip `commands.json` updates when adding project-editing UI.
- Prefer structured parsing and schemas over ad hoc string manipulation.
- Keep comments sparse and useful.
