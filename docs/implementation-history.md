# GENOST Implementation History

This file preserves historical implementation work. Active work lives only in root `plan.md`; root `idea.md` is the product specification.

## Session Studio Restoration And Hardening — 2026-08-29

- Selectively restored the Session Studio schema, storage, store, UI, tests, WaveRoll dependency, and styles from `780f22c` while retaining the newer worker, separation, Tauri, validation, and packaging code.
- Mounted Session Studio as the sole product entrypoint and added a production-bundle assertion that rejects song-project shell markers.
- Added isolated session scanning, serialized/atomic journals, portable manual reference imports, immutable collision-safe prompt folders, selectable read-only archives, correct Stem Constructor locking, and exact artifact provenance sidecars.
- Added automatic/stale-safe preflight with action-level Text2midi, guide-WAV, Basic Pitch, separator, ffmpeg merge, and Omnizart readiness; optional tools no longer affect the two-model product gate.
- Replaced per-result Text2midi launches with a local-only long-lived batch service, added the typed WaveRoll wrapper, and recorded Text2midi seeds/version/timing metadata.
- Completed non-destructive artifact retry/cancel/progress and restart/missing-file reconciliation, hierarchical references, audio drum-removal before melodic extraction, retained intermediate lineage, and materialized derived-session source audio.
- Added the headless five-variation MusicGen Medium acceptance CLI behind `just test` and moved deterministic checks to `just verify`.
- Made acceptance batches interruption-safe with `SIGINT`/`SIGTERM` manifest finalization, process identity and heartbeat metadata, and next-run reconciliation of abandoned manifests while retaining partial outputs.
- Completed a real MLX/Metal acceptance batch with five distinct seeded 25-second MusicGen Medium WAVs, sidecars, full metrics, a ready manifest, and successful independent decode/integrity checks; subjective listening remains pending.
- Fixed reproducible unsigned DMG packaging under macOS locale rules, bundled Basic Pitch ONNX data into the frozen worker, and verified the packaged app launches with both MusicGen models plus the real isolated Basic Pitch probe available.
- Verified 112 desktop tests with 7 intentional skips, the TypeScript/Vite production build and product-shell assertion, all 56 model-free worker tests, Rust formatting/compilation, a checksum-valid unsigned DMG, and packaged worker preflight. Subjective acceptance listening and the full working-directory walkthrough remain pending.

## Product Direction Correction — 2026-08-29

- The sessions/artifacts product in root `idea.md` is authoritative.
- The song-project DAW is proof-of-concept infrastructure, not the product.
- The “Portable Project Product Cutover” below is retained as an accurate record of code changes, but its product decision was incorrect.
- Session Studio can be selectively recovered from commit `780f22c`; current worker, packaging, separation, and validation improvements must be preserved.
- The previous root and `docs/` plans were archived under `docs/archive/`; the reviewed recovery/completion checklist is root `plan.md`.

## Portable Project Product Cutover — Completed 2026-08-29

- [x] Made the startup gate, portable project browser, DAW project workspace, and render processor the only shipped frontend path.
- [x] Removed the retired Session Studio component, session store/schema/storage implementation and tests, its WaveRoll dependency and JSX declaration, and its inactive prototype stylesheet.
- [x] Replaced the obsolete session/artifact format guide with the authoritative portable `genost.json`, command-journal, stem-sidecar, separation, mix, and atomic-write format.
- [x] Confirmed neither the source tree nor production bundle contains retired Session Studio or WaveRoll symbols.
- [x] Verified 97 desktop tests with 2 intentional skips, the TypeScript/Vite production build, Rust formatting and compilation, 50 worker tests, 28 script tests, and `git diff --check`.

## Five-Project SMTV Prompt Preflight — Completed 2026-08-28

- [x] Made the preflight byte-for-byte idempotent for already-clean and renamed blocks, corrected its live `../games/ost_drafts` default, and added two-pass regression coverage.
- [x] Reviewed all five whole-song directions and all 39 composed block prompts, removed prohibited names, replacement duplication, visual/non-audible prose, and contradictory or noisy instructions, while retaining musical constraints and category assignments.
- [x] Fixed Python isolation matching to use word boundaries and made explicit bass, drums, vocals, guitar, and piano separator targets take precedence in both Python and TypeScript prompt composition.
- [x] Applied and journaled the cleanup as `code-agent`, confirmed reruns made no further file changes, and validated every live project and journal through desktop Zod schemas.

## Exploratory Multi-Stem Separation — Completed 2026-08-28

- [x] Closed the final product milestone with retention, synchronized preview, arbitrary level-aware subset merge, archive, atomic-publication, malformed-output, and failed-ffmpeg coverage across worker and desktop layers.
- [x] Added `scripts/smoke-test-separation.py` and ran a three-second local `htdemucs_6s` smoke pass through the isolated separator environment and cached model.
- [x] Verified the raw fixture remained intact and all six 32 kHz `bass`, `drums`, `guitar`, `piano`, `vocals`, and `other` WAV outputs were retained and readable.

## Automated Coverage And Local macOS Packaging — Completed 2026-08-28

- [x] Expanded recovery and SMTV suite coverage across retry exhaustion, non-destructive archive failures, ffmpeg/MP3 cleanup, dependency-order rendering, and melody-conditioned routing.
- [x] Added desktop interaction coverage for arranger cloning, queue cancellation, and a complete fixture-tone queue transition with WAV sidecar and command-journal persistence.
- [x] Removed AudioCraft and torchaudio from the supported MLX environment, kept their pinned CPU backend in an optional diagnostic requirements file, and refactored shared WAV analysis/publication to NumPy and SoundFile.
- [x] Selected an unsigned PyInstaller worker sidecar for the first local Tauri build, wired it into the primary Tauri bundle configuration, and retained repository `.venv` startup for development.
- [x] Fixed frozen-worker parent lifecycle monitoring and collected MLX's native Metal resources; verified the packaged worker health endpoint on Apple Silicon with MLX/Metal and both external-cache MusicGen models available.
- [x] Verified 95 desktop tests, TypeScript/Vite production build, 44 worker tests, 24 script tests, and Rust `cargo check`.

## Local Python 3.11 Worker Test Environment — Completed 2026-08-28

- [x] Provisioned repo `.venv` with local CPython 3.11.16 through `uv`, leaving Ubuntu's externally managed `/usr/bin/python3` unchanged.
- [x] Installed the worker stack with CPU Torch, TorchCodec, TensorFlow 2.14, and `basic-pitch`, while excluding `omnizart` from the default worker dependency path.
- [x] Pinned NumPy below 2.0 for TensorFlow/basic-pitch ABI compatibility and added TorchCodec for current torchaudio WAV load/save behavior.
- [x] Moved `omnizart` to optional `genost_worker/requirements-omnizart.txt`, since its Linux install needs PortAudio headers through PyAudio.
- [x] Updated SMTV suite defaults and plan references to use `../games/ost_drafts` instead of the legacy `../ost_drafts` POC folder.
- [x] Fixed the MIDI guide-WAV test to assert output existence before its temporary directory is cleaned up.
- [x] Verified with the full Python worker suite, backend validation, SMTV script tests against `../games/ost_drafts`, desktop Vitest, Vite production build, Rust `cargo check`, and `git diff --check`.

## Realtime Arranger Preview — Completed 2026-08-28

- [x] Extracted the shared local Tuna-style Web Audio graph into `apps/desktop/src/lib/audio/audioGraph.ts` so realtime preview and offline mixdown use the same gain, block compressor, master delay, master reverb/pre-delay, limiter, output-gain, playable-stem, arrangement-duration, and effect-tail helpers.
- [x] Closed out final-mix normalization toward -14 dB RMS under a -1 dBFS peak ceiling, persisted the resulting metrics in mix sidecars and build journals, and added cached waveform previews to Arranger clips and Player playback with focused peak-bucketing and normalization tests.
- [x] Added compact Project Browser states for no root, empty roots, permission/read failures, and invalid project folders; scans now retain valid sibling projects while reporting invalid or unreadable entries.
- [x] Restored the required DAW project browser/workspace and render processor as the active desktop shell after finding the separate session/artifact prototype mounted in their place.
- [x] Added accessible BPM, key-notation, and absolute model-cache-path validation states plus compact live saved, dirty, saving, and save-error feedback.
- [x] Closed out implemented-melody actions in Blocks with shared requirement queue/non-destructive archive behavior, actionable reveal/archive failures, truthful disk-only control states, and focused regeneration coverage.
- [x] Completed first-run backend/cache setup: the gate now validates selected settings through worker preflight, reports hardware separately, blocks online mode until both models and dependencies pass, persists defaults into new projects, and routes renders through the project-selected backend.
- [x] Audited the DAW shell at its 1180×760 minimum and desktop width, fixed Components-row clipping with contained horizontal scrolling, wrapped Arranger transport at laptop width, preserved the multi-accent palette and stable control sizes, and added keyboard tab-navigation coverage.
- [x] Hardened `ArrangerRealtimePreview` to start Tone.js transport at the requested timeline offset, schedule active clips from the correct buffer offset after seeking, stop predictably at the arrangement/effect-tail end, and dispose preview players/effects/nodes on project changes.
- [x] Arranger preview now reports playable clip count, skipped missing/unreadable/empty clips, no-playable-stem errors, and an acid playhead aligned to the timeline grid.
- [x] Added mocked realtime preview tests covering missing-clip reporting, seek-offset scheduling, and no-playable transport guards.
- [x] Verified with focused desktop tests, full desktop Vitest, TypeScript/Vite production build, and `git diff --check`.

## Session Studio Prototype — Completed 2026-08-28, Retired As Active Shell

- [x] Imported the archived POC from `../games/music` without generated dependency/build artifacts.
- [x] Added the new workspace/session/artifact schema and Tauri storage helpers while preserving atomic JSON writes, command journals, relative asset paths, and scan/load/save patterns.
- [x] Built a working-directory setup gate, strict local model preflight, collapsible session sidebar, three new-session choices, prompt archival, generation controls, artifact preview/actions, export/reveal, separation, merge, conversion, and derived-session actions. The DAW project workflow was later restored as the active shell to match repository intent.
- [x] Added worker preflight for required `facebook/musicgen-medium` and `facebook/musicgen-melody` cache availability.
- [x] Added worker endpoints for AMAAI-Lab/Text2midi orchestration, MIDI-to-clean-guide-WAV rendering, melodic audio-to-MIDI conversion through basic-pitch, and drum audio-to-MIDI conversion through omnizart.
- [x] Verified WaveRoll as an installable npm package and integrated `wave-roll@0.4.0` for MIDI visualization.
- [x] Verified with frontend tests and production build. The full Python worker suite still requires a local worker dependency environment; the model-free subset passes in this shell.

## Shared Requirements And Packaging Cleanup — Completed 2026-08-27

- [x] Extracted arranger-to-stem render requirement derivation from Components into `apps/desktop/src/lib/project/requirements.ts`.
- [x] Reused identical component requirements while preserving variation numbers as distinct stem identities.
- [x] Added queue planning that synthesizes a canonical variation-1 anchor before queueing later same-block variations that need one.
- [x] Reused shared requirement state in Components and Arranger so dense layouts report missing, stale, input-missing, validation-failed, duration-blocked, and graph-cycle-blocked states consistently.
- [x] Added focused desktop tests for requirement identity, queued variation-1 dependencies, regeneration stale propagation, validation-failed status labeling, and restart reconciliation decisions.
- [x] Removed the published `tunajs@1.0.4` dependency and its obsolete nested `npm@6` tree, replacing the offline mix graph dependency with an auditable local Tuna-style Web Audio wrapper for gain, compressor, delay, and convolver.
- [x] Verified with desktop Vitest, TypeScript/Vite production build, and `git diff --check`; MusicGen/model-backed validation was skipped on the user's instruction because this machine does not have MusicGen installed.

## Two-Track MusicGen Recovery — Completed 2026-08-26

- [x] Reproduced the rejected low-frequency prompt/seed collapse across AudioCraft CPU, Hugging Face Transformers SDPA/eager, and MLX, then proved model/runtime health with canonical broadband controls on independent small and medium checkpoints.
- [x] Selected MLX AudioCraft 0.1.0 on Metal for Apple Silicon and retained AudioCraft CPU as a diagnostic fallback.
- [x] Added cached backend routing for text, melody-conditioned, and continuation generation; backend/device/model/timing response metadata; structured health reporting; and a retained MusicGen smoke-test workflow.
- [x] Added peak normalization, atomic non-overwriting WAV publication, and `basic`, `music`, and `full_mix` validation profiles covering duration, finite samples, silence, clipping, DC, spectrum, centroid, flatness, and zero-crossing activity.
- [x] Added shared atomic JSON, exact sidecar, non-destructive archive, stem-transition, content-hash, and append-only code-agent journal helpers.
- [x] Archived the rejected stems, sidecars, and mixes for both projects without deleting history, while preserving Covenant Breaker's previously detached bad-prompt asset.
- [x] Generated twelve validated revision-02 stems: one text anchor and five melody-conditioned evolutions per project. Rejected candidates were not published and their attempts were retained under `JOBS/`.
- [x] Rebuilt each project with six blocks and twelve arranged clips, then produced 183.75-second stereo 32 kHz 24-bit WAV masters with crossfades, high-pass cleanup, loudness normalization, limiting, and fades.
- [x] Validated project state and journals through the desktop Zod schemas and verified six ready stems, twelve clips, and a current mix path per project.
- [x] Exported both masters to the Desktop as WAV and stereo 44.1 kHz 320 kbps MP3 files, and decoded/validated the MP3 results through the full-mix profile.
- [x] Completed the recovery verification pass: 14 Python tests, targeted recovered-project Zod validation, five repository TypeScript tests, TypeScript compilation, Vite production build, Rust `cargo check`, backend health, final audio metrics, and project invariants.

## HOWTO

Keep implementation work in `Open Items` as a checkbox list. Check items as they are completed, add new items when new required work appears, and remove the plan file once all items are complete and there are no unresolved questions.

Put any blocking or review-needed questions in `QnA`; add your suggested answers. If a question is answered, fold the answer back into `Open Items` as concrete work or a concrete decision, then remove the answered question. Do not delete the plan file while `QnA` still has unresolved questions. If all QnA items are resolved and there are still some Open Items, start implementing those items. If questions arise during implementation that block the current open item, pause execution and ask the user to answer them.

Example `Open Items` usage:
- [ ] Add a focused regression test for the failing scenario.
- [ ] Implement the smallest code change that satisfies the test.
- [x] Confirm the relevant helper already handles empty input.

Example `QnA` usage:
- [ ] Should the migration backfill old rows or only affect new rows?
  - Suggested answer: backfill old rows if the user-facing UI depends on consistent historical data.

## Product Goal

Build GENOST as a local-first macOS studio for AI-assisted music generation. The app should feel like a focused electronic music workbench, not a generic prompt toy: a user selects a projects folder, creates or opens a song project, defines the song aesthetic, declares reusable blocks, arranges block variations on a layered timeline, renders only the components they choose, and builds a playable mix from the generated stems.

The MVP should run on the user's macOS laptop with local project files and local AI generation through Meta AudioCraft MusicGen. Seed blocks are generated from text with `facebook/musicgen-medium`; blocks with an input/reference stem use `facebook/musicgen-melody` for melody/chroma-conditioned generation. TUNA is used for Web Audio effects in preview and mix playback.

## Source Notes

Checked on 2026-08-25:

- [AudioCraft README](https://github.com/facebookresearch/audiocraft): AudioCraft is the official PyTorch library containing MusicGen; its README lists Python 3.9, PyTorch 2.1.0, and ffmpeg as relevant setup requirements. It also documents model cache environment variables and states the code is MIT while released model weights are CC-BY-NC 4.0.
- [MusicGen docs](https://github.com/facebookresearch/audiocraft/blob/main/docs/MUSICGEN.md): Official examples show `MusicGen.get_pretrained`, `set_generation_params`, text generation, and `generate_with_chroma`; the docs describe `facebook/musicgen-medium` and `facebook/musicgen-melody` as the practical quality/compute trade-off, with `facebook/musicgen-small` as the fallback for smaller GPUs.
- [PyTorch MPS docs](https://docs.pytorch.org/docs/stable/notes/mps.html): PyTorch supports the `mps` device on macOS for Metal acceleration where available.
- [Tauri dialog plugin](https://v2.tauri.app/plugin/dialog/) and [Tauri filesystem plugin](https://v2.tauri.app/plugin/file-system/): Tauri v2 can open native folder dialogs and work with scoped filesystem access, which fits a desktop app that needs user-selected project folders.
- [TUNA](https://github.com/Theodeus/tuna): TUNA provides Web Audio effects including delay, convolver/reverb, compressor, ping-pong delay, gain, and filters.
- [Tone.js](https://tonejs.github.io/): Tone.js provides transport and Web Audio scheduling primitives useful for the player/timeline preview layer.

## Working Decisions

- App shell: Tauri v2 desktop app for macOS, with React, TypeScript, Vite, and Tailwind in the webview.
- Package manager: npm with `package-lock.json` for the first dev scaffold.
- Target machine: Apple Silicon Mac with at least 16 GB unified memory.
- Local AI backend: Python worker process managed by the Tauri app. The worker exposes local loopback HTTP/WebSocket APIs for long-running render jobs and progress events.
- Project state: portable JSON file in each project folder, plus WAV stems and mix outputs on disk. Avoid a database for MVP unless JSON performance becomes a real problem.
- User input journal: every meaningful project-facing web UI input/action appends to `commands.json` so code agents can inspect and transform projects later.
- Render policy: nothing renders automatically. GENOST computes required components and shows them in the render tab; the user explicitly renders all, renders one, pauses queued work, or rerenders stale work.
- Stem identity: every unique `blockId + variation + inputStemId + prompt/settings hash + seed` is a distinct stem row and a distinct file under `STEMS/`.
- Timeline reuse: if the exact same generated stem appears multiple times in the arranger, reuse the same WAV. If two otherwise identical blocks use different variation numbers, generate different passes.
- Audio preview: use Tone.js for transport and scheduling, TUNA for preview effects, and a shared parameter model for delay, reverb, compressor, and limiter controls.
- Final build: MVP can render final mix with `OfflineAudioContext` and the same Web Audio/TUNA graph. Add a Python mixdown fallback only if long offline renders are unreliable.
- macOS model storage: expose `AUDIOCRAFT_CACHE_DIR`, `HF_HOME`, and related cache paths in settings so large models can live on an external SSD.
- License posture: GENOST is currently for personal, non-commercial use with AudioCraft released weights.
- Implemented melodies: MVP stores generated audio stems plus text metadata. MIDI/chord progression support is the first post-MVP roadmap priority.
- Long blocks: MVP does not support blocks beyond a single MusicGen generation window.
- Archive policy: stale/detached prior revisions go under `ARCHIVE/`; use `DETACHED_` prefix when the source block was removed or changed enough that the stem is out of date.
- Dependency policy: if a changed stem was used as input for child stems, mark child stems stale too and require explicit rerender.
- Graph policy: a separate arranger graph tab edits block input links live; generation is blocked while the graph contains a loop.

## Architecture

### Repository Shape

Expected implementation structure:

```text
.
|-- apps/
|   `-- desktop/
|       |-- src/
|       |   |-- app/
|       |   |-- components/
|       |   |-- features/
|       |   |   |-- project-browser/
|       |   |   |-- composition/
|       |   |   |-- blocks/
|       |   |   |-- arranger/
|       |   |   |-- player/
|       |   |   `-- render-queue/
|       |   |-- lib/
|       |   |   |-- audio/
|       |   |   |-- project/
|       |   |   |-- schema/
|       |   |   `-- worker-client/
|       |   `-- styles/
|       `-- src-tauri/
|-- genost_worker/
|   |-- api.py
|   |-- audiocraft_generator.py
|   |-- jobs.py
|   |-- mixer.py
|   `-- schemas.py
|-- scripts/
|   |-- setup-macos.sh
|   |-- check-audio-backend.py
|   `-- dev.sh
`-- docs/
    |-- plan.md
    |-- original-idea.md
    |-- audiocraft-snippets.txt
    |-- project-format.md
    `-- macos-setup.md
```

### Runtime Process

1. Tauri starts the React app.
2. React asks Tauri to open a native folder picker for the GENOST projects root.
3. Tauri grants/scopes filesystem access to that folder and persists the last root in app settings.
4. React scans direct child folders for `genost.json`.
5. Opening a project loads `genost.json`, validates it with Zod, and hydrates UI state.
6. Tauri launches the Python worker on demand when the render tab or setup check needs it.
7. Render requests are sent to the worker; progress and status updates stream back to the UI.
8. Completed stems are written to `STEMS/`, metadata is written beside the WAV, and `genost.json` is updated atomically.
9. Player build reads the arranger, skips missing stems, applies volume/effects, writes a mix WAV to `MIXES/`, and enables playback controls.

### Project Folder Format

Each project should be self-contained:

```text
ProjectsRoot/
`-- My Track/
    |-- genost.json
    |-- commands.json
    |-- STEMS/
    |   |-- bass_v03_ab12cd34.wav
    |   `-- bass_v03_ab12cd34.json
    |-- MIXES/
    |   `-- mix_2026-08-25_143022.wav
    |-- REFERENCES/
    |-- WAVEFORMS/
    |-- JOBS/
    `-- ARCHIVE/
```

Use atomic writes for `genost.json` and `commands.json`: write to a `.tmp` file, then rename. Never delete old stems during rerender; mark them superseded or archived and keep the file until a later cleanup feature exists.

### Project Schema

Initial `genost.json` shape:

```json
{
  "schemaVersion": 1,
  "id": "uuid",
  "title": "Track title",
  "createdAt": "2026-08-25T00:00:00.000Z",
  "updatedAt": "2026-08-25T00:00:00.000Z",
  "song": {
    "prompt": "Overall composition aesthetics, BPM, references, mood, key",
    "bpm": 170,
    "key": "D minor",
    "timeSignature": [4, 3],
    "swing": {
      "feel": "soft",
      "ratio": 1.35
    },
    "mood": "nocturnal, focused, tense",
    "genreReferences": ["techno", "intelligent jungle"],
    "sampleRate": 32000
  },
  "blocks": [
    {
      "id": "uuid",
      "name": "Pad",
      "bars": 16,
      "timeSignature": null,
      "instruments": ["lush synth pad"],
      "melodyDescription": "Evolving minor chord pad",
      "melodyPrompt": "90s intelligent jungle atmospheric pad",
      "volumeDb": -6,
      "delaySend": 0.15,
      "reverbSend": 0.35,
      "compressorEnabled": false,
      "implementedMelodies": []
    }
  ],
  "arrangement": {
    "lanes": [
      {
        "id": "uuid",
        "name": "Layer 1",
        "clips": [
          {
            "id": "uuid",
            "blockId": "uuid",
            "variation": 1,
            "startBar": 0,
            "bars": 16,
            "inputStemId": null,
            "stemId": "derived-or-null"
          }
        ]
      }
    ]
  },
  "stems": [],
  "mix": {
    "masterDelay": 0,
    "masterReverb": 0,
    "masterLimiter": true,
    "lastBuildPath": null
  }
}
```

### Generation Rules

- Convert bars to seconds with `seconds = bars * beatsPerBar * 60 / bpm`; default `beatsPerBar` is 4.
- Cap generation duration to the tested MusicGen limit for the selected model. If a block is longer, split into chunks and use continuation/chunk assembly as a later phase.
- Seed block: no `inputStemId`; generate with `facebook/musicgen-medium` and a prompt composed from song prompt, BPM/key, block instruments, block melody prompt, variation number, and desired role.
- Conditioned block: has `inputStemId`; generate with `facebook/musicgen-melody` using the input WAV as chroma/melody reference.
- Regenerate creates a new seed and new stem identity. It does not overwrite the previous WAV.
- If global song prompt or block settings change, mark dependent stem rows as `stale` by hash mismatch. Do not auto-render.
- Store the exact composed prompt and generation parameters in each stem metadata JSON for reproducibility.

### Five Project Tabs

1. Composition
   - Structured MusicGen prompt inputs for BPM, time signature, swing, key, mood, purpose, reference notes, avoid list, genre reference tags, rhythm feel, sonic palette, production notes, arrangement notes, and reference MP3.
   - Generates the composition prompt from filled fields and blocks render queueing until BPM, time signature, swing, mood, and at least one genre reference are present.
   - Preserves reusable genre reference tags in `genost-workspace.json` at the selected projects-folder level.
   - Save immediately with debounce and visible dirty/saved state.

2. Blocks
   - Editable list of block declarations.
   - Fields: name, duration in bars, optional time signature override, role, instruments, melody description, melody prompt, rhythm feel, timbre/texture, energy, density, avoid list, volume, delay send, reverb send, compressor on/off.
   - Shows implemented melodies/stems for each block with status, stem file name, play, reveal, regenerate, and queue render actions.

3. Arranger
   - Multi-layer timeline with lanes.
   - Drag blocks into the timeline, move clips, resize by bar, and choose variation 1-16.
   - Clip card shows block name, variation, stem name/status, input marker, and stale/missing state.
   - A clip with no input is a seed generation requirement. A clip with input references another block's latest ready stem and uses the melody model.
   - Repeated exact clip requirements reuse the same stem. Different variation numbers create different stems.

4. Graph
   - Shows block-to-block input links.
   - Allows live remapping of links.
   - Shows graph loops and blocks generation while loops exist.
   - Marks target and downstream nodes stale after remapping.

5. Player
   - Build button creates the current mix from arranger layers.
   - Build skips missing/ungenerated stems and reports skipped clips.
   - Playback controls: play, pause, rewind, fast-forward, timeline scrubber, current time, duration.
   - Master mix panel: master delay, master reverb, limiter, output gain, and simple peak/clipping indicator.

6. Components
   - Complete render queue for all required stems.
   - Rows show stem name, source block, variation, model, input stem, duration, status, stale reason, file path, and error details.
   - Controls: Render All, Render Selected, Pause Queued, Render, Pause/Cancel, Rerender.
   - Nothing is queued automatically unless the user presses a render action.

### Visual Direction

- Tailwind theme: near-black workbench base, graphite panels, cold cyan grid lines, acid green active states, red/orange render warnings, restrained violet accents only where useful.
- Dense, DAW-like layout: project browser grid, compact top tab bar, left metadata column where needed, timeline as the primary visual surface.
- Cards are only for project tiles and repeated rows/items. Do not wrap full page sections in decorative cards.
- Use lucide icons for folder, plus, play, pause, skip, refresh, wand/render, warning, settings, and file reveal actions.
- Stable dimensions for project cards, tab bars, icon buttons, timeline tracks, queue rows, and transport controls so labels/status changes do not shift the layout.
- Avoid visible instructional copy inside the app. Use labels, tooltips, disabled states, and status badges instead.

## Open Items

### Creative Generation

- [ ] Regenerate the original evolving world theme and battle theme after the unsupported MPS renders were found to contain spectrally degenerate rumbling; preserve the rejected stems and prior mixes under `ARCHIVE/`.
- [ ] Expand both arrangements beyond repeatedly crossfading only two or three 16-second stems, with distinct generated sections and at least three minutes per final mix.

### Audio Generation Remediation

- [ ] Stop selecting PyTorch MPS for AudioCraft; use CUDA when available and the supported CPU diagnostic path on macOS, with an explicit error for an MPS override.
- [ ] Add atomic generated-audio writes and validation so silent, non-finite, clipped, truncated, or full-arrangement outputs with degenerate low-frequency spectra cannot become ready stems.
- [ ] Add focused Python tests for device routing, atomic audio validation, and rejection of the rumbling-output profile.
- [ ] Run a short CPU MusicGen control render before regenerating project assets.

### Planning And Setup

- [x] Review `docs/original-idea.md`, `docs/audiocraft-snippets.txt`, and the existing `docs/plan.md` template.
- [x] Replace the template with this GENOST implementation plan while preserving the HOWTO instructions.
- [x] Confirm QnA decisions with the user before starting implementation.
- [x] Choose the package manager and lockfile strategy for the desktop app.
- [x] Create the initial repository structure for `apps/desktop`, `genost_worker`, `scripts`, and `docs`.
- [x] Add root `README.md` with product, architecture, macOS backend, project format, and MVP acceptance details.
- [x] Add `AGENTS.md` with durable maintenance guidance for future coding agents.
- [x] Add detailed docs: `docs/macos-setup.md` and `docs/project-format.md`.
- [x] Move planning and reference documents into `docs/` and update root README/AGENTS references.

### macOS AI Backend Setup

- [x] Create a Python 3.9 virtual environment setup path for macOS.
- [x] Add dependency files for AudioCraft, PyTorch, torchaudio, FastAPI or equivalent local API server, and audio utilities.
- [x] Add `scripts/check-audio-backend.py` to verify Python version, torch import, `torch.backends.mps.is_available()`, AudioCraft import, torchaudio import, ffmpeg availability, and writable model cache path.
- [x] Add settings for `AUDIOCRAFT_CACHE_DIR`, `HF_HOME`, and optional external SSD cache location.
- [x] Implement `genost_worker/audiocraft_generator.py` from the snippet, with separate functions for text generation, melody-conditioned generation, and continuation/chunking.
- [x] Add model selection with `facebook/musicgen-small` fallback and `facebook/musicgen-medium`/`facebook/musicgen-melody` defaults.
- [x] Keep loaded model instances cached in the worker so repeated renders do not reload weights unnecessarily.
- [x] Add structured worker errors for missing model cache, unsupported device, out-of-memory, missing input stem, and failed audio save.

### Desktop App Bootstrap

- [x] Scaffold Tauri v2 + Vite + React + TypeScript.
- [x] Install and configure Tailwind.
- [x] Add Tauri dialog, filesystem, shell/process, and store capabilities needed for folder selection, project file access, worker launch, and app settings.
- [x] Add app-level state management, preferably Zustand unless the scaffold already favors another small store.
- [x] Add Zod schemas for all persisted project data and worker API payloads.
- [x] Add a minimal app layout with top-level routing between project browser and project workspace.

### Project Browser

- [x] Implement native "Select Projects Folder" action.
- [x] Persist and restore the last selected projects folder.
- [x] Scan selected root for child folders containing `genost.json`.
- [x] Render project cards as large square tiles with title and last modified timestamp.
- [x] Add "Create New Project" tile.
- [x] Create a new project folder with `genost.json`, `commands.json`, `STEMS/`, `MIXES/`, `REFERENCES/`, `WAVEFORMS/`, `JOBS/`, and `ARCHIVE/`.
- [x] Validate project names and prevent accidental overwrite of existing folders.
- [ ] Add empty/error states for missing permission, unreadable folder, invalid project file, and no projects found.

### Project Persistence

- [x] Implement `loadProject`, `saveProject`, and `updateProject` helpers.
- [x] Use atomic writes for `genost.json`.
- [x] Track `createdAt`, `updatedAt`, and schema version.
- [ ] Add migration framework for future `schemaVersion` changes.
- [x] Add hash helpers for prompt/settings fingerprints that determine whether a stem is current or stale.
- [ ] Add sidecar stem metadata read/write helpers.

### Command Journal

- [x] Add `commands.json` to the project folder format.
- [x] Add command journal schemas and frontend append helpers.
- [x] Document how code agents should use `commands.json`.
- [ ] Ensure every future project-editing control appends a command entry.
- [ ] Add tests for command journal append behavior and project-state hashes.

### Composition Tab

- [x] Build the overall composition prompt editor.
- [x] Add BPM, key, time signature, sample rate, default text model, default melody model, and model cache path controls.
- [x] Add structured MusicGen prompt inputs for mood, genre references, reference notes, purpose, avoid list, rhythm feel, sonic palette, production notes, arrangement notes, and reference track file.
- [x] Add mandatory project-level swing with straight, soft, triplet, and hard ratio help.
- [x] Propagate project swing into every composed stem prompt and stem prompt/settings hash.
- [x] Persist reusable genre reference tags at the selected projects-folder level.
- [x] Generate the composition prompt from filled structured fields and validate mandatory BPM, time signature, swing, mood, and genre references.
- [ ] Add validation for BPM range, key text, and writable cache path.
- [ ] Debounce persistence and show compact saved/dirty/error state.
- [x] Ensure edits mark dependent stems stale without deleting any files.

### Blocks Tab

- [x] Build CRUD UI for block declarations.
- [x] Add controls for name, bars, instruments, melody description, melody prompt, volume, delay send, reverb send, and compressor toggle.
- [x] Add optional per-block time signature override that falls back to the project time signature.
- [x] Add block role, rhythm feel, timbre/texture, energy, density, and avoid fields for stronger MusicGen prompts.
- [x] Add stable block IDs and slugged display names.
- [x] Show implemented melodies/stems grouped under each block.
- [ ] Add render, regenerate, play preview, reveal in Finder, and remove-from-project actions for implemented melodies.
- [ ] Ensure deleting a block warns if arranger clips reference it.
- [x] Ensure block edits mark dependent stems stale by hash.

### Arranger Tab

- [x] Build a multi-lane timeline with bar grid, zoom, horizontal scroll, and fixed-height lanes.
- [x] Add block palette to create clips on the timeline.
- [ ] Implement drag, move, resize, duplicate, and delete clip interactions.
- [x] Add variation selector limited to 1-16.
- [x] Add optional input selector for a clip, resolving another block's latest ready stem.
- [ ] Derive stem requirements from clips and sync missing rows into project state without queuing renders.
- [x] Show stem file name/status directly on each clip.
- [ ] Add stale/missing status styling that remains readable in dense timeline cells.
- [ ] Add rules to reuse exact stem requirements and create distinct stems for different variation numbers.

### Components Render Queue

- [x] Build the complete components table from derived required stems plus manually implemented melodies.
- [ ] Add filters for all, missing, stale, queued, rendering, ready, failed, and superseded.
- [ ] Add per-row Render, Pause/Cancel, Rerender, Play, Reveal, and Remove actions.
- [x] Add Render All control.
- [x] Show queue order for queued components.
- [x] Add per-row cancel/regenerate and play/pause preview controls.
- [x] Block queueing when arranger graph contains a loop.
- [ ] Add Render Selected controls.
- [ ] Implement queue ordering and single-worker concurrency for MVP.
- [ ] Stream progress, elapsed time, and current worker message to the UI.
- [ ] Persist job status transitions into project state.
- [ ] Define pause semantics: queued jobs pause immediately; active job cancellation terminates generation and marks the row canceled or failed without a partial WAV.

### Player And Mix Build

- [x] Build a transport panel with play, pause, rewind, fast-forward, scrubber, current time, and duration.
- [ ] Implement arranger-to-mix build that layers ready stems at their bar positions.
- [ ] Skip ungenerated clips and show a concise skipped-clips report.
- [ ] Apply per-block volume, delay send, reverb send, and compressor settings.
- [x] Add master delay, master reverb, limiter, and output gain controls.
- [x] Add additional master SFX parameters for delay, reverb, and limiter.
- [ ] Wire Tone.js for scheduling/playback and TUNA for effect nodes.
- [ ] Implement offline build to WAV under `MIXES/`.
- [ ] Add simple peak/clipping detection and warn if output clips.
- [ ] Persist `mix.lastBuildPath` and build metadata.

### Audio Details

- [ ] Normalize all imported/generated stems to the project sample rate for playback and mixdown.
- [ ] Generate waveform previews for timeline and player display.
- [ ] Add fade-in/fade-out or short crossfade at clip boundaries to reduce clicks.
- [ ] Decide mono/stereo handling and pan behavior for first MVP.
- [ ] Add loudness normalization strategy for stems or final mixes.
- [ ] Add an export/reveal action for final mix WAV.

### Design Implementation

- [x] Define Tailwind color tokens for GENOST.
- [x] Build app shell, tab bar, dense form controls, project tiles, queue rows, timeline clips, status badges, and transport buttons.
- [x] Add lucide icons and tooltips for icon-only controls.
- [x] Add light/dark theme toggle.
- [ ] Check all text at desktop and laptop-size widths for overflow.
- [ ] Verify the palette does not collapse into a single hue family.
- [ ] Add focus states and keyboard-accessible controls for core workflows.

### Tests And Verification

- [ ] Add broader TypeScript unit tests for schema validation, stale detection, and prompt composition.
- [x] Add initial TypeScript unit tests for bar-to-seconds conversion, command journal append behavior, and stem identity hashing.
- [ ] Add Python tests for generator function routing with mocked AudioCraft models.
- [ ] Add Python tests for audio save paths and metadata sidecar writes.
- [ ] Add UI tests for folder selection mock, project creation, tab navigation, block editing, arranger clip creation, render queue derivation, and player build with fixture WAVs.
- [ ] Add a no-model development mode that generates short fixture tones instead of invoking MusicGen.
- [ ] Add one optional local smoke test using `facebook/musicgen-small`.
- [ ] Run lint, typecheck, unit tests, UI tests, and a dev-server/manual macOS walkthrough before calling MVP complete.

### Packaging

- [x] Add macOS dev instructions for Homebrew ffmpeg, Python 3.9, the Python venv, and model cache configuration.
- [x] Decide whether the Python worker ships as source plus venv setup, a sidecar binary, or a user-installed dependency for the first local build.
- [x] Add `npm run tauri:dev` and `npm run tauri:build` scripts.
- [x] Add root `Justfile` with `just run`.
- [x] Add root `.gitignore` for Node, Tauri/Rust, Python, environment, cache, and local GENOST scratch outputs.
- [x] Update `just run` so it runs the desktop build before launching Tauri dev.
- [ ] Add first-run setup screen for backend validation and model cache path.
- [ ] Document Apple Silicon expectations and Intel/CPU fallback limitations.
- [ ] Add signed/notarized app packaging only after the MVP is stable.

## Acceptance Criteria

- Selecting a projects folder shows project cards and a create-project tile.
- Creating a project writes the expected folder structure and opens the workspace.
- All five tabs exist and persist their relevant state into `genost.json`.
- Blocks can be declared with bars, instruments, melody prompt, volume, delay, reverb, and compressor settings.
- Arranger clips can be layered, assigned variation numbers 1-16, and optionally linked to input stems.
- Components tab shows all missing/stale/ready stems and never renders without an explicit user action.
- Text generation and melody-conditioned generation route to the correct worker function.
- Each variation produces a separate stem file and metadata sidecar under `STEMS/`.
- Player build layers ready stems, skips missing stems, writes a mix WAV under `MIXES/`, and enables playback.
- TUNA effects are audible in preview/player path for delay, reverb, compressor, and limiter-style dynamics.
- The app runs locally on macOS with a documented setup path and a clear backend validation screen.

## QnA

No unresolved questions.

## Implemented Milestones — 2026-08-27

### Desktop Workflow And Persistence

- Completed startup online/offline planning choice, recursive project-root access, serialized atomic project/workspace saves, imported-stem blocks, and append-only command journaling with fingerprints.
- Completed arranger drag/drop offsets, shared scrolling, new-layer drops, bar resizing, clone/split/delete, variation indicators, zoom controls, block coloring, duration guards, and downstream stale propagation.
- Completed non-destructive block/component archive flows, referenced-clip removal warnings, Finder reveal, and preservation of detached/stale revisions.

### Worker Queue And Variation Chain

- Replaced blocking render calls with asynchronous single-worker jobs and polling.
- Added progress, elapsed time, structured failures, cancellation callbacks, atomic publication, persisted render metrics, restart reconciliation, and Tauri-parent worker cleanup.
- Made variation 1 the canonical seed and planned variations 2–16 against the same block's matching v1 stem through MusicGen Melody.
- Added recognizable-variation prompt instructions while retaining full mood, BPM, meter, instrument isolation, strict exclusions, and avoid requirements.
- Added category-aware validation routing and exact worker/sidecar metadata.

### Components And Offline Mix

- Completed Components filters, multi-select/Render Selected, Render All, per-row render/regenerate/cancel/preview/reveal/archive, queue order, progress, elapsed time, error, and validation presentation.
- Implemented layered offline arranger mix scheduling, project-rate decoding/resampling, mono centering/stereo preservation, TUNA gain/delay/convolver/compressor/limiter graph, short fades, missing-clip reports, peak reports, 24-bit WAV publication, sidecars, playback, and reveal.
- Enabled and scoped Tauri's asset protocol so `convertFileSrc` URLs can load project-local audio in Components, Blocks, Arranger waveforms, and Player.
- Added a dedicated Premix surface after Graph and moved Components before Player. Premix suppresses obsolete separation failures after a later bundle succeeds for the same source while preserving append-only history and labeling each ready bundle by source filename.
- Added sample-synchronized looping of complete six-stem bundles, persisted -60 dB through +6 dB output faders, and level-aware selected-output merges that record their exact balance.

### SMTV And Recovery Tooling

- Added the five-project foreground SMTV runner with sequential dependencies, v1 melody anchors for later variations, retry reports, category validation, MP3 export, and validated intermediate-WAV cleanup.
- Made incomplete mandatory six-output separation reject the source candidate, stale conditioned descendants, and immediately regenerate with fresh seed ranges; the suite stops after three regenerated candidates instead of looping forever. Separator output classification prefers explicit `(Label)` suffixes so source names such as `bass_toms` cannot mask the other five outputs.
- Added mandatory separator-target metadata and journaled classifications across all five SMTV drafts and repository recovery projects.
- Completed and validated the `Ash Meridian` and `Covenant Breaker` recovery projects and exports while preserving prior rejected audio under `ARCHIVE/`.

### Verification

- Worker suite: 26 Python tests passed, including asynchronous fixture/text/conditioned/continuation routing, cancellation, partial-output cleanup, structured failure metadata, persistence, audio validation, and generator behavior.
- Script suite: 11 Python tests passed.
- Desktop suite: 49 Vitest tests passed; TypeScript compilation and Vite production build passed under Node 22.13.1.
- Rust `cargo check` and `git diff --check` passed.
- Live GENOST/model-backed verification remains intentionally deferred until the separator and SMTV prompt-preflight milestones are complete.
