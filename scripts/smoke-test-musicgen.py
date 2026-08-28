#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import platform
import sys
from dataclasses import asdict
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY_ROOT))

from genost_worker.audiocraft_generator import generate_with_metadata
from genost_worker.persistence import now_iso, write_json_atomic


DEFAULT_PROMPT = "90s rock song with loud guitars, bright cymbals and heavy drums, instrumental, no vocals"
DEFAULT_DIAGNOSTICS = REPOSITORY_ROOT / "GENOST_PROJECTS" / "diagnostics"


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a short no-project MusicGen validation render.")
    parser.add_argument("--backend", choices=("auto", "mlx", "audiocraft"), default="auto")
    parser.add_argument("--model", default="facebook/musicgen-small")
    parser.add_argument("--device", default=None)
    parser.add_argument("--duration", type=int, default=8)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--prompt", default=DEFAULT_PROMPT)
    parser.add_argument("--output", type=Path, default=DEFAULT_DIAGNOSTICS / "musicgen-smoke.wav")
    parser.add_argument("--report", type=Path, default=DEFAULT_DIAGNOSTICS / "musicgen-smoke.json")
    args = parser.parse_args()

    report = {
        "schemaVersion": 1,
        "startedAt": now_iso(),
        "platform": {"system": platform.system(), "machine": platform.machine(), "python": platform.python_version()},
        "request": {
            "backend": args.backend,
            "model": args.model,
            "device": args.device,
            "durationSeconds": args.duration,
            "seed": args.seed,
            "prompt": args.prompt,
            "hfHome": os.environ.get("HF_HOME"),
        },
    }
    try:
        result = generate_with_metadata(
            kind="text",
            prompt=args.prompt,
            duration_seconds=args.duration,
            output_path=str(args.output),
            model_name=args.model,
            seed=args.seed,
            preferred_device=args.device,
            validation_profile="music",
            backend=args.backend,
        )
    except Exception as exc:
        report.update({"completedAt": now_iso(), "status": "failed", "error": str(exc)})
        write_json_atomic(args.report, report)
        print(json.dumps(report, indent=2))
        return 1

    report.update(
        {
            "completedAt": now_iso(),
            "status": "passed",
            "result": {
                "outputPath": result.output_path,
                "backend": result.backend,
                "device": result.device,
                "model": result.model,
                "generationSeconds": result.generation_seconds,
                "metrics": asdict(result.metrics),
            },
        }
    )
    write_json_atomic(args.report, report)
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
