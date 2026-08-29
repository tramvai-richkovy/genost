from __future__ import annotations

import argparse
import json
import os
import signal
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from genost_worker.cli import (
    AcceptanceInterrupted,
    normalize_markdown_prompt,
    reconcile_interrupted_batches,
    run_acceptance,
)
from genost_worker.audiocraft_generator import AudioMetrics


class AcceptanceCliTests(unittest.TestCase):
    def test_prompt_normalization_only_collapses_whitespace(self) -> None:
        self.assertEqual(normalize_markdown_prompt("one\n  two\tthree"), "one two three")

    def test_acceptance_writes_five_distinct_non_destructive_variations(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            prompt = root / "prompt.md"
            prompt.write_text("dark\n  ambient", encoding="utf-8")
            generation_requests = []

            def generate(**kwargs):
                generation_requests.append(kwargs)
                Path(kwargs["output_path"]).write_bytes(b"RIFF")
                return SimpleNamespace(
                    model="facebook/musicgen-medium",
                    backend="mlx",
                    device="metal",
                    generation_seconds=0.25,
                    metrics=AudioMetrics(
                        duration_seconds=1.0,
                        sample_rate=32000,
                        channels=2,
                        peak=0.5,
                        rms_db=-12.0,
                        dc_offset=0.0,
                        energy_below_500_hz=0.2,
                        energy_above_2000_hz=0.3,
                        rolloff_85_hz=5000.0,
                        spectral_centroid_hz=2000.0,
                        spectral_flatness=0.1,
                        zero_crossings_per_second=1000.0,
                    ),
                )

            args = argparse.Namespace(
                prompt_file=str(prompt),
                output_dir=str(root / "output"),
                duration=1,
                quantity=5,
                model_cache_path=str(root / "models"),
                hf_home=None,
                backend="mlx",
                seed_base=900,
            )
            with (
                patch("genost_worker.cli._acceptance_preflight", return_value={}),
                patch("genost_worker.cli.generate_with_metadata", side_effect=generate),
            ):
                first = run_acceptance(args)
                second = run_acceptance(args)

            self.assertNotEqual(first, second)
            manifest = json.loads((first / "batch-manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["status"], "ready")
            self.assertEqual(manifest["validationProfile"], "basic")
            self.assertEqual([item["seed"] for item in manifest["variations"]], [900, 901, 902, 903, 904])
            self.assertTrue(
                all(request["validation_profile"] == "basic" for request in generation_requests)
            )
            self.assertEqual(len(list(first.glob("variation-*.wav"))), 5)
            self.assertEqual(len(list(first.glob("variation-*.json"))), 5)

    def test_acceptance_finalizes_manifest_when_generation_is_interrupted(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            prompt = root / "prompt.md"
            prompt.write_text("dark ambient", encoding="utf-8")
            args = argparse.Namespace(
                prompt_file=str(prompt),
                output_dir=str(root / "output"),
                duration=1,
                quantity=5,
                model_cache_path=str(root / "models"),
                hf_home=None,
                backend="mlx",
                seed_base=900,
            )

            def interrupt_generation(**_kwargs) -> None:
                os.kill(os.getpid(), signal.SIGTERM)

            with (
                patch("genost_worker.cli._acceptance_preflight", return_value={}),
                patch(
                    "genost_worker.cli.generate_with_metadata",
                    side_effect=interrupt_generation,
                ),
            ):
                with self.assertRaises(AcceptanceInterrupted):
                    run_acceptance(args)

            batch = next((root / "output").iterdir())
            manifest = json.loads((batch / "batch-manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["status"], "interrupted")
            self.assertEqual(manifest["activeVariation"], 1)
            self.assertEqual(manifest["interruption"]["reason"], "signal")
            self.assertEqual(manifest["interruption"]["signal"], "SIGTERM")
            self.assertFalse((batch / "failure.json").exists())

    def test_reconciles_dead_and_legacy_manifests_but_leaves_active_processes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            dead = root / "dead" / "batch-manifest.json"
            active = root / "active" / "batch-manifest.json"
            legacy = root / "legacy" / "batch-manifest.json"
            for path, process_id in ((dead, 999_999_999), (active, os.getpid()), (legacy, None)):
                path.parent.mkdir(parents=True)
                value = {"schemaVersion": 1, "status": "running", "variations": []}
                if process_id is not None:
                    value["processId"] = process_id
                path.write_text(json.dumps(value), encoding="utf-8")
            old = time.time() - 600
            os.utime(legacy, (old, old))

            reconciled = reconcile_interrupted_batches(root)

            self.assertEqual(set(reconciled), {dead, legacy})
            dead_value = json.loads(dead.read_text(encoding="utf-8"))
            legacy_value = json.loads(legacy.read_text(encoding="utf-8"))
            active_value = json.loads(active.read_text(encoding="utf-8"))
            self.assertEqual(dead_value["interruption"]["reason"], "process-not-running")
            self.assertEqual(legacy_value["interruption"]["reason"], "missing-process-identity")
            self.assertEqual(active_value["status"], "running")


if __name__ == "__main__":
    unittest.main()
