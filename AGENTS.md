# GENOST Sessions And Artifacts Maintenance Guide

These instructions apply to the whole repository.

## Product Authority And Intent

GENOST is a local-first macOS session studio for AI-assisted music generation. The authoritative product specification is root `idea.md`. The only active implementation checklist is root `plan.md`.

The product workflow is: select a working directory, pass local MusicGen Medium and Melody preflight, create or open a Stem Constructor, Free Format, or Midi Generator session, then generate and manage portable audio/MIDI artifacts and derived sessions.

The song-project browser, Composition, Blocks, Arranger, Graph, Components, Premix, and Player workflow is proof-of-concept infrastructure. Reuse its reliable local storage, audio, separation, worker, packaging, and visual patterns where useful, but do not mount it as the product shell or treat `docs/original-idea.md` as the product specification.

Before implementation work, read `idea.md`, `plan.md`, `README.md`, `docs/KNOWLEDGEBASE.md`, and `docs/audiocraft-snippets.txt`. Consult `docs/original-idea.md` only when reusing POC infrastructure.

## Current Planning State

- Root `plan.md` is the active working checklist. Keep it current while implementing.
- Check off completed items as they are finished.
- Add newly discovered required work to the relevant implementation-checklist section.
- Put blocking or review-needed decisions in `QnA` with a suggested answer.
- `docs/plan.md` is a pointer only. Do not create a second active plan.
- Do not remove root `plan.md` while unresolved QnA or unfinished work remains.

## Planned Stack

- Desktop app: Tauri v2.
- Frontend: React, TypeScript, Vite, Tailwind.
- Icons: lucide.
- Runtime schemas: Zod on the TypeScript side.
- AI backend: Python worker process launched by Tauri.
- Audio generation: Meta AudioCraft MusicGen.
- MIDI visualization/playback: WaveRoll.
- Playback and preview: native Web Audio/Tone.js helpers where useful.
- Effects and merge preview: reuse the local Tuna-style Web Audio graph where useful.
- Persistence: workspace metadata plus session-local JSON, MIDI, and audio files. Do not add a database for MVP.

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
session-studio/
session-sidebar/
session-create/
stem-constructor/
free-format/
midi-generator/
artifacts/
```

Shared frontend helpers belong under `apps/desktop/src/lib/`, grouped by purpose such as `audio`, `session`, `schema`, and `worker-client`.

## Workspace And Session File Invariants

The selected working directory contains workspace metadata, a workspace command journal, and one portable folder per session:

```text
genost-workspace.json
workspace-commands.json
se-YYMMDD-N/
  session.json
  commands.json
  artifacts/
  archive-1/
  archive-2/
  jobs/
```

Rules:

- Treat `session.json` as a session's source of truth.
- Treat each `commands.json` as the append-only journal of meaningful session-facing actions.
- Validate workspace, session, journal, artifact, and sidecar data through schemas before use.
- Write JSON atomically with a unique temp file and rename; serialize writes per workspace/session.
- Keep session folders portable and inspectable. Do not hide required state in app-global storage.
- Copy manually selected reference audio into the session and register it as an artifact.
- Keep produced audio, MIDI, guides, separation outputs, and premixes inside the owning session folder.
- Store provenance metadata in a sidecar beside every produced artifact.
- Never overwrite or delete prior generated/converted audio during rerender or retry.
- Prompt revision labels and artifact folders are immutable once published.
- Archiving a prompt never renames an existing folder; the next revision gets a new collision-safe `archive-N` folder.
- Preserve lineage across source sessions, source artifacts, conversions, guide WAVs, generated audio, and derived sessions.

## Command Journal Rules

- Append a journal entry for every meaningful workspace/session-facing UI input or action.
- UI edits use `actor: "user"` and `source: "web-ui"`.
- Code-agent edits use `actor: "code-agent"` and `source: "code-agent"`.
- Include enough payload data for a future code agent to understand or transform the action.
- Include session state fingerprints when available.
- Keep command entries append-only.
- Do not put secrets into `commands.json`.

## Model Gate And Generation Invariants

- Folder/cache setup remains accessible before model preflight.
- Block session creation and opening unless both `facebook/musicgen-medium` and `facebook/musicgen-melody` are locally available.
- Missing optional tools disable only their corresponding actions: Text2midi, MIDI guide dependencies, Basic Pitch, separation/merge, or Omnizart drum transcription.

Text generation:

- No reference audio.
- Uses text generation.
- Required model: `facebook/musicgen-medium`.

Conditioned generation:

- Has imported, linked, MIDI-guide, or derived reference audio.
- Uses melody/chroma-conditioned generation.
- Required model: `facebook/musicgen-melody`.

Rules:

- Generation quantities are 1 through 16.
- Each result gets its own artifact identity, collision-safe file, recorded seed/settings, and sidecar.
- Regenerate/retry creates a new artifact; it does not overwrite an older result.
- A prompt revision becomes locked only after its generation request is durably recorded.
- Nothing generates, converts, separates, merges, exports, or derives automatically from editing.
- Store the exact prompt, prompt revision, backend, model, seed, duration, device, reference artifact/path, generation settings, validation metrics, and timings.
- Text2midi models should be cached or served by a long-lived process; do not reload weights once per requested result.
- `just test` is the real-model CLI acceptance command. It reads root `test_prompt.md` and produces exactly five independent MusicGen Medium compositions with distinct recorded seeds.

## Audio Rules

- Normalize generated/imported audio to the session sample rate before reliable playback, conversion, or merge.
- MIDI-to-guide WAV uses pitch-pure sine waves, skips drum tracks, adds short note fades, avoids clipping, and publishes 16-bit PCM at 32 kHz.
- Audio-derived sessions must separate/remove drums before melodic MIDI extraction, then synthesize a clean guide before MusicGen Melody.
- Separation and merges are non-destructive and retain all source/output files.
- Missing files must disable actions and produce clear errors rather than disappearing from session state.

## macOS Backend Rules

- Prefer Apple Silicon with the supported MLX/Metal backend; keep AudioCraft CPU as a diagnostic path.
- Assume the target Mac has at least 16 GB unified memory unless the user says otherwise.
- Keep CPU fallback possible for diagnostics, but do not imply it will be fast.
- Provide a backend validation script before relying on generation.
- Validate Python/runtime dependencies, MLX/Metal, ffmpeg, both MusicGen models, and model cache writability.
- Expose model cache settings. Large model files may live on an external SSD.
- Relevant environment variables include `AUDIOCRAFT_CACHE_DIR` and `HF_HOME`.
- Cache loaded model instances in the Python worker so repeated renders do not reload weights unnecessarily.
- Return structured worker errors for missing cache paths, missing input stems, out-of-memory, unsupported device, failed imports, and failed audio writes.
- Treat Omnizart drum transcription as an optional capability because its official project documents ARM macOS incompatibility.

## License Rule

AudioCraft code is MIT licensed, but the official released model weights are documented as CC-BY-NC 4.0. This project is currently for personal, non-commercial use.

If commercial use becomes a goal, add a generation backend abstraction before deeply coupling the app to AudioCraft-specific assumptions.

## UI And Design Rules

- Build the Session Studio as the first usable screen after folder/model setup. Do not add a marketing landing page.
- Use a dense DAW-like layout.
- Use Tailwind with a near-black workbench base, graphite panels, cold cyan grid lines, acid green active states, red/orange warnings, and restrained violet accents.
- Avoid a one-hue palette.
- Use cards only for repeated session/artifact items. Do not nest cards.
- Use lucide icons for icon buttons where available.
- Use tooltips for icon-only controls.
- Keep the session sidebar, prompt composer, artifact rows/cards, previews, queue rows, and buttons dimensionally stable.
- Ensure text does not overflow or overlap at laptop and desktop sizes.
- Avoid explanatory in-app copy. Prefer labels, statuses, tooltips, and disabled states.

## Testing Expectations

Add focused tests as implementation appears:

- TypeScript tests for workspace/session/artifact schemas, prompt revisions, constructor prompts, names, lineage, journals, path resolution, and collision allocation.
- Store/UI tests for model gating, working-directory selection, sidebar search/filter/collapse, session creation, all three session types, revision selection, and artifact actions.
- Python tests for MusicGen routing, cached Text2midi batching, guide WAVs, Basic Pitch, Omnizart error mapping, separation/merge, save paths, and sidecars.
- Model-free fixture tests must not download model weights.
- `just verify` is the deterministic repository verification command.
- `just test` is intentionally model-backed: it uses `test_prompt.md` in CLI mode to produce five MusicGen Medium compositions and must fail clearly if the configured model is unavailable.

Before marking meaningful implementation work complete, run the relevant lint, typecheck, unit tests, and available UI tests. If model-backed tests cannot run locally, state that clearly.

## Editing Discipline

- Keep changes scoped to the active plan item.
- Preserve local-first behavior.
- Do not introduce cloud services, telemetry, accounts, or background uploads unless explicitly requested.
- Do not add automatic generation as a side effect of editing prompts, session metadata, constructor fields, or references.
- Do not delete generated user audio unless the user explicitly asks for cleanup behavior.
- Do not skip workspace/session journal updates when adding user-facing actions.
- Prefer structured parsing and schemas over ad hoc string manipulation.
- Keep comments sparse and useful.
