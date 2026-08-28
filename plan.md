# GENOST Sessions And Artifacts Implementation Plan

## Authority And Scope

- `idea.md` at the repository root is the authoritative product specification.
- This `plan.md` is the only active implementation checklist.
- `AGENTS.md` contains maintenance rules derived from `idea.md` and this plan.
- `docs/original-idea.md` describes the older song-project DAW proof of concept. It is reference material, not the product specification.
- `../games/music` is the untouched archival POC. The song-project code currently present in this repository is reusable infrastructure, not an alternate product shell.
- Historical plans are read-only records under `docs/archive/`.

GENOST is a local-first macOS session studio. The primary units are a selected working directory, sessions, prompt revisions, and artifacts. The three session types are Stem Constructor, Free Format, and Midi Generator. The app must not allow session creation or opening until both `facebook/musicgen-medium` and `facebook/musicgen-melody` are available locally.

## Reviewed State

### Git history

- Commit `b6620c2` introduced both the song-project POC and a first Session Studio implementation.
- Commit `780f22c` is the best recovery source for the Session Studio; it contains the complete session UI before removal plus later audio-graph work.
- Commit `13d2651` removed the Session Studio, its store/schema/storage/tests, WaveRoll, and its styles, and made the song-project POC the active shell.
- Restore selected files from `780f22c`; do not revert the repository wholesale. The current worker, packaging, separation, audio validation, and Tauri fixes contain later improvements that must be retained.

### Recoverable Session Studio

The deleted snapshot contains useful first-pass implementations of:

- `apps/desktop/src/features/session-studio/SessionStudio.tsx`;
- `apps/desktop/src/app/sessionStore.ts`;
- `apps/desktop/src/lib/session/schema.ts`;
- `apps/desktop/src/lib/session/format.ts` and focused helper tests;
- `apps/desktop/src/lib/session/storage.ts` and focused storage tests;
- Session Studio CSS, the `wave-roll` dependency, and its JSX custom-element declaration;
- working-directory selection, strict two-model preflight, collapsible/searchable/tag-filtered session sidebar, session creation, all three session views, prompt revisions, artifacts, export/reveal, conversion, separation, merge, and derived-session actions.

### Current code worth retaining

The current tree still has reusable, tested infrastructure:

- the FastAPI worker and single-job render queue;
- MLX/Metal MusicGen generation with AudioCraft CPU diagnostics;
- strict medium/melody model-cache preflight;
- `/midi/text`, `/midi/guide-wav`, and `/midi/from-audio` worker endpoints;
- `pretty_midi`/SciPy guide rendering, Basic Pitch melodic conversion, and the Omnizart drum adapter;
- six-output separation and level-aware non-destructive merging;
- audio validation, atomic WAV publication, sidecars, waveform preview, and local asset-path helpers;
- Tauri v2 plugins, filesystem scopes, worker sidecar packaging, and macOS bundle configuration;
- useful POC visual language and audio controls.

### Known defects in the deleted snapshot

Do not treat restoration as completion. The reviewed snapshot has these known gaps:

- Prompt archive tabs are display-only; old revisions cannot be selected for viewing.
- Archive labels and artifact folders drift after repeated archives (`archive-N` labels can point at a different suffixed folder).
- Stem Constructor can generate again against a locked revision and does not expose the same revision workflow as the other session types.
- Manual reference audio remains an external absolute path instead of becoming a portable session artifact.
- The cross-session artifact picker is flat, not the required session/revision/artifact tree, and one unreadable session can empty the whole picker.
- Audio-derived sessions skip the required drum-removal/separation step before melodic MIDI extraction.
- Derived sessions record lineage but do not fully materialize/reference their source chain for immediate use.
- Text2midi launches a fresh model process once per requested result; it needs a cached worker-side adapter or an explicitly managed long-lived process.
- Worker preflight does not report Text2midi, Basic Pitch, guide-WAV, separator, and drum-transcription capabilities as separate action-level readiness states.
- Omnizart documents ARM macOS incompatibility. Its action must be capability-gated and isolated; it cannot be allowed to block the entire studio.
- The checked local environment is Python 3.10.17 on arm64, while README text still describes a 3.11 environment. Basic Pitch imports but reports unverified/unsupported dependency combinations; conversion readiness needs a real short-file smoke test, not an import-only check.
- Reloading a remembered working directory does not automatically complete preflight, leaving the studio blocked until a manual check.
- Model-setting edits can trigger overlapping preflight requests.
- Session creation closes its form even when persistence or validation fails.
- Session directory collision handling can make the folder name differ from the persisted session name without surfacing the distinction.
- Invalid session folders are not isolated during scans; one malformed `session.json` can fail the full sidebar refresh.
- Several journal actions use overly broad or incorrect command types (for example prompt editing as generation and volume editing as merge).
- Only generated audio reliably receives a sidecar; MIDI, guides, conversions, separations, and merges need consistent provenance metadata.
- Generation is sequential but lacks a clear per-artifact queue/cancel/retry UI and restart reconciliation.
- The historical Session Studio had helper tests but no adequate store or end-to-end UI coverage. Its old “completed” history entry is not proof of product completeness.

## Product Decisions

- Model gate: folder/model setup remains accessible, but session creation and opening are blocked until both required MusicGen models pass local preflight.
- Optional tools: missing Text2midi, Basic Pitch, separator, or drum-transcription dependencies disable only their corresponding actions with a structured explanation.
- Drum MIDI: preserve the requested Omnizart adapter, but treat it as optional on Apple Silicon until a verified compatible runtime exists. Do not silently substitute another model.
- Persistence: no database, cloud service, telemetry, account, or background upload.
- Generation: every generation, conversion, separation, merge, and derived-session operation is explicit. Editing never renders automatically.
- History: generated and converted files are non-destructive. Prompt revision folders and artifact lineage remain stable and inspectable.
- POC handling: do not delete useful song-project infrastructure until the session product has ports for the pieces it reuses. The song-project shell must not be mounted in the shipped app.
- CLI acceptance: `just test` is the intentional real-model CLI smoke command, not the deterministic unit-test command. It reads root `test_prompt.md` and creates exactly five independent MusicGen Medium composition variations.

## Implementation Checklist

### Progress snapshot — 2026-08-29 (stopped at user request)

Implementation in the current uncommitted worktree now includes:

- Session Studio restored and mounted as the sole product shell, with a build assertion preventing the song-project POC shell from being mounted.
- Portable session/workspace persistence with strict schemas, atomic serialized writes, isolated session scanning, immutable `archive-N` revisions, copied reference artifacts, provenance sidecars, and validated atomic `jobs/*.json` lifecycle records.
- Automatic strict two-model preflight plus action-level Text2midi, guide, Basic Pitch, separation, merge, and Omnizart capabilities.
- Python 3.10.17 dependency alignment for Apple Silicon: Basic Pitch 0.4 ONNX, setuptools below 81, scikit-learn through 1.5.1, Torch 2.7, Transformers 4.x, and SentencePiece. Basic Pitch probe/conversion runs in an isolated spawned process and the real 440 Hz probe passed.
- A local-only low-memory MLX loader that memory-maps the MusicGen checkpoint and preserves its float16 tensors. This eliminated the observed >16 GB checkpoint-conversion peak and allowed a real Medium render to complete generation; the deliberately one-second smoke output was correctly rejected by music validation and retained a structured failure.
- Long-lived batched Text2midi, typed WaveRoll integration, all three session types and prompt builders, artifact retry/cancel/export/conversion/separation/merge actions, derived-session pipelines, and the headless five-result acceptance CLI.
- Laptop-width responsive rules, focus-visible styling, accessible icon-control names/tooltips, and WaveRoll cleanup/error/Tauri-URL tests.

Verification completed before the stop request:

- Desktop suite: 28 files passed and one skipped, 110 tests passed and seven intentionally skipped; the production TypeScript/Vite build and product-shell assertion passed. Targeted stable-folder/job-record storage coverage also passed after that full run.
- Worker suite: 53 tests passed before the final isolated-Basic-Pitch test was added; the real isolated Basic Pitch smoke passed afterward.
- Rust formatting and source compilation passed earlier using the no-sidecar source-check configuration.
- `just test` was attempted three times. The first two runs were killed during the original high-memory MLX conversion. The final run used the low-memory loader and was still generating when the user asked to stop; PID 19030 was terminated and no WAV had yet been published. Its manifest is `test-output/20260828T223844Z/batch-manifest.json` and remains `status: "running"` because the CLI does not yet reconcile externally terminated batches.

Still required before the Definition of Done: rerun the complete deterministic suite after the final edits, finish the five-output real acceptance pass and inspect its audio, add interruption reconciliation for CLI manifests, close the broader store/UI/storage coverage listed below, build/run the unsigned app bundle, and perform a real Tauri working-directory walkthrough.

### 0. Product authority and planning reset

- [x] Review `idea.md`, repository docs, current implementation, Git history, and the deleted Session Studio snapshot.
- [x] Identify `780f22c` as the selective recovery source.
- [x] Archive the conflicting root and `docs/` plans.
- [x] Establish `idea.md` and this file as the only product specification and active implementation plan.
- [x] Record the known defects that must be fixed after restoration.
- [x] Commit the documentation-only planning reset after user review.

### 1. Restore the product shell without regressing current infrastructure

- [x] Restore the session schema, format helpers, storage helpers, store, Session Studio UI, tests, WaveRoll integration, and only the required Session Studio styles from `780f22c`.
- [x] Mount Session Studio as the sole product entrypoint.
- [x] Keep the current worker sidecar build, Tauri capabilities, filesystem scopes, audio helpers, separation helpers, validation, and packaging changes.
- [x] Keep song-project modules unmounted and clearly marked as POC/reuse source; decide after feature parity whether to move them under a legacy folder.
- [x] Add a source/bundle assertion that the active entrypoint cannot mount the song-project browser/workspace.

### 2. Make session persistence authoritative and resilient

- [x] Finalize strict Zod schemas for workspace metadata, sessions, prompt revisions, artifacts, lineage, export state, action capabilities, and append-only commands.
- [x] Define one stable folder layout for `session.json`, `commands.json`, active/revision artifact folders, sidecars, job records, and retained conversion/separation outputs.
- [x] Fix prompt revision label/folder allocation so each revision owns one immutable folder and viewable label.
- [x] Copy manually selected reference audio into the session and register it as an artifact before use.
- [x] Make workspace/session/command writes atomic and serialized without losing append-only journal entries after concurrent actions or restart.
- [x] Scan sessions independently, keep valid cards visible, and report malformed/unreadable siblings without failing the entire workspace.
- [x] Keep session names, directory names, collision suffixes, artifact counts, timestamps, tags, and last-selected session consistent.
- [x] Add explicit command types for prompt edits, reference selection/import, volume changes, retries/cancelation, and capability failures.
- [x] Write provenance sidecars for every produced artifact kind, not only MusicGen WAVs.

### 3. Complete setup and capability preflight

- [x] Run preflight automatically after bootstrap, folder selection, and a debounced/explicit settings save.
- [x] Require local `facebook/musicgen-medium` and `facebook/musicgen-melody` before session creation/opening.
- [x] Report backend, device, cache paths, cache writability, both model states, and actionable setup errors.
- [x] Add separate readiness checks for Text2midi, MIDI guide dependencies, Basic Pitch, separator, ffmpeg/merge, and Omnizart.
- [x] Align the documented/bundled Apple Silicon Python version with the actually verified Basic Pitch runtime and pin compatible conversion dependencies.
- [x] Make Basic Pitch readiness include a short local inference smoke test or an equivalent verified model/runtime probe rather than import success alone.
- [x] Keep MusicGen Medium MLX checkpoint conversion within the assumed 16 GB memory budget by memory-mapping local weights and preserving float16 tensors.
- [x] Disable individual artifact actions when their optional capability is unavailable; keep unrelated session work usable.
- [x] Add stale-request protection so an older preflight response cannot overwrite newer settings.

### 4. Finish the working-directory shell and session creation

- [x] Restore the wide collapsible session sidebar with search, tag filter, name, type, tags, and artifact count.
- [x] Persist sidebar state, known tags, model settings, and last selected session in workspace metadata.
- [x] Show the three central choices—Stem Constructor, Free Format, and Midi Generator—with the requested title, emoji, and concise description.
- [x] Keep default names `se-{yymmdd}-{N}` while allowing the user to edit the free-form name before creation.
- [x] Support BPM presets plus custom BPM, tag creation/selection, and optional export-folder selection.
- [x] Keep the creation form open and show field/action errors when creation fails.
- [ ] Verify dense laptop and desktop layouts, keyboard navigation, focus states, tooltips, and stable control dimensions.

### 5. Harden Text2midi and MIDI visualization

- [x] Replace per-result Text2midi model reloads with a cached adapter or long-lived worker process that can generate a requested batch.
- [x] Preserve local-only model/cache configuration and return structured dependency, model, input, generation, and publication errors.
- [x] Generate collision-safe MIDI artifacts with exact prompt, seed/settings where available, model version, and timing metadata.
- [x] Restore WaveRoll through a small typed React wrapper and pin a verified version.
- [ ] Test Tauri asset URLs, multi-track MIDI, empty/corrupt MIDI, playback disposal, and multiple results on one screen.

### 6. Implement correct prompt revisions and all three session types

- [x] Make archived prompt revisions selectable and read-only, with their artifacts visible under the matching revision.
- [x] Make `+` archive the current state without renaming old folders, then create the next collision-safe revision folder with the prior prompt copied and editable.
- [x] Lock a revision only after a generation request is durably recorded.
- [x] Free Format: prompt, quantity, optional imported/linked/tree-selected reference, Medium without reference, Melody with reference.
- [x] Midi Generator: prompt, quantity, locked generated revision, WaveRoll result previews, and later prompt revision creation.
- [x] Stem Constructor: all eleven requested constructors, four or five editable preset/custom fields, concise deterministic prompt builders, quantity, and the same revision rules.
- [x] Add prompt-builder fixtures for every constructor, including the atmospheric-pad example.

### 7. Complete artifact lifecycle actions

- [x] Render stable artifact rows/cards for audio, MIDI, guide WAV, separated stem, premix, and conversion outputs.
- [x] Support rename, audio/MIDI preview, reveal, export, missing-file state, retry/cancel where applicable, and exact provenance display.
- [x] Export to the session export folder with collision-safe names and journal the source/destination.
- [x] Convert audio to melodic MIDI with Basic Pitch and to drum MIDI with the capability-gated Omnizart adapter.
- [x] Split audio non-destructively into retained stems, persist per-stem volume, and merge any selected subset without changing sources.
- [x] Build the required hierarchical reference picker: session → prompt revision/folder → artifact.
- [x] Keep every active artifact inside its session folder; represent external source files as copied/imported artifacts.

### 8. Implement derived-session pipelines exactly

- [x] From MIDI: render a clean 32 kHz sine guide, generate a Melody-conditioned audio artifact in the current session, then create and open the chosen derived session with full lineage.
- [x] From audio: label the action `Start session from this melody`, separate/remove drums first, transcribe the clean melodic source to MIDI, render a sine guide, generate Melody-conditioned audio, then create/open the derived session.
- [x] Persist every intermediate artifact and relationship so failed pipelines are inspectable and restartable.
- [x] Generate readable collision-safe derived-session names from the source session/artifact/action.
- [x] Do not create the derived session until the required source audio is ready; retain earlier successful intermediates after later failure.

### 9. CLI acceptance workflow

- [x] Add a headless CLI command dedicated to real MusicGen composition generation; it must not require Tauri or the web UI.
- [x] Make `just test` invoke that CLI with root `test_prompt.md` as its prompt source.
- [x] Normalize the Markdown prompt into intentional whitespace without changing its words.
- [x] Preflight the configured cache/backend and require local `facebook/musicgen-medium`; fail before publishing outputs when unavailable.
- [x] Generate exactly five independent text-only composition variations with `facebook/musicgen-medium`, distinct recorded seeds, and no melody/reference conditioning.
- [x] Publish each variation non-destructively under a timestamped test output directory with WAV, metadata sidecar, prompt hash, model, backend, device, seed, duration, validation metrics, and a batch manifest.
- [x] Keep partial successes and a structured failure report if a later variation fails; never overwrite an earlier batch.
- [x] Add CLI flags for output directory, duration, cache/backend, and seed base while keeping `just test` fixed to five variations and `test_prompt.md`.
- [x] Move deterministic repository checks to a clearly named command such as `just verify`; tests must never silently download model weights.
- [ ] Run the real `just test` acceptance pass on the target Mac and inspect all five outputs before release.
- [ ] Reconcile or finalize an acceptance batch when its process is externally terminated; interrupted runs currently retain their partial files but can leave the manifest at `status: "running"`.

### 10. Verification and release readiness

- [ ] Add schema/format tests for all session, artifact, lineage, revision, capability, and journal invariants.
- [ ] Add storage tests for scan isolation, atomic writes, journal serialization, stable revision folders, import copying, export collisions, and missing assets.
- [ ] Add store tests for model gating, failed creation, prompt locking/archive selection, batch progress, optional capabilities, retries, and derived pipelines.
- [ ] Add UI tests for folder selection, sidebar collapse/search/filter, all creation types, all session views, artifact actions, and WaveRoll rendering.
- [ ] Add worker tests for cached Text2midi batching, guide WAV, Basic Pitch, Omnizart error mapping, separation/merge, and structured preflight.
- [ ] Keep fixture-backed tests model-free; run optional local smoke tests for each installed real model/tool.
- [ ] Run `just verify`, Rust format/check, package the unsigned macOS app, and perform a real working-directory walkthrough.
- [ ] Update README, setup, format, and implementation-history docs with only verified behavior; move completed plan details to history and leave only unfinished work here.

## Definition Of Done

The first proper version is done only when a user can select a working directory, pass the strict two-model gate, create and reopen each session type, generate and revisit prompt revisions, manage every artifact action, complete both MIDI-derived and audio-derived session flows, restart without losing state or lineage, run `just test` to obtain five valid MusicGen Medium compositions from `test_prompt.md`, and package/run the macOS app. Model-free checks must pass without downloads; unavailable optional tools must produce honest disabled states or structured errors.

## QnA

No unresolved product questions. Omnizart's Apple Silicon limitation is an implementation constraint handled by action-level capability gating, not a reason to change the requested product silently.
