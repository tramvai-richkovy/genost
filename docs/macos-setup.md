# GENOST macOS Setup

GENOST is macOS-first for this implementation. The target machine is Apple Silicon with local model files, local project/session files, and no cloud service dependency.

## System Packages

```bash
brew install ffmpeg python@3.10 node@22
xcode-select --install
rustup update
```

Use Node 22.13 or newer.

## Desktop App

```bash
cd apps/desktop
npm install
npm run tauri:dev
```

Browser-only development can use `npm run dev`, but native folder selection, reveal, export, and persisted sessions require Tauri.

## Python Worker

```bash
python3.10 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip setuptools wheel
python -m pip install -r genost_worker/requirements.txt
```

The Tauri app launches `.venv/bin/python -m genost_worker.server` automatically. For diagnostics:

```bash
source .venv/bin/activate
uvicorn genost_worker.api:app --host 127.0.0.1 --port 8765
curl http://127.0.0.1:8765/health
```

The normal environment uses MLX/Metal and does not install the AudioCraft or torchaudio CPU-generation stack. `mlx-audiocraft` currently declares PyTorch for model-weight loading/conversion, but GENOST does not select it as the primary generation backend. The unsupported AudioCraft CPU path is available only for diagnostics:

```bash
python -m pip install -r genost_worker/requirements-audiocraft-diagnostic.txt
```

## Local App Bundle

The first local distribution is an unsigned Tauri app with a PyInstaller worker sidecar. Build both together with:

```bash
cd apps/desktop
npm run tauri:build
```

The build script creates the target-triple-suffixed worker expected by Tauri and the app resolves it from the bundle resources at runtime. Development continues to use the repository `.venv` when no packaged worker exists. Signing and notarization are intentionally deferred until the render, separation, and mix workflows are stable.

## Required MusicGen Models

The studio flow is blocked until both models are found locally:

```text
facebook/musicgen-medium
facebook/musicgen-melody
```

Recommended cache setup:

```bash
export HF_HOME="/Volumes/YourSSDName/models/huggingface"
export AUDIOCRAFT_CACHE_DIR="$HF_HOME"
huggingface-cli download facebook/musicgen-medium --cache-dir "$HF_HOME"
huggingface-cli download facebook/musicgen-melody --cache-dir "$HF_HOME"
```

The setup screen also accepts a model cache path and HF home path. It calls the worker `/preflight` endpoint with those exact settings.

## MIDI And Conversion Tools

Text-to-MIDI uses a local AMAAI-Lab/Text2midi checkout:

```bash
git clone https://github.com/AMAAI-Lab/Text2midi ~/src/Text2midi
cd ~/src/Text2midi
python -m pip install -r requirements-mac.txt
export GENOST_TEXT2MIDI_REPO="$HOME/src/Text2midi"
```

The worker can also use a custom command template:

```bash
export GENOST_TEXT2MIDI_COMMAND='python /path/to/generate.py --caption "{prompt}" --output {output}'
```

MIDI-to-guide-WAV rendering uses:

```bash
python -m pip install pretty_midi scipy numpy
```

Melodic audio-to-MIDI conversion uses:

```bash
python -m pip install basic-pitch
```

Drum audio-to-MIDI conversion uses:

```bash
python -m pip install omnizart
omnizart download-checkpoints
```

Optional cleanup before melody extraction can use Demucs:

```bash
python -m pip install demucs
```

## Separation And Merge

The product separation and Premix workflow uses `audio-separator`. Configure it with:

```bash
./scripts/setup-audio-separator.sh
```

Set `AUDIO_SEPARATOR_MODEL_DIR` to move separator model weights, or `GENOST_AUDIO_SEPARATOR_BIN` to point at a custom executable.

After setup, an optional short real-model smoke test validates atomic publication and retention of all six outputs:

```bash
python scripts/smoke-test-separation.py --model-cache-path "$AUDIO_SEPARATOR_MODEL_DIR"
```

## Verification

Frontend:

```bash
cd apps/desktop
npm test
npm run build
```

Python:

```bash
source .venv/bin/activate
python -m unittest discover -s genost_worker/tests
```

Real generation, Text2MIDI, basic-pitch, omnizart, and Demucs checks require their local models and checkpoints. Model-free tests should continue to pass without downloading MusicGen.

## License Posture

AudioCraft code is MIT licensed, while the official released model weights are documented as CC-BY-NC 4.0. GENOST remains personal and non-commercial unless a future backend abstraction is added.
