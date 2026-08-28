# GENOST Remaining Work Plan

## HOWTO

Keep only unfinished work here. Move completed implementation facts to `README.md`, durable behavior/invariants to `docs/KNOWLEDGEBASE.md`, and completed milestone detail to `docs/implementation-history.md`.

Put blocking or review-needed decisions in `QnA` with a suggested answer. Do not remove this file while unresolved QnA remains.

## Working Guardrails

- Keep rendering behind explicit user actions and preserve all prior audio non-destructively.
- Keep MLX/Metal as the primary Apple Silicon MusicGen path; AudioCraft/PyTorch CPU is diagnostic only.
- Skip MusicGen/model-backed validation on machines without MusicGen installed.
- Do not start live GENOST or real model generation until the separator implementation and SMTV prompt preflight are complete.
- Audio separation is the final product implementation milestone. SMTV data cleanup and the live walkthrough follow it, but no additional product feature stage does.

## Next Pickup

Start with Realtime Player and UI Completion. The first concrete task is wiring Tone.js transport and the local Tuna-style graph for arranger preview/playback, matching the implemented offline graph closely enough for dependable arrangement decisions.

## 1. Realtime Player And UI Completion

- [ ] Wire Tone.js transport and the local Tuna-style graph for arranger preview/playback, matching the implemented offline graph closely enough for dependable decisions.
- [ ] Add final-mix loudness normalization and waveform previews for Player and Arranger.
- [ ] Add compact empty/error states for unreadable roots, invalid projects, missing permissions, and empty project folders.
- [ ] Add BPM, key, and model-cache-path validation plus compact saved/dirty/error state.
- [ ] Add render, regenerate, preview, reveal, and archive controls beside implemented melodies in Blocks, reusing Components actions.
- [ ] Add first-run backend validation and model-cache setup, separating hardware capability from the selected supported backend.
- [ ] Audit laptop/desktop overflow, palette balance, focus states, keyboard access, and dimensionally stable controls.

## 2. Automated Coverage And Packaging

- [ ] Expand recovery-script tests with mocked generation, retry, archive, ffmpeg mix, and MP3 export failures.
- [ ] Expand `render_smtv_suite.py` tests for sequential dependencies, retry reports, MP3 export, and intermediate WAV cleanup.
- [ ] Add UI coverage for project creation, navigation, block editing, arranger operations, render derivation/regeneration, cancellation, and fixture-tone mix builds.
- [ ] Wire fixture-tone mode through an end-to-end desktop queue test without downloading MusicGen weights.
- [ ] Split the normal MLX install from optional AudioCraft CPU diagnostic extras so the primary Apple Silicon environment passes dependency validation.
- [ ] Decide how the Python/MLX worker ships in a local macOS build; defer signing/notarization until render, separation, and mix workflows are stable.

## 3. Final Implementation Milestone: Exploratory Multi-Stem Separation

- [x] Install `audio-separator[cpu]==0.44.5` in isolated `.venv-separator`, validate Apple Silicon CoreML/CPU execution, and expose a writable model cache.
- [x] Start with `htdemucs_6s.yaml` and add persisted separation-bundle schemas for the raw WAV, every output, preferred target, preview metadata, per-output level, and merged derivatives.
- [x] Preserve raw MusicGen audio plus every `bass`, `drums`, `guitar`, `piano`, `vocals`, and `other` output; never discard non-preferred stems.
- [x] Show every separator output in Premix with synchronized bundle looping, stable individual Play/Pause, per-output volume, Reveal, status, model, source, and preferred-target labels.
- [x] Let the user select any subset and create a new level-aware non-destructive merged WAV; preserve all earlier merges and sources.
- [x] Journal separation, level, selection, merge, reveal, and archive/remove actions with project fingerprints.
- [x] Publish complete bundles/merges atomically and return structured setup, model, separation, output, merge, gain, and validation errors without partial results.
- [x] Share the multi-output helper between desktop worker renders and `scripts/render_smtv_suite.py`.
- [ ] Add mocked retention, preview, arbitrary-subset merge, archive, atomic-publication, and failure coverage plus an optional local six-stem smoke test.

## 4. SMTV Preflight Before Live GENOST

- [ ] Review the whole-song and every block prompt in all five `../ost_drafts` SMTV projects.
- [ ] Remove character/place/lore names, visual scene prose, non-audible suggestions, duplication, contradictions, and low-priority prompt noise.
- [ ] Preserve BPM, meter, key/mode, mood, energy arc, block role, allowed instruments, strict exclusions, vocal policy, isolation, and mix requirements.
- [ ] Keep later-variation wording concise and place recognizable-v1 conditioning ahead of retained musical constraints.
- [ ] Classify every SMTV block as bass/drone, rhythm, melody, or generic for category-aware spectral validation without permitting low-frequency collapse.
- [ ] Journal every project cleanup as `code-agent`, stale affected/downstream stems through normal hashes, and validate all five project/journal files without rendering.

## 5. Live GENOST Verification

- [ ] Start GENOST only after sections 1-4 and their code-level checks are complete.
- [ ] Reopen `../ost_drafts/smtv Sketch 01`, reproduce the single-stem path, and diagnose any remaining queued/rendering failure using managed-worker logs and persisted state.
- [ ] Verify Atmosphere v1 renders first and every later variation uses that exact ready v1 WAV with MusicGen Melody and the retained constraints.
- [ ] Verify category-aware validation and complete the five-project SMTV render/export run.
- [ ] Verify all separator outputs preview independently and arbitrary selected subsets merge without changing/deleting sources.
- [ ] Verify the general mix with fixture and real stems: resampling, timing/layers, effects, missing-clip report, loudness/peak, WAV sidecar, playback, waveform, and reveal.
- [ ] Complete the manual walkthrough across project persistence, Components, Blocks, Arranger, Player, archive/reveal, cancellation, and restart recovery.

## Recommended Pickup Order

1. Realtime Player/UI completion.
2. Automated coverage and packaging cleanup.
3. Audio separation as the final implementation milestone.
4. SMTV prompt/category preflight without launching GENOST.
5. Live single-stem diagnosis and full verification.

## QnA

No unresolved questions.
