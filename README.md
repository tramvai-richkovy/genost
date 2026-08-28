# GENOST

GENOST is a local-first macOS session studio for AI-assisted music generation. It uses a Tauri v2 desktop shell, a React/TypeScript/Vite frontend, Tailwind styling, lucide icons, and a local Python worker for MusicGen, MIDI, separation, conversion, and merge tasks.

Root [idea.md](idea.md) is the authoritative product specification and root [plan.md](plan.md) is the only active implementation plan. The song-project DAW described by [docs/original-idea.md](docs/original-idea.md) and currently present in parts of the source tree is proof-of-concept infrastructure, not the product.

Status: the recoverable Session Studio snapshot exists in Git commit `780f22c`, but the current entrypoint still reflects the mistaken song-project cutover. Follow `plan.md` for the selective restoration and completion work; do not treat the current desktop shell as product-complete.

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

```bash
cd apps/desktop
npm test
npm run build
```

Python worker tests require the worker dependency environment from `genost_worker/requirements.txt`. The checked Apple Silicon `.venv` uses Python 3.10.17; Basic Pitch conversion must still pass its planned capability smoke test before being treated as ready:

```bash
python3 -m uv venv --python 3.10 .venv
python3 -m uv pip install --python .venv/bin/python --index-url https://download.pytorch.org/whl/cpu "torch>=2.1,<3" "torchaudio>=2.1,<3" "torchcodec>=0.1"
python3 -m uv pip install --python .venv/bin/python -r genost_worker/requirements.txt
.venv/bin/python -m unittest discover -s genost_worker/tests
```

`omnizart` is optional for drum audio-to-MIDI conversion and is kept outside the base worker requirements. Install `genost_worker/requirements-omnizart.txt` only on machines with the needed system audio headers.

The planned real-model CLI acceptance command is `just test`: it will read [test_prompt.md](test_prompt.md) and produce five MusicGen Medium composition variations. Until that checklist item is implemented, use the existing frontend/worker verification commands above.

See [docs/macos-setup.md](docs/macos-setup.md) and [plan.md](plan.md).
