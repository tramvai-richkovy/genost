from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from genost_worker.model_preflight import check_model_preflight


class ModelPreflightTests(unittest.TestCase):
    def write_hf_model_marker(self, root: Path, repo_id: str) -> None:
        namespace, repo = repo_id.split("/", 1)
        snapshot = root / "hub" / f"models--{namespace}--{repo}" / "snapshots" / "abc123"
        snapshot.mkdir(parents=True)
        (snapshot / "state_dict.bin").write_bytes(b"language model")
        (snapshot / "compression_state_dict.bin").write_bytes(b"codec")

    def test_incomplete_hugging_face_download_is_not_reported_as_available(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache = root / "models--facebook--musicgen-medium"
            (cache / "blobs").mkdir(parents=True)
            (cache / "refs").mkdir()
            (cache / "refs" / "main").write_text("abc123\n", encoding="utf-8")
            (cache / "blobs" / "model.incomplete").write_bytes(b"partial")

            with patch("genost_worker.model_preflight._module_installed", return_value=False):
                preflight = check_model_preflight(model_cache_path=str(root), backend="mlx")

        self.assertFalse(preflight.models["facebook/musicgen-medium"].available)

    def test_preflight_requires_both_musicgen_models(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_hf_model_marker(root, "facebook/musicgen-medium")

            with (
                patch("genost_worker.model_preflight.get_backend", return_value="audiocraft"),
                patch("genost_worker.model_preflight.get_device", return_value="cpu"),
                patch("genost_worker.model_preflight._module_installed", return_value=True),
                patch("genost_worker.model_preflight._ffmpeg_available", return_value=True),
            ):
                preflight = check_model_preflight(model_cache_path=str(root))

        self.assertFalse(preflight.ok)
        self.assertTrue(preflight.models["facebook/musicgen-medium"].available)
        self.assertFalse(preflight.models["facebook/musicgen-melody"].available)
        self.assertIn("facebook/musicgen-melody was not found", "\n".join(preflight.errors))

    def test_preflight_passes_when_models_and_dependencies_are_available(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_hf_model_marker(root, "facebook/musicgen-medium")
            self.write_hf_model_marker(root, "facebook/musicgen-melody")

            with (
                patch("genost_worker.model_preflight.get_backend", return_value="audiocraft"),
                patch("genost_worker.model_preflight.get_device", return_value="cpu"),
                patch("genost_worker.model_preflight._module_installed", return_value=True),
                patch("genost_worker.model_preflight._ffmpeg_available", return_value=True),
            ):
                preflight = check_model_preflight(model_cache_path=str(root))

        self.assertTrue(preflight.ok)
        self.assertEqual(preflight.backend, "audiocraft")
        self.assertEqual(preflight.device, "cpu")
        self.assertEqual(preflight.errors, [])

    def test_mlx_preflight_does_not_require_audiocraft_or_torch(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_hf_model_marker(root, "facebook/musicgen-medium")
            self.write_hf_model_marker(root, "facebook/musicgen-melody")

            installed = {
                "soundfile": True,
                "mlx_audiocraft": True,
                "torch": False,
                "torchaudio": False,
                "audiocraft": False,
                "huggingface_hub": False,
            }
            with (
                patch("genost_worker.model_preflight.get_backend", return_value="mlx"),
                patch(
                    "genost_worker.model_preflight._module_installed",
                    side_effect=lambda name: installed.get(name, False),
                ),
                patch("genost_worker.model_preflight._ffmpeg_available", return_value=True),
            ):
                preflight = check_model_preflight(model_cache_path=str(root))

        self.assertTrue(preflight.ok)
        self.assertEqual(preflight.backend, "mlx")
        self.assertEqual(preflight.device, "metal")
        self.assertEqual(preflight.errors, [])


if __name__ == "__main__":
    unittest.main()
