#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import os
import platform
import shutil
import sys
from pathlib import Path


def module_available(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


def main() -> int:
    print(f"python={platform.python_version()}")
    print(f"executable={sys.executable}")
    print(f"ffmpeg={shutil.which('ffmpeg') or 'missing'}")
    separator_bin = Path(
        os.environ.get("GENOST_AUDIO_SEPARATOR_BIN", Path(__file__).resolve().parents[1] / ".venv-separator/bin/audio-separator")
    ).expanduser()
    print(f"audio_separator={'ok' if separator_bin.is_file() else 'missing'}")
    print(f"audio_separator_executable={separator_bin}")

    for module in ["torch", "torchaudio", "audiocraft", "mlx", "mlx_audiocraft", "fastapi", "uvicorn"]:
        print(f"{module}={'ok' if module_available(module) else 'missing'}")

    if module_available("torch"):
        import torch

        print(f"torch_version={torch.__version__}")
        print(f"mps_available={torch.backends.mps.is_available()}")

    mlx_supported = platform.system() == "Darwin" and platform.machine() == "arm64" and module_available("mlx_audiocraft")
    print(f"generation_backend={'mlx' if mlx_supported else 'audiocraft'}")
    print(f"generation_device={'metal' if mlx_supported else 'cpu'}")
    print("audiocraft_mps_supported=false")
    print("note=MPS hardware availability does not imply AudioCraft MPS generation support")

    cache_path = os.environ.get("AUDIOCRAFT_CACHE_DIR") or os.environ.get("HF_HOME")
    if cache_path:
        path = Path(cache_path)
        path.mkdir(parents=True, exist_ok=True)
        probe = path / ".genost-write-check"
        probe.write_text("ok\n", encoding="utf-8")
        probe.unlink()
        print(f"model_cache_writable={path}")
    else:
        print("model_cache_writable=not_configured")

    separator_cache = Path(
        os.environ.get("AUDIO_SEPARATOR_MODEL_DIR", Path(__file__).resolve().parents[1] / ".audio-separator-models")
    ).expanduser()
    separator_cache.mkdir(parents=True, exist_ok=True)
    separator_probe = separator_cache / ".genost-write-check"
    separator_probe.write_text("ok\n", encoding="utf-8")
    separator_probe.unlink()
    print(f"audio_separator_model_cache_writable={separator_cache}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
