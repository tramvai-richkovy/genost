from __future__ import annotations

import argparse
import hashlib
import sys
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from .audiocraft_generator import DEFAULT_TEXT_MODEL, generate_with_metadata
from .model_preflight import check_model_preflight
from .persistence import now_iso, write_json_atomic


def normalize_markdown_prompt(text: str) -> str:
    return " ".join(text.split())


def _batch_directory(output_root: Path) -> Path:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    candidate = output_root / timestamp
    if not candidate.exists():
        return candidate
    return output_root / f"{timestamp}-{uuid4().hex[:8]}"


def _acceptance_preflight(
    *,
    model_cache_path: str | None,
    hf_home: str | None,
    backend: str,
) -> dict:
    result = check_model_preflight(
        model_cache_path=model_cache_path,
        hf_home=hf_home,
        backend=backend,
    )
    medium = result.models[DEFAULT_TEXT_MODEL]
    non_model_errors = [
        error
        for error in result.errors
        if not error.startswith("facebook/musicgen-melody was not found")
    ]
    if not medium.available or non_model_errors:
        messages = [medium.error] if medium.error else []
        messages.extend(non_model_errors)
        raise RuntimeError("Acceptance preflight failed: " + "; ".join(dict.fromkeys(messages)))
    return asdict(result)


def run_acceptance(args: argparse.Namespace) -> Path:
    prompt_file = Path(args.prompt_file).expanduser().resolve()
    if not prompt_file.is_file():
        raise FileNotFoundError(f"Prompt file is missing: {prompt_file}")
    prompt = normalize_markdown_prompt(prompt_file.read_text(encoding="utf-8"))
    if not prompt:
        raise ValueError("Prompt file is empty.")
    if args.quantity < 1 or args.quantity > 16:
        raise ValueError("Quantity must be between 1 and 16.")

    preflight = _acceptance_preflight(
        model_cache_path=args.model_cache_path,
        hf_home=args.hf_home,
        backend=args.backend,
    )
    output_root = Path(args.output_dir).expanduser().resolve()
    batch = _batch_directory(output_root)
    batch.mkdir(parents=True, exist_ok=False)
    prompt_hash = hashlib.sha256(prompt.encode("utf-8")).hexdigest()
    seed_base = args.seed_base if args.seed_base is not None else int(datetime.now(timezone.utc).timestamp() * 1_000_000)
    manifest = {
        "schemaVersion": 1,
        "status": "running",
        "createdAt": now_iso(),
        "promptFile": str(prompt_file),
        "prompt": prompt,
        "promptHash": prompt_hash,
        "model": DEFAULT_TEXT_MODEL,
        "quantity": args.quantity,
        "durationSeconds": args.duration,
        "backendRequested": args.backend,
        "modelCachePath": args.model_cache_path,
        "hfHome": args.hf_home,
        "preflight": preflight,
        "variations": [],
    }
    manifest_path = batch / "batch-manifest.json"
    write_json_atomic(manifest_path, manifest)

    for index in range(args.quantity):
        seed = seed_base + index
        audio_path = batch / f"variation-{index + 1:02d}.wav"
        try:
            result = generate_with_metadata(
                kind="text",
                prompt=prompt,
                duration_seconds=args.duration,
                output_path=str(audio_path),
                model_name=DEFAULT_TEXT_MODEL,
                model_cache_path=args.model_cache_path,
                hf_home=args.hf_home,
                seed=seed,
                backend=args.backend,
                validation_profile="music",
                content_category="generic",
            )
            sidecar = {
                "schemaVersion": 1,
                "artifact": {
                    "index": index + 1,
                    "fileName": audio_path.name,
                    "prompt": prompt,
                    "promptHash": prompt_hash,
                    "model": result.model,
                    "backend": result.backend,
                    "device": result.device,
                    "seed": seed,
                    "durationSeconds": args.duration,
                    "generationSeconds": result.generation_seconds,
                    "validationMetrics": asdict(result.metrics),
                    "createdAt": now_iso(),
                },
            }
            sidecar_path = audio_path.with_suffix(".json")
            write_json_atomic(sidecar_path, sidecar)
            manifest["variations"].append(
                {
                    "index": index + 1,
                    "status": "ready",
                    "audioPath": str(audio_path),
                    "sidecarPath": str(sidecar_path),
                    "seed": seed,
                }
            )
            write_json_atomic(manifest_path, manifest)
        except Exception as exc:
            failure = {
                "schemaVersion": 1,
                "status": "failed",
                "failedIndex": index + 1,
                "seed": seed,
                "errorType": type(exc).__name__,
                "error": str(exc),
                "createdAt": now_iso(),
            }
            write_json_atomic(batch / "failure.json", failure)
            manifest["status"] = "failed"
            manifest["failedAt"] = now_iso()
            manifest["failure"] = failure
            write_json_atomic(manifest_path, manifest)
            raise

    manifest["status"] = "ready"
    manifest["completedAt"] = now_iso()
    write_json_atomic(manifest_path, manifest)
    return batch


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="GENOST headless MusicGen acceptance generation")
    parser.add_argument("--prompt-file", default="test_prompt.md")
    parser.add_argument("--output-dir", default="test-output")
    parser.add_argument("--duration", type=int, default=25)
    parser.add_argument("--quantity", type=int, default=5)
    parser.add_argument("--model-cache-path")
    parser.add_argument("--hf-home")
    parser.add_argument("--backend", choices=["auto", "mlx", "audiocraft"], default="auto")
    parser.add_argument("--seed-base", type=int)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        batch = run_acceptance(args)
    except Exception as exc:
        print(f"GENOST acceptance failed: {exc}", file=sys.stderr)
        return 1
    print(batch)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
