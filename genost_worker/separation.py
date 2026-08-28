from __future__ import annotations

import math
import os
import re
import shutil
import subprocess
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

SEPARATION_MODEL = "htdemucs_6s.yaml"
SEPARATION_LABELS = ("bass", "drums", "guitar", "piano", "vocals", "other")


class SeparationError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class SeparatedOutput:
    label: str
    file_name: str
    file_path: str
    duration_seconds: float
    peak: float


@dataclass(frozen=True)
class SeparationResult:
    model: str
    raw_stem_path: str
    bundle_path: str
    outputs: list[SeparatedOutput]

    def to_dict(self) -> dict:
        return {**asdict(self), "outputs": [asdict(output) for output in self.outputs]}


@dataclass(frozen=True)
class MergeResult:
    file_name: str
    file_path: str
    duration_seconds: float
    peak: float


def _separator_binary() -> Path:
    configured = os.environ.get("GENOST_AUDIO_SEPARATOR_BIN")
    path = Path(configured).expanduser() if configured else Path(__file__).resolve().parents[1] / ".venv-separator/bin/audio-separator"
    if not path.is_file() or not os.access(path, os.X_OK):
        raise SeparationError("separator_setup_missing", f"audio-separator executable is missing: {path}")
    return path


def _cache_path(model_cache_path: str | None) -> Path:
    configured = model_cache_path or os.environ.get("AUDIO_SEPARATOR_MODEL_DIR")
    path = Path(configured).expanduser() if configured else Path(__file__).resolve().parents[1] / ".audio-separator-models"
    try:
        path.mkdir(parents=True, exist_ok=True)
        probe = path / f".genost-write-{uuid.uuid4().hex}"
        probe.write_text("ok\n", encoding="utf-8")
        probe.unlink()
    except OSError as exc:
        raise SeparationError("separator_cache_invalid", f"Separator model cache is not writable: {path}: {exc}") from exc
    return path


def inspect_wav(path: Path) -> tuple[float, float]:
    try:
        import soundfile as sf

        with sf.SoundFile(str(path), "r") as audio:
            frames = len(audio)
            sample_rate = audio.samplerate
            channels = audio.channels
            peak = 0.0
            for block in audio.blocks(blocksize=65_536, dtype="float32", always_2d=True):
                if block.size:
                    block_peak = float(abs(block).max())
                    if not math.isfinite(block_peak):
                        raise ValueError("audio contains non-finite samples")
                    peak = max(peak, block_peak)
    except (OSError, RuntimeError, ValueError) as exc:
        raise SeparationError("separator_output_invalid", f"Unreadable separator WAV {path}: {exc}") from exc
    if frames <= 0 or sample_rate <= 0 or channels <= 0:
        raise SeparationError("separator_output_invalid", f"Separator WAV has invalid audio metadata: {path}")
    return frames / sample_rate, min(1.0, peak)


def _label_for_path(path: Path) -> str | None:
    stem = path.stem.lower()
    explicit_labels = re.findall(r"\((bass|drums|guitar|piano|vocals|other)\)", stem)
    if explicit_labels:
        return explicit_labels[-1]

    normalized = re.sub(r"[^a-z]+", " ", stem)
    matches = [
        (match.start(), label)
        for label in SEPARATION_LABELS
        for match in re.finditer(rf"\b{label}\b", normalized)
    ]
    return max(matches)[1] if matches else None


def separate_stem(
    raw_stem_path: str | Path,
    bundle_path: str | Path,
    *,
    model: str = SEPARATION_MODEL,
    model_cache_path: str | None = None,
    runner=subprocess.run,
) -> SeparationResult:
    source = Path(raw_stem_path).expanduser().resolve()
    destination = Path(bundle_path).expanduser().resolve()
    if not source.is_file():
        raise SeparationError("separator_input_missing", f"Raw MusicGen stem is missing: {source}")
    if destination.exists():
        raise SeparationError("separator_publication_conflict", f"Separation bundle already exists: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.parent / f".{destination.name}.{uuid.uuid4().hex}.tmp"
    temporary.mkdir()
    try:
        command = [
            str(_separator_binary()),
            str(source),
            "--model_filename",
            model,
            "--output_format",
            "WAV",
            "--output_dir",
            str(temporary),
            "--model_file_dir",
            str(_cache_path(model_cache_path)),
            "--sample_rate",
            "32000",
        ]
        try:
            runner(command, check=True, capture_output=True, text=True)
        except subprocess.CalledProcessError as exc:
            detail = (exc.stderr or exc.stdout or str(exc)).strip()
            raise SeparationError("separator_model_failed", f"Separation model failed: {detail}") from exc
        by_label: dict[str, Path] = {}
        for output in temporary.rglob("*.wav"):
            label = _label_for_path(output)
            if label and label not in by_label:
                by_label[label] = output
        missing = [label for label in SEPARATION_LABELS if label not in by_label]
        if missing:
            raise SeparationError("separator_outputs_incomplete", f"Separator did not publish all six outputs; missing: {', '.join(missing)}")
        outputs: list[SeparatedOutput] = []
        for label in SEPARATION_LABELS:
            source_output = by_label[label]
            final_name = f"{label}.wav"
            final_temp_path = temporary / final_name
            if source_output != final_temp_path:
                source_output.replace(final_temp_path)
            duration, peak = inspect_wav(final_temp_path)
            outputs.append(SeparatedOutput(label, final_name, str(destination / final_name), duration, peak))
        temporary.replace(destination)
        return SeparationResult(model, str(source), str(destination), outputs)
    except SeparationError:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
    except Exception as exc:
        shutil.rmtree(temporary, ignore_errors=True)
        raise SeparationError("separator_publication_failed", f"Could not publish separation bundle: {exc}") from exc


def merge_separated_outputs(
    output_paths: Iterable[str | Path],
    destination_path: str | Path,
    *,
    input_gains_db: Iterable[float] | None = None,
    runner=subprocess.run,
) -> MergeResult:
    sources = [Path(path).expanduser().resolve() for path in output_paths]
    gains_db = [float(value) for value in input_gains_db] if input_gains_db is not None else [0.0] * len(sources)
    destination = Path(destination_path).expanduser().resolve()
    if not sources:
        raise SeparationError("merge_selection_empty", "Select at least one separator output to merge.")
    if len(gains_db) != len(sources):
        raise SeparationError("merge_gain_count_invalid", "Every merge input must have exactly one volume level.")
    if any(not math.isfinite(value) or value < -60 or value > 6 for value in gains_db):
        raise SeparationError("merge_gain_invalid", "Merge volume levels must be finite values from -60 dB through +6 dB.")
    missing = [str(path) for path in sources if not path.is_file()]
    if missing:
        raise SeparationError("merge_input_missing", f"Merge source is missing: {', '.join(missing)}")
    if destination.exists():
        raise SeparationError("merge_publication_conflict", f"Merge already exists: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.parent / f".{destination.stem}.{uuid.uuid4().hex}.tmp.wav"
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"]
    for source in sources:
        command.extend(["-i", str(source)])
    gain_filters = [f"[{index}:a]volume={gain_db:.3f}dB[g{index}]" for index, gain_db in enumerate(gains_db)]
    inputs = "".join(f"[g{index}]" for index in range(len(sources)))
    command.extend([
        "-filter_complex",
        ";".join([*gain_filters, f"{inputs}amix=inputs={len(sources)}:duration=longest:normalize=0,alimiter=limit=0.98[out]"]),
        "-map",
        "[out]",
        "-ar",
        "32000",
        "-c:a",
        "pcm_s24le",
        str(temporary),
    ])
    try:
        runner(command, check=True, capture_output=True, text=True)
        duration, peak = inspect_wav(temporary)
        temporary.replace(destination)
        return MergeResult(destination.name, str(destination), duration, peak)
    except SeparationError:
        temporary.unlink(missing_ok=True)
        raise
    except Exception as exc:
        temporary.unlink(missing_ok=True)
        raise SeparationError("merge_failed", f"Could not merge separator outputs: {exc}") from exc
