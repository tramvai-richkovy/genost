from __future__ import annotations

import math
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import soundfile as sf

try:
    import torch
except ImportError:  # Optional AudioCraft CPU diagnostic dependency.
    torch = None

from genost_worker.audiocraft_generator import (
    AudioMetrics,
    GeneratorError,
    analyze_audio_file,
    generate_fixture_tone,
    get_backend,
    get_device,
    save_audio,
    validate_generated_audio,
)


class DeviceSelectionTests(unittest.TestCase):
    @unittest.skipUnless(torch is not None, "PyTorch is only required by the optional AudioCraft diagnostic backend")
    def test_auto_uses_cpu_when_cuda_is_unavailable(self) -> None:
        with patch.dict(os.environ, {}, clear=False), patch("torch.cuda.is_available", return_value=False):
            os.environ.pop("GENOST_AUDIOCRAFT_DEVICE", None)
            self.assertEqual(get_device(), "cpu")

    @unittest.skipUnless(torch is not None, "PyTorch is only required by the optional AudioCraft diagnostic backend")
    def test_explicit_mps_is_rejected(self) -> None:
        with self.assertRaisesRegex(GeneratorError, "silently produce invalid audio"):
            get_device("mps")

    @unittest.skipUnless(torch is not None, "PyTorch is only required by the optional AudioCraft diagnostic backend")
    def test_unavailable_cuda_is_rejected(self) -> None:
        with patch("torch.cuda.is_available", return_value=False):
            with self.assertRaisesRegex(GeneratorError, "unavailable"):
                get_device("cuda")

    def test_unknown_backend_is_rejected(self) -> None:
        with self.assertRaisesRegex(GeneratorError, "Unsupported generation backend"):
            get_backend("cloud")


class AudioValidationTests(unittest.TestCase):
    @staticmethod
    def metrics(**overrides: float) -> AudioMetrics:
        values = {
            "duration_seconds": 24.0,
            "sample_rate": 32000,
            "channels": 2,
            "peak": 0.8,
            "rms_db": -18.0,
            "dc_offset": 0.0,
            "energy_below_500_hz": 0.95,
            "energy_above_2000_hz": 0.001,
            "rolloff_85_hz": 180.0,
            "spectral_centroid_hz": 106.0,
            "spectral_flatness": 0.001,
            "zero_crossings_per_second": 572.0,
        }
        values.update(overrides)
        return AudioMetrics(**values)

    def test_dark_atmosphere_metrics_pass_bass_drone_but_not_generic(self) -> None:
        metrics = self.metrics()
        with patch("genost_worker.audiocraft_generator.analyze_audio_file", return_value=metrics):
            validate_generated_audio("candidate.wav", 24, "music", "bass_drone")
            with self.assertRaisesRegex(GeneratorError, "music/generic validation"):
                validate_generated_audio("candidate.wav", 24, "music", "generic")

    def test_bass_drone_still_rejects_pure_low_frequency_collapse(self) -> None:
        metrics = self.metrics(
            energy_above_2000_hz=0.0,
            spectral_centroid_hz=60.0,
            spectral_flatness=0.0,
            zero_crossings_per_second=120.0,
        )
        with patch("genost_worker.audiocraft_generator.analyze_audio_file", return_value=metrics):
            with self.assertRaisesRegex(GeneratorError, "music/bass_drone validation"):
                validate_generated_audio("rumble.wav", 24, "music", "bass_drone")

    def test_tonal_pad_flatness_passes_bass_drone(self) -> None:
        metrics = self.metrics(
            energy_above_2000_hz=0.01,
            spectral_centroid_hz=180.0,
            spectral_flatness=0.000006,
            zero_crossings_per_second=500.0,
        )
        with patch("genost_worker.audiocraft_generator.analyze_audio_file", return_value=metrics):
            validate_generated_audio("tonal-pad.wav", 24, "music", "bass_drone")

    def test_rhythm_and_melody_use_distinct_thresholds(self) -> None:
        melody_metrics = self.metrics(
            energy_above_2000_hz=0.0016,
            spectral_centroid_hz=105.0,
            zero_crossings_per_second=220.0,
        )
        with patch("genost_worker.audiocraft_generator.analyze_audio_file", return_value=melody_metrics):
            validate_generated_audio("melody.wav", 24, "music", "melody")
            with self.assertRaisesRegex(GeneratorError, "music/rhythm validation"):
                validate_generated_audio("melody.wav", 24, "music", "rhythm")

    def test_dark_organic_percussion_metrics_pass_rhythm(self) -> None:
        metrics = self.metrics(
            energy_above_2000_hz=0.002,
            spectral_centroid_hz=113.0,
            zero_crossings_per_second=342.0,
        )
        with patch("genost_worker.audiocraft_generator.analyze_audio_file", return_value=metrics):
            validate_generated_audio("organic-percussion.wav", 24, "music", "rhythm")

    def test_rhythm_still_rejects_pure_low_frequency_collapse(self) -> None:
        metrics = self.metrics(
            energy_above_2000_hz=0.0,
            spectral_centroid_hz=60.0,
            spectral_flatness=0.0,
            zero_crossings_per_second=120.0,
        )
        with patch("genost_worker.audiocraft_generator.analyze_audio_file", return_value=metrics):
            with self.assertRaisesRegex(GeneratorError, "music/rhythm validation"):
                validate_generated_audio("rumble.wav", 24, "music", "rhythm")

    def test_fixture_tone_passes_basic_validation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fixture.wav"
            generate_fixture_tone(str(path), 1)

            metrics = validate_generated_audio(path, 1, "basic")

            self.assertEqual(metrics.sample_rate, 32000)
            self.assertEqual(metrics.channels, 2)
            self.assertGreater(metrics.rms_db, -55)

    def test_full_mix_profile_rejects_rumbling_audio(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "rumble.wav"
            sample_rate = 32000
            samples = np.arange(sample_rate * 2, dtype=np.float32) / sample_rate
            rumble = 0.2 * np.sin(2 * math.pi * 60 * samples)
            sf.write(path, rumble, sample_rate)

            with self.assertRaisesRegex(GeneratorError, "insufficient energy above 2 kHz"):
                validate_generated_audio(path, 2, "full_mix")

    def test_music_profile_accepts_broadband_audio(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "broadband.wav"
            sample_rate = 32000
            audio = np.random.default_rng(7).normal(0, 0.08, sample_rate * 2).astype(np.float32)
            sf.write(path, audio, sample_rate)

            metrics = validate_generated_audio(path, 2, "music")

            self.assertGreater(metrics.spectral_centroid_hz, 250)
            self.assertGreater(metrics.zero_crossings_per_second, 750)

    def test_save_audio_validates_before_atomic_publish(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "generated.wav"
            sample_rate = 32000
            samples = np.arange(sample_rate, dtype=np.float32) / sample_rate
            audio = 0.2 * np.sin(2 * math.pi * 440 * samples)

            result = save_audio(audio[np.newaxis, :], str(path), sample_rate, expected_duration_seconds=1)

            self.assertEqual(result, str(path))
            self.assertTrue(path.exists())
            self.assertAlmostEqual(analyze_audio_file(path).duration_seconds, 1.0, places=3)
            self.assertEqual(list(path.parent.glob("*.tmp.wav")), [])

    def test_save_audio_never_overwrites_an_existing_stem(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "generated.wav"
            path.write_bytes(b"existing")

            with self.assertRaisesRegex(GeneratorError, "Refusing to overwrite"):
                save_audio(np.zeros((1, 32000), dtype=np.float32), str(path), 32000)

            self.assertEqual(path.read_bytes(), b"existing")

    def test_save_audio_peak_normalizes_before_publication(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "normalized.wav"
            sample_rate = 32000
            samples = np.arange(sample_rate, dtype=np.float32) / sample_rate
            audio = 3.0 * np.sin(2 * math.pi * 440 * samples)

            save_audio(audio[np.newaxis, :], str(path), sample_rate, expected_duration_seconds=1)

            self.assertLessEqual(analyze_audio_file(path).peak, 0.981)


if __name__ == "__main__":
    unittest.main()
