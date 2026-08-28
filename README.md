# GENOST

GENOST is a local-first macOS session studio for AI-assisted music generation. It uses a Tauri v2 desktop shell, a React/TypeScript/Vite frontend, Tailwind styling, lucide icons, and a local Python worker for MusicGen, MIDI, separation, conversion, and merge tasks.

The archived proof of concept lives at `../games/music`. This repository keeps the POC infrastructure where it is still useful, but the active product model is now working-directory sessions and artifacts.

## Workflow

1. Select a working directory.
2. Configure the local model/cache path.
3. Pass preflight for both required MusicGen models:
   - `facebook/musicgen-medium`
   - `facebook/musicgen-melody`
4. Create or open a session.
5. Generate MIDI or audio artifacts from explicit user actions.
6. Preview, rename, reveal, export, convert, split, merge, or derive sessions from artifacts.

The app blocks session creation, opening, and generation until the worker reports both required models as locally available. Fixture generation is retained only for tests.

## Session Types

- `Stem Constructor`: structured prompt builders for focused musical parts and game/movie scene material.
- `Free Format`: text-to-audio generation with optional reference audio or linked artifacts.
- `Midi Generator`: local text-to-MIDI generation with WaveRoll piano-roll preview and clean guide-WAV handoff.

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

Python worker tests require the worker dependency environment from `genost_worker/requirements.txt`. The current local test environment uses Python 3.11 in `.venv` so `basic-pitch` can load its TensorFlow dependency:

```bash
python3 -m uv venv --python 3.11 .venv
python3 -m uv pip install --python .venv/bin/python --index-url https://download.pytorch.org/whl/cpu "torch>=2.1,<3" "torchaudio>=2.1,<3" "torchcodec>=0.1"
python3 -m uv pip install --python .venv/bin/python -r genost_worker/requirements.txt
.venv/bin/python -m unittest discover -s genost_worker/tests
```

`omnizart` is optional for drum audio-to-MIDI conversion and is kept outside the base worker requirements. Install `genost_worker/requirements-omnizart.txt` only on machines with the needed system audio headers.

See [docs/macos-setup.md](docs/macos-setup.md) and [docs/project-format.md](docs/project-format.md).
