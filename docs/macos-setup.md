# GENOST macOS Setup

GENOST is macOS-first for this implementation. The target machine is Apple Silicon with local model files, local session/artifact files, and no cloud service dependency.

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

Text2midi runs in a managed long-lived subprocess. The model, REMI tokenizer, and FLAN tokenizer are loaded once and reused for all results in a requested batch. Hugging Face loads use `local_files_only=True`; preflight disables the action when the local checkout is not configured. Set `GENOST_TEXT2MIDI_MODEL_VERSION` when the checkout is not a Git worktree and exact version labeling is required.

The worker can also use a custom command template:

```bash
export GENOST_TEXT2MIDI_COMMAND='python /path/to/generate.py --caption "{prompt}" --output {output}'
```

MIDI-to-guide-WAV rendering uses:

```bash
python -m pip install pretty_midi scipy numpy
```

Melodic audio-to-MIDI conversion uses the requirements-pinned Basic Pitch ONNX runtime in an isolated process, preventing its CoreML/Torch imports from remaining resident beside MusicGen. Verify it with:

```bash
python scripts/check-basic-pitch.py
```

Drum audio-to-MIDI conversion uses Omnizart only when a compatible runtime is verified:

```bash
python -m pip install omnizart
omnizart download-checkpoints
```

Omnizart remains disabled on ARM macOS because the official project documents that runtime as incompatible. Its absence does not block sessions or melodic MIDI conversion.

## Separation And Merge

The artifact split/volume/merge workflow uses `audio-separator`. Configure it with:

```bash
./scripts/setup-audio-separator.sh
```

Set `AUDIO_SEPARATOR_MODEL_DIR` to move separator model weights, or `GENOST_AUDIO_SEPARATOR_BIN` to point at a custom executable.

After setup, an optional short real-model smoke test validates atomic publication and retention of all six outputs:

```bash
python scripts/smoke-test-separation.py --model-cache-path "$AUDIO_SEPARATOR_MODEL_DIR"
```

## Verification

Deterministic frontend, worker, and Rust checks:

```bash
just verify
```

Real MusicGen acceptance:

```bash
just test
```

This reads root `test_prompt.md` and produces exactly five MusicGen Medium WAVs under a new timestamped `test-output/` batch. The CLI rejects structurally invalid audio and records full spectral metrics for manual review; it does not apply a brightness-oriented content profile to the deliberately dark acceptance prompt. Interrupting the command with `SIGINT` or `SIGTERM` marks the batch manifest as interrupted while retaining completed and partial files; a later run also reconciles abandoned manifests whose local process is gone. Real generation, Text2midi, Basic Pitch, separation, and Omnizart checks require their local models and checkpoints. Model-free tests never download weights.

Unsigned local packaging uses `npm run tauri:build` from `apps/desktop`. The command pins an installed macOS UTF-8 locale for DMG creation, skips signing prompts, and bundles the Basic Pitch ONNX model data with the worker sidecar.

## License Posture

AudioCraft code is MIT licensed, while the official released model weights are documented as CC-BY-NC 4.0. GENOST remains personal and non-commercial unless a future backend abstraction is added.
