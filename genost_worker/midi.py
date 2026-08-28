from __future__ import annotations

import os
import json
import multiprocessing
import shlex
import shutil
import subprocess
import tempfile
import threading
import time
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
    seed: int | None = None


@dataclass(frozen=True)
class MidiGuideResult:
    file_name: str
    file_path: str
    sample_rate: int
    duration_seconds: float


def _basic_pitch_child(source_audio_path: str, output_directory: str, connection) -> None:
    import contextlib
    import io

    logs = io.StringIO()
    try:
        with contextlib.redirect_stdout(logs), contextlib.redirect_stderr(logs):
            from basic_pitch import ICASSP_2022_MODEL_PATH
            from basic_pitch.inference import predict_and_save

            default_model_path = Path(str(ICASSP_2022_MODEL_PATH))
            onnx_model_path = default_model_path.parent / "nmp.onnx"
            if not onnx_model_path.is_file():
                raise FileNotFoundError(f"Basic Pitch ONNX model is missing: {onnx_model_path}")
            predict_and_save(
                audio_path_list=[source_audio_path],
                output_directory=output_directory,
                save_midi=True,
                sonify_midi=False,
                save_model_outputs=False,
                save_notes=False,
                model_or_model_path=onnx_model_path,
            )
        candidates = sorted(Path(output_directory).glob("*.mid"))
        if not candidates:
            raise FileNotFoundError("Basic Pitch did not publish a MIDI file")
        connection.send({"ok": True, "output": str(candidates[0])})
    except Exception as exc:
        detail = logs.getvalue().strip()
        connection.send({"ok": False, "error": str(exc), "detail": detail[-2000:]})
    finally:
        connection.close()


def _run_basic_pitch_isolated(
    source_audio_path: Path,
    output_midi_path: Path,
    *,
    timeout_seconds: float,
) -> None:
    context = multiprocessing.get_context("spawn")
    receiver, sender = context.Pipe(duplex=False)
    with tempfile.TemporaryDirectory(prefix="genost-basic-pitch-") as temp_dir_name:
        process = context.Process(
            target=_basic_pitch_child,
            args=(str(source_audio_path), temp_dir_name, sender),
            daemon=False,
        )
        process.start()
        sender.close()
        try:
            if not receiver.poll(timeout_seconds):
                process.terminate()
                process.join(timeout=5)
                raise MidiWorkflowError(
                    "basic_pitch_timeout",
                    f"Basic Pitch did not finish within {timeout_seconds:g} seconds.",
                )
            try:
                message = receiver.recv()
            except EOFError as exc:
                raise MidiWorkflowError(
                    "basic_pitch_process_failed",
                    f"Basic Pitch process exited without a result (exit code {process.exitcode}).",
                ) from exc
        finally:
            receiver.close()
        process.join(timeout=5)
        if process.is_alive():
            process.terminate()
            process.join(timeout=5)
        if not message.get("ok"):
            detail = f" {message['detail']}" if message.get("detail") else ""
            raise MidiWorkflowError(
                "basic_pitch_inference_failed",
                f"Basic Pitch inference failed: {message.get('error') or 'unknown error'}.{detail}",
            )
        produced = Path(str(message["output"]))
        if not produced.is_file():
            raise MidiWorkflowError("audio_to_midi_output_missing", "Basic Pitch output disappeared before publication.")
        produced.replace(output_midi_path)


def probe_basic_pitch_runtime() -> tuple[bool, str]:
    try:
        import numpy as np
        import soundfile as sf

        with tempfile.TemporaryDirectory(prefix="genost-basic-pitch-probe-") as directory:
            root = Path(directory)
            source = root / "probe.wav"
            destination = root / "probe.mid"
            sample_rate = 22_050
            samples = 0.15 * np.sin(2 * np.pi * 440 * np.arange(sample_rate // 4) / sample_rate)
            sf.write(source, samples.astype(np.float32), sample_rate)
            _run_basic_pitch_isolated(source, destination, timeout_seconds=90)
            if destination.stat().st_size == 0:
                return False, "Basic Pitch inference smoke test published an empty MIDI file"
        return True, "Basic Pitch ONNX inference smoke test passed in an isolated process"
    except Exception as exc:
        return False, f"Basic Pitch runtime probe failed: {exc}"


class Text2MidiProcess:
    def __init__(self, repo_path: Path, python_executable: str):
        self.repo_path = repo_path
        self.python_executable = python_executable
        self._lock = threading.Lock()
        self._process: subprocess.Popen | None = None

    def _start(self) -> subprocess.Popen:
        service = Path(__file__).with_name("text2midi_service.py")
        process = subprocess.Popen(
            [self.python_executable, str(service), "--repo", str(self.repo_path)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        ready_line = process.stdout.readline() if process.stdout else ""
        try:
            ready = json.loads(ready_line)
        except json.JSONDecodeError as exc:
            process.kill()
            _, stderr = process.communicate(timeout=2)
            detail = stderr or ready_line
            raise MidiWorkflowError(
                "text2midi_start_failed",
                f"Text2midi service did not start: {detail.strip()}",
            ) from exc
        if ready.get("status") != "ready":
            process.kill()
            raise MidiWorkflowError("text2midi_start_failed", str(ready.get("error") or ready))
        self._process = process
        return process

    def generate_batch(self, prompt: str, destinations: list[Path]) -> list[MidiGenerationOutput]:
        with self._lock:
            process = self._process
            if process is None or process.poll() is not None:
                process = self._start()
            if process.stdin is None or process.stdout is None:
                raise MidiWorkflowError("text2midi_start_failed", "Text2midi service pipes are unavailable.")
            seed_base = time.time_ns() & 0x7FFFFFFF
            seeds = [seed_base + index for index in range(len(destinations))]
            request = {
                "prompt": prompt,
                "outputs": [str(path) for path in destinations],
                "seeds": seeds,
            }
            process.stdin.write(json.dumps(request) + "\n")
            process.stdin.flush()
            response_line = process.stdout.readline()
            try:
                response = json.loads(response_line)
            except json.JSONDecodeError as exc:
                self._process = None
                process.kill()
                _, stderr = process.communicate(timeout=2)
                detail = stderr or response_line
                raise MidiWorkflowError(
                    "text2midi_generation_failed",
                    f"Text2midi service returned invalid output: {detail.strip()}",
                ) from exc
            if response.get("status") != "ready":
                raise MidiWorkflowError(
                    "text2midi_generation_failed",
                    str(response.get("error") or "Text2midi batch generation failed."),
                )
            return [
                MidiGenerationOutput(path.name, str(path), seed)
                for path, seed in zip(destinations, seeds, strict=True)
            ]


_TEXT2MIDI_PROCESSES: dict[tuple[str, str], Text2MidiProcess] = {}
_TEXT2MIDI_PROCESSES_LOCK = threading.Lock()


def _cached_text2midi_process(repo_path: Path, python_executable: str) -> Text2MidiProcess:
    key = (str(repo_path), python_executable)
    with _TEXT2MIDI_PROCESSES_LOCK:
        process = _TEXT2MIDI_PROCESSES.get(key)
        if process is None:
            process = Text2MidiProcess(repo_path, python_executable)
            _TEXT2MIDI_PROCESSES[key] = process
        return process


def text2midi_model_version(model_repo_path: str | Path | None = None) -> str:
    configured = os.environ.get("GENOST_TEXT2MIDI_MODEL_VERSION")
    if configured:
        return configured
    repo = Path(model_repo_path).expanduser().resolve() if model_repo_path else (
        Path(os.environ["GENOST_TEXT2MIDI_REPO"]).expanduser().resolve()
        if os.environ.get("GENOST_TEXT2MIDI_REPO")
        else None
    )
    if repo is None:
        return "local-command"
    head = repo / ".git" / "HEAD"
    try:
        value = head.read_text(encoding="utf-8").strip()
        if value.startswith("ref: "):
            reference = repo / ".git" / value.removeprefix("ref: ")
            value = reference.read_text(encoding="utf-8").strip()
        return value[:40] or "local-unversioned"
    except OSError:
        return "local-unversioned"


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

    configured_repo = repo or (
        Path(os.environ["GENOST_TEXT2MIDI_REPO"]).expanduser().resolve()
        if os.environ.get("GENOST_TEXT2MIDI_REPO")
        else None
    )
    command_template = os.environ.get("GENOST_TEXT2MIDI_COMMAND")
    if runner is subprocess.run and configured_repo is not None and not command_template:
        python = python_executable or shutil.which("python3") or shutil.which("python")
        if not python:
            raise MidiWorkflowError("text2midi_python_missing", "No Python executable is available for Text2MIDI.")
        destinations: list[Path] = []
        for index in range(quantity):
            destination = destination_dir / f"artifact{index + 1}.mid"
            if destination.exists():
                destination = destination_dir / f"artifact{index + 1}_{uuid.uuid4().hex[:8]}.mid"
            destinations.append(destination)
        return _cached_text2midi_process(configured_repo, python).generate_batch(prompt, destinations)

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
    source = Path(source_audio_path).expanduser().resolve()
    destination = Path(output_midi_path).expanduser().resolve()
    if not source.is_file():
        raise MidiWorkflowError("audio_to_midi_input_missing", f"Source audio is missing: {source}")
    if destination.exists():
        raise MidiWorkflowError("audio_to_midi_publication_conflict", f"MIDI output already exists: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    _run_basic_pitch_isolated(source, destination, timeout_seconds=600)
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
