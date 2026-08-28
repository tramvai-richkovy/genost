# GENOST Product Knowledge Base

## Authority

- Root [`idea.md`](../idea.md) is the product specification.
- Root [`plan.md`](../plan.md) is the only active implementation checklist.
- [`original-idea.md`](original-idea.md) and the song-project documents under [`archive/`](archive/) describe proof-of-concept work only.
- When documents disagree, root `idea.md` wins; update the conflicting document rather than inventing a hybrid product.

## Product

GENOST is a local-first macOS sessions/artifacts studio. A user selects one working directory, configures local models, creates or opens sessions, generates audio/MIDI artifacts, converts and separates them, exports them, and starts derived sessions while keeping prompt revisions and lineage inspectable.

The three session types are:

- Stem Constructor;
- Free Format;
- Midi Generator.

The song-project Project Browser/Composition/Blocks/Arranger/Graph/Components/Premix/Player shell is not the product. It may supply reusable storage, audio, worker, separation, packaging, and visual code.

## Current Repository State

The current `main` entrypoint still mounts the mistaken song-project cutover. The sessions/artifacts product is therefore not currently shipped, even though much of its first pass is recoverable.

Git recovery facts:

- `b6620c2`: first Session Studio implementation introduced;
- `780f22c`: preferred selective recovery snapshot;
- `13d2651`: Session Studio deleted and song-project POC mounted.

The deleted snapshot had working-directory/session schemas, storage, state, UI, WaveRoll, generation, conversions, separation, merge, export/reveal, and derived-session actions. Root `plan.md` records the defects found during review and the required completion work.

The current Python worker still retains MusicGen generation, strict two-model preflight, Text2midi/MIDI guide/audio-to-MIDI endpoints, separation, and merge. Current Tauri and packaging work should be preserved during restoration.

## Non-Negotiable Product Rules

- Require local `facebook/musicgen-medium` and `facebook/musicgen-melody` before session creation or opening.
- Use Medium for text-only audio and Melody for reference/guide-conditioned audio.
- Do not generate or transform artifacts as an editing side effect.
- Keep session state and produced files local, portable, schema-validated, atomic, and inspectable.
- Keep commands append-only and keep produced artifacts non-destructive.
- Keep prompt revision folders stable; never rename old folders during archive.
- Copy manually selected references into the owning session.
- Preserve exact provenance and lineage for audio, MIDI, guides, separation outputs, premixes, and derived sessions.
- Missing optional tools disable their actions without bypassing the two-MusicGen-model product gate.
- Keep Omnizart optional on Apple Silicon unless a compatible runtime is verified.
- `just test` is the planned real-model CLI acceptance path: read root `test_prompt.md` and produce exactly five independent MusicGen Medium composition variations.

## Documentation Map

- [`../idea.md`](../idea.md): authoritative product request.
- [`../plan.md`](../plan.md): active reviewed implementation plan.
- [`../AGENTS.md`](../AGENTS.md): repository maintenance rules.
- [`session-format.md`](session-format.md): provisional sessions/artifacts persistence contract.
- [`macos-setup.md`](macos-setup.md): local runtime and model setup.
- [`implementation-history.md`](implementation-history.md): chronological history, including mistaken product cutovers.
- [`archive/`](archive/): superseded plans and song-project POC documentation.
