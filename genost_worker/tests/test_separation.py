from __future__ import annotations

import subprocess
import struct
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

from genost_worker.separation import SEPARATION_LABELS, SeparationError, inspect_wav, merge_separated_outputs, separate_stem


def write_fixture_wav(path: Path, frames: int = 800) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(8000)
        audio.writeframes((1000).to_bytes(2, "little", signed=True) * frames)


def write_extensible_float_wav(path: Path, frames: int = 800) -> None:
    channels = 2
    sample_rate = 8000
    bits_per_sample = 32
    block_align = channels * bits_per_sample // 8
    samples = struct.pack("<ff", 0.25, -0.5) * frames
    ieee_float_guid = bytes.fromhex("0300000000001000800000aa00389b71")
    format_chunk = struct.pack(
        "<HHIIHHHHI16s",
        0xFFFE,
        channels,
        sample_rate,
        sample_rate * block_align,
        block_align,
        bits_per_sample,
        22,
        bits_per_sample,
        3,
        ieee_float_guid,
    )
    riff_size = 4 + 8 + len(format_chunk) + 8 + len(samples)
    path.write_bytes(
        b"RIFF"
        + struct.pack("<I", riff_size)
        + b"WAVEfmt "
        + struct.pack("<I", len(format_chunk))
        + format_chunk
        + b"data"
        + struct.pack("<I", len(samples))
        + samples
    )


class SeparationTests(unittest.TestCase):
    def test_inspect_wav_accepts_extensible_float_output(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "bass.wav"
            write_extensible_float_wav(output)

            duration, peak = inspect_wav(output)

            self.assertAlmostEqual(duration, 0.1)
            self.assertAlmostEqual(peak, 0.5)

    def test_complete_bundle_is_retained_and_published_atomically(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw = root / "raw.wav"
            bundle = root / "bundle"
            cache = root / "cache"
            write_fixture_wav(raw)

            def fake_runner(command: list[str], **_kwargs: object) -> None:
                output_dir = Path(command[command.index("--output_dir") + 1])
                for label in SEPARATION_LABELS:
                    write_extensible_float_wav(output_dir / f"raw_({label.title()}).wav")

            with patch("genost_worker.separation._separator_binary", return_value=Path("/usr/bin/true")):
                result = separate_stem(raw, bundle, model_cache_path=str(cache), runner=fake_runner)

            self.assertEqual([output.label for output in result.outputs], list(SEPARATION_LABELS))
            self.assertTrue(raw.exists())
            self.assertEqual({path.name for path in bundle.glob("*.wav")}, {f"{label}.wav" for label in SEPARATION_LABELS})
            self.assertFalse(any(path.name.endswith(".tmp") for path in root.iterdir()))

    def test_source_name_cannot_override_explicit_output_label(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw = root / "bass_toms.wav"
            bundle = root / "bundle"
            write_fixture_wav(raw)

            def fake_runner(command: list[str], **_kwargs: object) -> None:
                output_dir = Path(command[command.index("--output_dir") + 1])
                for label in SEPARATION_LABELS:
                    write_extensible_float_wav(output_dir / f"bass_toms_({label.title()})_htdemucs_6s.wav")

            with patch("genost_worker.separation._separator_binary", return_value=Path("/usr/bin/true")):
                result = separate_stem(raw, bundle, model_cache_path=str(root / "cache"), runner=fake_runner)

            self.assertEqual([output.label for output in result.outputs], list(SEPARATION_LABELS))
            self.assertEqual({path.name for path in bundle.glob("*.wav")}, {f"{label}.wav" for label in SEPARATION_LABELS})

    def test_incomplete_bundle_leaves_no_partial_publication(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw = root / "raw.wav"
            bundle = root / "bundle"
            write_fixture_wav(raw)

            def fake_runner(command: list[str], **_kwargs: object) -> None:
                output_dir = Path(command[command.index("--output_dir") + 1])
                write_fixture_wav(output_dir / "raw_(Bass).wav")

            with (
                patch("genost_worker.separation._separator_binary", return_value=Path("/usr/bin/true")),
                self.assertRaisesRegex(SeparationError, "missing"),
            ):
                separate_stem(raw, bundle, model_cache_path=str(root / "cache"), runner=fake_runner)

            self.assertFalse(bundle.exists())
            self.assertEqual(list(root.glob(".*.tmp")), [])

    def test_arbitrary_subset_merge_preserves_every_source(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bass = root / "bass.wav"
            piano = root / "piano.wav"
            destination = root / "MERGES" / "bass_piano.wav"
            write_fixture_wav(bass)
            write_fixture_wav(piano)

            captured_command: list[str] = []

            def fake_runner(command: list[str], **_kwargs: object) -> None:
                captured_command.extend(command)
                write_fixture_wav(Path(command[-1]))

            result = merge_separated_outputs([bass, piano], destination, input_gains_db=[-6, 3], runner=fake_runner)

            self.assertEqual(result.file_path, str(destination.resolve()))
            self.assertTrue(destination.exists())
            self.assertTrue(bass.exists())
            self.assertTrue(piano.exists())
            filter_graph = captured_command[captured_command.index("-filter_complex") + 1]
            self.assertIn("[0:a]volume=-6.000dB[g0]", filter_graph)
            self.assertIn("[1:a]volume=3.000dB[g1]", filter_graph)

    def test_merge_rejects_missing_or_out_of_range_gain_values(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bass = root / "bass.wav"
            piano = root / "piano.wav"
            write_fixture_wav(bass)
            write_fixture_wav(piano)

            with self.assertRaises(SeparationError) as count_error:
                merge_separated_outputs([bass, piano], root / "count.wav", input_gains_db=[0])
            self.assertEqual(count_error.exception.code, "merge_gain_count_invalid")

            with self.assertRaises(SeparationError) as range_error:
                merge_separated_outputs([bass], root / "range.wav", input_gains_db=[12])
            self.assertEqual(range_error.exception.code, "merge_gain_invalid")

    def test_model_failure_is_structured_and_cleans_temporary_output(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw = root / "raw.wav"
            bundle = root / "bundle"
            write_fixture_wav(raw)

            def fail(_command: list[str], **_kwargs: object) -> None:
                raise subprocess.CalledProcessError(1, "separator", stderr="model failed")

            with (
                patch("genost_worker.separation._separator_binary", return_value=Path("/usr/bin/true")),
                self.assertRaises(SeparationError) as raised,
            ):
                separate_stem(raw, bundle, model_cache_path=str(root / "cache"), runner=fail)

            self.assertEqual(raised.exception.code, "separator_model_failed")
            self.assertFalse(bundle.exists())


if __name__ == "__main__":
    unittest.main()
