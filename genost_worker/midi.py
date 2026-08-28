from __future__ import annotations

import os
import shlex
import shutil
import subprocess
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Literal, Sequence

Runner = Callable[..., subprocess.CompletedProcess]
AudioToMidiMode = Literal["melodic", "drum"]


class MidiWorkflowError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class MidiGenerationOutput:
    file_name: str
    file_path: str


@dataclass(frozen=True)
class MidiGuideResult:
    file_name: str
    file_path: str
    sample_rate: int
    duration_seconds: float


def midi_to_clean_guide_wav(
    midi_input: str | Path | object,
    output_wav_path: str | Path,
    sample_rate: int = 32000,
) -> MidiGuideResult:
    try:
        import numpy as np
        import pretty_midi
        from scipy.io import wavfile
    except Exception as exc:  # pragma: no cover - depends on optional local setup
        raise MidiWorkflowError("midi_guide_dependency_missing", f"MIDI guide dependencies are unavailable: {exc}") from exc

    try:
        if isinstance(midi_input, (str, Path)):
            pm = pretty_midi.PrettyMIDI(str(midi_input))
        else:
            pm = midi_input

        end_time = float(pm.get_end_time())
        total_samples = max(1, int(np.ceil(end_time * sample_rate)))
        audio_buffer = np.zeros(total_samples, dtype=np.float32)

        for instrument in pm.instruments:
            if instrument.is_drum:
                continue

            for note in instrument.notes:
                start_sample = int(note.start * sample_rate)
                end_sample = int(note.end * sample_rate)
                note_samples = end_sample - start_sample
                if note_samples <= 0 or start_sample >= total_samples:
                    continue

                frequency = 440.0 * (2.0 ** ((note.pitch - 69) / 12.0))
                time = np.arange(note_samples) / sample_rate
                sine = np.sin(2.0 * np.pi * frequency * time)
                fade_in_len = min(int(0.010 * sample_rate), note_samples // 2)
                fade_out_len = min(int(0.020 * sample_rate), note_samples // 2)
                envelope = np.ones(note_samples, dtype=np.float32)
                if fade_in_len > 0:
                    envelope[:fade_in_len] = np.linspace(0.0, 1.0, fade_in_len)
                if fade_out_len > 0:
                    envelope[-fade_out_len:] = np.linspace(1.0, 0.0, fade_out_len)

                velocity_scale = (note.velocity / 127.0) * 0.5
                rendered_note = sine * envelope * velocity_scale
                actual_end = min(start_sample + note_samples, total_samples)
                slice_len = actual_end - start_sample
                audio_buffer[start_sample:actual_end] += rendered_note[:slice_len]

        max_value = float(np.max(np.abs(audio_buffer)))
        if max_value > 1.0:
            audio_buffer /= max_value

        output_file = Path(output_wav_path).expanduser().resolve()
        output_file.parent.mkdir(parents=True, exist_ok=True)
        if output_file.exists():
            raise MidiWorkflowError("midi_guide_publication_conflict", f"Guide WAV already exists: {output_file}")
        temporary = output_file.with_name(f".{output_file.stem}.{uuid.uuid4().hex}.tmp{output_file.suffix}")
        wavfile.write(str(temporary), sample_rate, (audio_buffer * 32767).astype(np.int16))
        temporary.replace(output_file)
        return MidiGuideResult(output_file.name, str(output_file), sample_rate, total_samples / sample_rate)
    except MidiWorkflowError:
        raise
    except Exception as exc:
        raise MidiWorkflowError("midi_guide_failed", f"Could not render MIDI guide WAV: {exc}") from exc


def _run_command(command: Sequence[str], *, runner: Runner, cwd: Path | None = None) -> None:
    try:
        runner(list(command), check=True, capture_output=True, text=True, cwd=str(cwd) if cwd else None)
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or str(exc)).strip()
        raise MidiWorkflowError("midi_generation_failed", f"Text2MIDI command failed: {detail}") from exc


def _text2midi_command(prompt: str, destination: Path, repo_path: Path | None, python_executable: str | None) -> tuple[list[str], Path | None, Path]:
    template = os.environ.get("GENOST_TEXT2MIDI_COMMAND")
    if template:
        command = [
            part.replace("{prompt}", prompt).replace("{output}", str(destination))
            for part in shlex.split(template)
        ]
        return command, None, destination

    repo = repo_path or (Path(os.environ["GENOST_TEXT2MIDI_REPO"]).expanduser() if os.environ.get("GENOST_TEXT2MIDI_REPO") else None)
    if repo is None:
        raise MidiWorkflowError(
            "text2midi_setup_missing",
            "Set GENOST_TEXT2MIDI_REPO to a local AMAAI-Lab/Text2midi checkout or GENOST_TEXT2MIDI_COMMAND with {prompt} and {output}.",
        )
    repo = repo.expanduser().resolve()
    script = repo / "model" / "transformer_model.py"
    if not script.is_file():
        raise MidiWorkflowError("text2midi_setup_missing", f"Text2MIDI script is missing: {script}")
    python = python_executable or shutil.which("python3") or shutil.which("python")
    if not python:
        raise MidiWorkflowError("text2midi_python_missing", "No Python executable is available for Text2MIDI.")
    return [python, str(script), "--caption", prompt], repo, repo / "output.mid"


def generate_text_midi(
    *,
    prompt: str,
    output_directory: str | Path,
    quantity: int,
    model_repo_path: str | Path | None = None,
    python_executable: str | None = None,
    runner: Runner = subprocess.run,
) -> list[MidiGenerationOutput]:
    if not prompt.strip():
        raise MidiWorkflowError("text2midi_prompt_empty", "MIDI generation prompt is required.")
    if quantity < 1 or quantity > 16:
        raise MidiWorkflowError("text2midi_quantity_invalid", "MIDI quantity must be between 1 and 16.")

    destination_dir = Path(output_directory).expanduser().resolve()
    destination_dir.mkdir(parents=True, exist_ok=True)
    outputs: list[MidiGenerationOutput] = []
    repo = Path(model_repo_path).expanduser().resolve() if model_repo_path else None

    with tempfile.TemporaryDirectory(prefix="genost-text2midi-") as temp_dir_name:
        temp_dir = Path(temp_dir_name)
        for index in range(quantity):
            destination = destination_dir / f"artifact{index + 1}.mid"
            if destination.exists():
                destination = destination_dir / f"artifact{index + 1}_{uuid.uuid4().hex[:8]}.mid"
            command, cwd, produced = _text2midi_command(prompt, destination, repo, python_executable)
            _run_command(command, runner=runner, cwd=cwd)

            if produced == destination:
                if not destination.is_file():
                    raise MidiWorkflowError("text2midi_output_missing", f"Text2MIDI did not write {destination}")
            else:
                if not produced.is_file():
                    alternate = temp_dir / "output.mid"
                    if alternate.is_file():
                        produced = alternate
                    else:
                        raise MidiWorkflowError("text2midi_output_missing", f"Text2MIDI did not publish {produced}")
                produced.replace(destination)

            outputs.append(MidiGenerationOutput(destination.name, str(destination)))

    return outputs


def audio_to_melodic_midi(source_audio_path: str | Path, output_midi_path: str | Path) -> MidiGenerationOutput:
    try:
        from basic_pitch.inference import predict_and_save
    except Exception as exc:  # pragma: no cover - depends on optional local setup
        raise MidiWorkflowError("basic_pitch_missing", f"basic-pitch is unavailable: {exc}") from exc

    source = Path(source_audio_path).expanduser().resolve()
    destination = Path(output_midi_path).expanduser().resolve()
    if not source.is_file():
        raise MidiWorkflowError("audio_to_midi_input_missing", f"Source audio is missing: {source}")
    if destination.exists():
        raise MidiWorkflowError("audio_to_midi_publication_conflict", f"MIDI output already exists: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="genost-basic-pitch-") as temp_dir_name:
        temp_dir = Path(temp_dir_name)
        predict_and_save(
            audio_path_list=[str(source)],
            output_directory=str(temp_dir),
            save_midi=True,
            sonify_prediction=False,
            save_model_outputs=False,
            save_npz=False,
        )
        candidates = sorted(temp_dir.glob("*.mid"))
        if not candidates:
            raise MidiWorkflowError("audio_to_midi_output_missing", "basic-pitch did not publish a MIDI file.")
        candidates[0].replace(destination)
    return MidiGenerationOutput(destination.name, str(destination))


def audio_to_drum_midi(
    source_audio_path: str | Path,
    output_midi_path: str | Path,
    *,
    runner: Runner = subprocess.run,
) -> MidiGenerationOutput:
    source = Path(source_audio_path).expanduser().resolve()
    destination = Path(output_midi_path).expanduser().resolve()
    if not source.is_file():
        raise MidiWorkflowError("audio_to_midi_input_missing", f"Source audio is missing: {source}")
    if destination.exists():
        raise MidiWorkflowError("audio_to_midi_publication_conflict", f"MIDI output already exists: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    command = ["omnizart", "drum", "transcribe", str(source), "-o", str(destination)]
    try:
        runner(command, check=True, capture_output=True, text=True)
    except FileNotFoundError as exc:
        raise MidiWorkflowError("omnizart_missing", "omnizart CLI is unavailable.") from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or str(exc)).strip()
        raise MidiWorkflowError("audio_to_drum_midi_failed", f"omnizart drum transcription failed: {detail}") from exc
    if not destination.is_file():
        raise MidiWorkflowError("audio_to_midi_output_missing", f"omnizart did not publish {destination}")
    return MidiGenerationOutput(destination.name, str(destination))


def audio_to_midi(
    source_audio_path: str | Path,
    output_midi_path: str | Path,
    *,
    mode: AudioToMidiMode,
    runner: Runner = subprocess.run,
) -> MidiGenerationOutput:
    if mode == "melodic":
        return audio_to_melodic_midi(source_audio_path, output_midi_path)
    return audio_to_drum_midi(source_audio_path, output_midi_path, runner=runner)
