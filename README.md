# GENOST

GENOST is a local-first macOS session studio for AI-assisted music generation. It uses a Tauri v2 desktop shell, a React/TypeScript/Vite frontend, Tailwind styling, lucide icons, and a local Python worker for MusicGen, MIDI, separation, conversion, and merge tasks.

Root [idea.md](idea.md) is the authoritative product specification and root [plan.md](plan.md) is the only active implementation plan. The song-project DAW described by [docs/original-idea.md](docs/original-idea.md) and currently present in parts of the source tree is proof-of-concept infrastructure, not the product.

Status: Session Studio is the sole desktop entrypoint. The restored implementation now includes portable workspace/session persistence, strict two-model gating, isolated optional capabilities, immutable prompt revisions, artifact provenance and sidecars, non-destructive retry/cancel flows, MIDI/audio-derived pipelines, and the headless acceptance CLI. Real-model walkthrough and unsigned packaging still require the configured local models and worker environment.

## Workflow

1. Select a working directory and local model/cache settings.
2. Pass preflight for both required models: `facebook/musicgen-medium` and `facebook/musicgen-melody`.
3. Create or open a Stem Constructor, Free Format, or Midi Generator session.
4. Generate audio or MIDI artifacts through explicit user actions.
5. Preview, rename, reveal, export, convert, split, merge, or derive sessions from artifacts.
6. Revisit immutable prompt revisions and their retained artifact folders.

Nothing generates automatically. Session creation and opening are blocked until both required MusicGen models are locally available. Optional tools gate only their corresponding artifact actions.

## Session Types

- `Stem Constructor`: structured prompt builders for focused musical parts and game/movie scene material.
- `Free Format`: text-to-audio generation with optional imported or linked reference audio.
- `Midi Generator`: local Text2midi generation with WaveRoll preview and clean guide-WAV handoff to MusicGen Melody.

## Repository Shape

```text
apps/desktop/             Tauri + React app
genost_worker/            Python worker and generation/conversion code
scripts/                  setup, validation, and dev helpers
docs/                     setup, format, and implementation notes
```

## Run

```bash
cd apps/desktop
npm install
npm run tauri:dev
```

Browser-only frontend work can use:

```bash
cd apps/desktop
npm run dev
```

Native folder selection, local persistence, reveal, and export require Tauri.

## Verification

Deterministic repository verification:

```bash
just verify
```

Python worker tests require the worker dependency environment from `genost_worker/requirements.txt`. The checked Apple Silicon `.venv` uses Python 3.10.17 with the pinned Torch/Transformers and Basic Pitch ONNX stack:

```bash
python3 -m uv venv --python 3.10 .venv
python3 -m uv pip install --python .venv/bin/python -r genost_worker/requirements.txt
.venv/bin/python -m unittest discover -s genost_worker/tests
.venv/bin/python scripts/check-basic-pitch.py
```

`omnizart` is optional for drum audio-to-MIDI conversion and is kept outside the base worker requirements. Install `genost_worker/requirements-omnizart.txt` only on machines with the needed system audio headers.

The intentional real-model acceptance command is:

```bash
just test
```

It preflights local `facebook/musicgen-medium`, reads [test_prompt.md](test_prompt.md), and publishes exactly five independent, seeded variations with sidecars and a batch manifest under `test-output/`. It never downloads weights or overwrites an older batch.

See [docs/macos-setup.md](docs/macos-setup.md) and [plan.md](plan.md).
