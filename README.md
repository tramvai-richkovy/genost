# GENOST

GENOST is a local-first macOS DAW-style studio for AI-assisted music generation. It uses a Tauri v2 desktop shell, a React/TypeScript/Vite frontend, Tailwind styling, lucide icons, and a local Python worker for MusicGen and separation tasks.

The archived proof of concept lives at `../games/music`. This repository carries its useful infrastructure forward into the active portable-project workflow.

## Workflow

1. Select a projects folder.
2. Create or open a portable song project.
3. Define composition settings and reusable blocks.
4. Arrange numbered block variations on layered lanes and edit their dependency graph.
5. Explicitly render selected Components with MusicGen Medium or Melody.
6. Preview separator outputs in Premix and build, play, and reveal a final mix in Player.

Nothing renders automatically. Offline planning remains available when the local model backend is unavailable, and fixture generation is retained for tests.

## Studio Surfaces

- `Composition`: project-wide musical direction and model settings.
- `Blocks`: reusable stem definitions and implemented melodies.
- `Arranger` and `Graph`: layered clips, variations, and conditioning dependencies.
- `Premix` and `Components`: separated outputs and the explicit render queue.
- `Player`: offline mix build, waveform, playback, and master effects.

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
