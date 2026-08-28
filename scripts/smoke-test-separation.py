#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from genost_worker.separation import SEPARATION_LABELS, separate_stem


def write_fixture_mix(path: Path, duration_seconds: float) -> None:
    sample_rate = 32_000
    time = np.arange(round(sample_rate * duration_seconds), dtype=np.float32) / sample_rate
    left = (
        0.22 * np.sin(2 * np.pi * 55 * time)
        + 0.14 * np.sin(2 * np.pi * 220 * time)
        + 0.10 * np.sin(2 * np.pi * 880 * time)
    )
    right = (
        0.22 * np.sin(2 * np.pi * 82.41 * time)
        + 0.14 * np.sin(2 * np.pi * 329.63 * time)
        + 0.10 * np.sin(2 * np.pi * 1320 * time)
    )
    sf.write(path, np.column_stack([left, right]), sample_rate, subtype="PCM_24")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run an optional local htdemucs six-output separator smoke test.")
    parser.add_argument("--duration", type=float, default=3.0, help="Fixture duration in seconds (default: 3).")
    parser.add_argument("--model-cache-path", help="Writable audio-separator model cache containing htdemucs_6s.yaml.")
    parser.add_argument("--output-directory", help="Keep the raw fixture and published bundle in this directory.")
    args = parser.parse_args()
    if not 0.5 <= args.duration <= 30:
        parser.error("--duration must be from 0.5 through 30 seconds")

    temporary: tempfile.TemporaryDirectory[str] | None = None
    if args.output_directory:
        root = Path(args.output_directory).expanduser().resolve()
        root.mkdir(parents=True, exist_ok=True)
    else:
        temporary = tempfile.TemporaryDirectory(prefix="genost-separation-smoke-")
        root = Path(temporary.name)

    try:
        source = root / "fixture-mix.wav"
        bundle = root / "six-stem-bundle"
        write_fixture_mix(source, args.duration)
        result = separate_stem(source, bundle, model_cache_path=args.model_cache_path)
        labels = [output.label for output in result.outputs]
        if labels != list(SEPARATION_LABELS):
            raise RuntimeError(f"Unexpected separator labels: {labels}")
        if not source.is_file() or any(not (bundle / f"{label}.wav").is_file() for label in SEPARATION_LABELS):
            raise RuntimeError("The raw fixture or one of the six retained outputs is missing.")
        print(json.dumps(result.to_dict(), indent=2))
        print(f"separation smoke passed: raw + {len(result.outputs)} outputs retained")
        return 0
    finally:
        if temporary is not None:
            temporary.cleanup()


if __name__ == "__main__":
    raise SystemExit(main())
