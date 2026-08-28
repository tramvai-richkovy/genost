# Archived: GENOST POC-Based Session Studio Plan

This was the interrupted first-pass plan for the sessions/artifacts product. It is retained for history only. The active plan is `/plan.md` at the repository root.

## HOWTO

Keep implementation work in `Open Items` as a checkbox list. Check items as they are completed, add new items when new required work appears, and remove the plan file once all items are complete and there are no unresolved questions.
Put any blocking or review-needed questions in `QnA`; add your suggested answers. If a question is answered, fold the answer back into `Open Items` as concrete work or a concrete decision, then remove the answered question. Do not delete the plan file while `QnA` still has unresolved questions. If all QnA items are resolved and there are still some Open Items - start implementing those items; if some questions arise during the implementation so you're blocked with the solution of a current open item - pause the execution and ask user to answer them.
Example `Open Items` usage:
- [ ] Add a focused regression test for the failing scenario.
- [ ] Implement the smallest code change that satisfies the test.
- [x] Confirm the relevant helper already handles empty input.
Example `QnA` usage:
- [ ] Should the migration backfill old rows or only affect new rows?
  - Suggested answer: backfill old rows if the user-facing UI depends on consistent historical data.

## Open Items

- [x] Import the POC from `../games/music` as the starting point for this repository, while leaving the original POC untouched as an archive.
  - Preserve the POC's Tauri v2 desktop shell, React/TypeScript/Vite stack, Tailwind styling approach, lucide icons, theme handling, folder-picker behavior, worker launch assumptions, and local-first persistence.
  - Preserve the parts that already feel comfortable: project browser layout density, dark studio feel, explicit user actions, render job status, audio preview patterns, separation/premix workflow, and command journaling.
  - Rename concepts in the copied code only where the new session/artifact model requires it; avoid a ground-up rewrite of working infrastructure.
- [ ] Reframe the POC product model from song projects/blocks/arranger into working-directory sessions and artifacts.
  - Replace "project" as the main user unit with "session".
  - Keep a selected working directory as the root of all persisted state.
  - Store workspace metadata with schema version, updated timestamp, known tags, last selected session, remembered sidebar state, and model/cache settings.
  - Store each session in a portable folder with a session JSON file, append-only command journal, artifact directories, archive directories, and stable relative asset paths.
  - Keep all active artifacts for one session in the same session folder.
  - When archiving a prompt/state, do not rename existing artifact folders; allocate new folders with numeric suffixes such as `archive-1`, `archive-2`, etc.
- [ ] Design the new session schema and migrate POC storage helpers to it.
  - Support session types `stem_constructor`, `free_format`, and `midi_generator`.
  - Store mandatory free-form session name, display title, BPM, type, created/updated timestamps, artifact count, optional tags, optional export folder, prompt history tabs, active prompt revision, and lineage to source artifacts/sessions.
  - Add BPM presets for rock, downtempo, ambient, dnb, jungle, techno, house, and a custom numeric value, defaulting to 120 BPM.
  - Keep atomic JSON writes, strict Zod parsing, command journals, relative asset paths, and scan/load/save patterns from the POC.
  - Add command entries for workspace selection, session creation/opening, BPM changes, tag changes, export-folder changes, prompt archival, generation requests, artifact rename, export, reveal, conversion, separation, merge, and derived-session creation.
- [ ] Define artifact schema and filesystem conventions.
  - Support audio clips, separated audio stems, MIDI clips, guide-audio clips, premix/merge audio, and conversion outputs.
  - Store artifact id, name, kind, media type, file name/path, parent artifact id, source session id, prompt revision id, model/backend metadata, conversion metadata, status, timestamps, and export status.
  - Use default names like `artifact1`, `artifact2`, `artifact3`, while allowing rename.
  - Provide artifact actions: reveal location, export to session export folder, convert audio to melodic MIDI, convert audio to drum MIDI, split audio into stems, adjust stem volumes, merge selected stems, and start a derived session.
- [ ] Add strict model availability gating.
  - The app must not enter the usable studio flow unless both `facebook/musicgen-medium` and `facebook/musicgen-melody` are available locally.
  - Keep a setup/model gate screen that can show missing dependencies and allow selecting the working directory/cache path, but block session creation, opening, and generation until preflight passes.
  - Extend worker health/preflight to report exact medium/melody model availability, backend, device, cache paths, and actionable missing dependency/model errors.
  - Hide POC offline/fixture generation from product flow; keep fixture paths only for tests.
  - Ensure text-only generation uses the medium model and reference/melody-conditioned generation uses the melody model.
- [ ] Adapt the POC Python worker for the new workflows.
  - Keep FastAPI, async render jobs, job polling/cancelation, MusicGen wrapper, backend selection, cache handling, audio validation, separation, and merge code.
  - Add text-to-audio generation for Free Format without reference audio using `facebook/musicgen-medium`.
  - Add melody-conditioned generation for Free Format with reference audio, Stem Constructor, MIDI-derived sessions, and audio-derived sessions using `facebook/musicgen-melody`.
  - Add MIDI generation with local `amaai-lab/text2midi`, taking a prompt and quantity.
  - Add MIDI-to-clean-guide-WAV conversion using `pretty_midi`, `numpy`, and `scipy.io.wavfile`, based on Appendix 1 in `idea.md`.
  - Add melodic audio-to-MIDI conversion using Spotify `basic-pitch`.
  - Add drum audio-to-MIDI conversion using `omnizart drum transcribe`.
  - Add optional Demucs preprocessing for cleaner melody extraction from dirty MusicGen audio before audio-to-MIDI conversion.
- [ ] Adapt the POC frontend shell instead of replacing it wholesale.
  - First screen selects the working directory and model/cache readiness.
  - After selecting a directory, show a wide ChatGPT-like session sidebar with previous sessions, search, tag filters, session name/title, and artifact count.
  - Make the sidebar collapsible with a standard hamburger button and persist collapsed state.
  - Keep the main area usable with no active session by showing three new-session choices.
  - Reuse the POC's polished studio styling and interaction density, updated to match session/artifact language.
- [ ] Build the new-session creation flow.
  - Show three central choices: Stem Constructor, Free Format, and Midi Generator.
  - Render each choice with a large title treatment, an emoji marker, and explanatory paragraph text.
  - On choice selection, create a session after collecting free-form name, BPM/preset, optional tag, and optional export folder.
  - Allow new tag creation from text input and existing tag selection from a dropdown.
- [ ] Build the MIDI Generator session.
  - Provide prompt input and quantity of MIDI stems to generate.
  - After a generation run, lock that prompt revision.
  - Add a `+` prompt archival control that moves current contents into `archive-1`, `archive-2`, etc. for later viewing and starts a fresh editable prompt with the previous prompt text retained.
  - Visualize each generated MIDI result with WaveRoll or a confirmed equivalent.
  - Allow each MIDI artifact to start a Free Format or Stem Constructor flow by rendering a clean guide WAV and feeding it to MusicGen Melody.
- [ ] Build the Free Format session.
  - Provide prompt input, quantity of audio clips to generate, BPM controls, tag controls, and export-folder controls.
  - Provide optional reference audio from manual file selection, a linked artifact from another session, or a tree browser over all session artifacts such as `session1/archive-3/artifact15.wav`.
  - Use MusicGen Medium when no reference audio is selected.
  - Use MusicGen Melody when reference audio is selected.
  - Show generated audio artifacts with rename, preview, reveal, export, split-to-stems, convert-to-melodic-MIDI, convert-to-drum-MIDI, and start-session-from-melody actions.
  - Reuse the POC separation/premix UX for splitting stems, per-stem volume knobs, and merge publishing.
  - Support prompt archival with stable old artifact folders and new suffixed folders.
- [ ] Build the Stem Constructor session.
  - Provide a restricted constructor list for arpeggio, bass, drums, pad, lead, keys, solo guitar, choir parts, game/movie scene, game boss battle theme, and game regular encounter.
  - Limit each constructor to 4 or 5 high-value attributes.
  - Let users choose existing values or type custom values for each attribute.
  - Generate careful prompts from structured fields, with output like `170 BPM, D minor, atmospheric pad, lush synthesizer, 90s intelligent jungle, clean mix`.
  - Allow quantity selection and generation of multiple candidate audio artifacts.
  - Reuse Free Format artifact actions and prompt archival behavior.
- [ ] Implement derived-session workflows.
  - From a MIDI artifact, create guide audio with Appendix 1, generate audio in the current session with MusicGen Melody, then create a named derived Free Format or Stem Constructor session linked to that generated audio.
  - From an audio artifact, label the action `Start session from this melody`.
  - For audio-derived sessions, strip drums/separate as needed, convert the clean melody to MIDI, synthesize a clean sine guide WAV, then feed that guide to MusicGen Melody.
  - Generate stable names for derived sessions from source session, artifact name, action type, and a collision-safe suffix.
- [ ] Implement export and reveal behavior.
  - Let each session store an export folder chosen through the desktop folder picker.
  - Copy selected artifacts to the export folder on export, preserving extension and allocating collision-safe names.
  - Use Tauri opener APIs to reveal artifact locations for local files.
  - Show clear disabled/error states when an artifact is missing, not ready, or has no export folder.
- [ ] Add audio and MIDI previews.
  - Reuse existing POC audio preview and separation-loop preview where possible.
  - Add MIDI visualization for generated MIDI artifacts.
  - Add MIDI guide-audio preview where useful for MusicGen Melody handoff.
- [ ] Add tests and verification.
  - Add schema tests for workspace, session, artifact, prompt archive, command journal, and migration behavior.
  - Add storage tests for session scan/search/tag counts, atomic writes, folder suffix allocation, export copying, and relative path resolution.
  - Add prompt builder tests for every Stem Constructor template.
  - Add frontend tests for workspace selection states, session sidebar search/filter/collapse, session creation, prompt archival, artifact actions, and model gate behavior.
  - Add worker unit tests for model preflight, MIDI-to-guide WAV rendering, request validation, derived-session pipeline orchestration, and error mapping.
  - Add model-free fixture tests where real MusicGen/text2midi/basic-pitch/omnizart dependencies are unavailable.
  - Run `npm test`, `npm run build`, and the Python worker test suite before considering implementation complete.
- [ ] Finish first-pass implementation hardening after the interrupted work session.
  - Re-run `npm test` and `npm run build` after the last cleanup patches and fix any new failures before checking off frontend/session implementation items.
  - Run the full Python worker test suite inside a proper `.venv` with worker dependencies installed; the base shell was missing `fastapi`, `torch`, and `soundfile`, so only the model-free subset was verified.
  - Smoke test the Tauri app with a real working directory and model cache: folder picker, strict preflight gate, collapsible sidebar, session creation/opening, prompt archival, artifact previews, export/reveal, conversion, separation, merge, and derived-session actions.
  - Review the changes using the code-review guidance from `../games/music/AGENTS.md`, put findings before summary, and fix any high/medium-severity findings.
  - Add a QnA item and pause if that review finds a conflict between the implementation and the suggested fixes in this plan.
- [ ] Update developer docs.
  - Document local setup for required MusicGen medium and melody models, `amaai-lab/text2midi`, WaveRoll, `pretty_midi`, `scipy`, `basic-pitch`, `omnizart`, and Demucs.
  - Document the new workspace/session/artifact JSON format and command journal.
  - Document which POC modules were reused, which old workflows were retired, and why the use cases shifted after the POC findings.

## QnA

- [x] What is the exact distinction between session `name` and `title` in the sidebar?
  - answer: it's the same thing, by default se-{yymmdd}-{N} (N =1 if it is free, otherwise if 2 is free - it's 2, and so on, just next free int for today), you may change it.
- [x] What default audio duration should new generation runs use?
  - answer: default to 30 seconds or less (25 is desireable aim, better 25 than 30) to match MusicGen's common generation limit, then add duration controls only after the first proper version works.
- [x] Which exact WaveRoll package/API should be used for MIDI visualization?
  - answer: verify the maintained npm package before implementation; if WaveRoll is not installable or compatible with React 19/Vite, find modern compatible alternative that is properly maintained and widely accepted and has visual + audial preview.
- [x] Should the app support Windows/Linux now, or continue the POC's macOS-first Tauri desktop target?
  - answer: keep macOS-first for the first proper implementation because the POC worker/backend setup and local model assumptions are already macOS-oriented.
