from __future__ import annotations

import importlib.util
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from genost_worker.midi import (
    MidiGenerationOutput,
    audio_to_drum_midi,
    audio_to_melodic_midi,
    generate_text_midi,
    midi_to_clean_guide_wav,
)


class MidiWorkflowTests(unittest.TestCase):
    def test_text2midi_uses_one_cached_service_batch(self) -> None:
        class Adapter:
            def __init__(self):
                self.calls = 0

            def generate_batch(self, prompt, destinations):
                self.calls += 1
                return [
                    MidiGenerationOutput(path.name, str(path), 100 + index)
                    for index, path in enumerate(destinations)
                ]

        adapter = Adapter()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / "text2midi"
            repo.mkdir()
            with (
                patch.dict(os.environ, {"GENOST_TEXT2MIDI_REPO": str(repo)}, clear=False),
                patch("genost_worker.midi._cached_text2midi_process", return_value=adapter),
            ):
                outputs = generate_text_midi(
                    prompt="cached batch",
                    output_directory=root / "outputs",
                    quantity=3,
                    python_executable="/usr/bin/python3",
                )

        self.assertEqual(adapter.calls, 1)
        self.assertEqual([output.seed for output in outputs], [100, 101, 102])

    def test_text2midi_command_template_publishes_requested_quantity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output_directory = Path(directory)
            calls: list[list[str]] = []

            def runner(command, **_kwargs):
                calls.append(command)
                Path(command[-1]).write_bytes(b"MThd")

            with patch.dict(os.environ, {"GENOST_TEXT2MIDI_COMMAND": 'text2midi --caption "{prompt}" --output {output}'}):
                outputs = generate_text_midi(prompt="dark jungle bass", output_directory=output_directory, quantity=2, runner=runner)

        self.assertEqual([output.file_name for output in outputs], ["artifact1.mid", "artifact2.mid"])
        self.assertEqual(len(calls), 2)
        self.assertIn("dark jungle bass", calls[0])

    def test_drum_audio_to_midi_uses_omnizart_publication_path(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "drums.wav"
            destination = Path(directory) / "drums.mid"
            source.write_bytes(b"wav")

            def runner(command, **_kwargs):
                self.assertEqual(command[:3], ["omnizart", "drum", "transcribe"])
                Path(command[-1]).write_bytes(b"MThd")

            output = audio_to_drum_midi(source, destination, runner=runner)

        self.assertEqual(output.file_name, "drums.mid")
        self.assertEqual(output.file_path, str(destination.resolve()))

    def test_melodic_audio_to_midi_publishes_through_isolated_basic_pitch(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "melody.wav"
            destination = Path(directory) / "melody.mid"
            source.write_bytes(b"wav")

            def isolated(source_path, destination_path, *, timeout_seconds):
                self.assertEqual(source_path, source.resolve())
                self.assertEqual(timeout_seconds, 600)
                destination_path.write_bytes(b"MThd")

            with patch("genost_worker.midi._run_basic_pitch_isolated", side_effect=isolated):
                output = audio_to_melodic_midi(source, destination)

        self.assertEqual(output.file_name, "melody.mid")
        self.assertEqual(output.file_path, str(destination.resolve()))

    def test_midi_to_clean_guide_wav_renders_pcm_when_dependencies_exist(self) -> None:
        if not importlib.util.find_spec("pretty_midi"):
            raise unittest.SkipTest("pretty_midi is not installed")

        import pretty_midi

        with tempfile.TemporaryDirectory() as directory:
            instrument = pretty_midi.Instrument(program=0)
            instrument.notes.append(pretty_midi.Note(velocity=100, pitch=69, start=0.0, end=0.25))
            midi = pretty_midi.PrettyMIDI()
            midi.instruments.append(instrument)
            destination = Path(directory) / "guide.wav"

            result = midi_to_clean_guide_wav(midi, destination, sample_rate=8000)

            self.assertEqual(result.file_name, "guide.wav")
            self.assertEqual(result.sample_rate, 8000)
            self.assertGreater(result.duration_seconds, 0.2)
            self.assertTrue(destination.exists())


if __name__ == "__main__":
    unittest.main()
