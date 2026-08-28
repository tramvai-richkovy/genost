from __future__ import annotations

import importlib.util
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from genost_worker.midi import audio_to_drum_midi, generate_text_midi, midi_to_clean_guide_wav


class MidiWorkflowTests(unittest.TestCase):
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
