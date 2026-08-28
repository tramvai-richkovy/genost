from __future__ import annotations

import gc
import math
import os
import platform
import sys
import types
import wave
from dataclasses import dataclass
from pathlib import Path
from time import monotonic
from typing import Callable, Literal
from uuid import uuid4

DEFAULT_TEXT_MODEL = "facebook/musicgen-medium"
DEFAULT_MELODY_MODEL = "facebook/musicgen-melody"
DEFAULT_SAMPLE_RATE = 32000
_MODEL_CACHE: dict[tuple[str, str], object] = {}
_MLX_MODEL_CACHE: dict[str, object] = {}
AudioValidationProfile = Literal["basic", "music", "full_mix"]
AudioContentCategory = Literal["generic", "bass_drone", "rhythm", "melody"]
GenerationBackend = Literal["auto", "audiocraft", "mlx"]
ProgressCallback = Callable[[int, int], None]


class GeneratorError(RuntimeError):
    """Structured boundary for worker-facing generation failures."""


@dataclass(frozen=True)
class AudioMetrics:
    duration_seconds: float
    sample_rate: int
    channels: int
    peak: float
    rms_db: float
    dc_offset: float
    energy_below_500_hz: float
    energy_above_2000_hz: float
    rolloff_85_hz: float
    spectral_centroid_hz: float
    spectral_flatness: float
    zero_crossings_per_second: float


@dataclass(frozen=True)
class GenerationResult:
    output_path: str
    backend: str
    device: str
    model: str
    generation_seconds: float
    metrics: AudioMetrics


@dataclass(frozen=True)
class SpectralValidationThresholds:
    energy_above_2000_hz: float
    spectral_centroid_hz: float
    spectral_flatness: float
    zero_crossings_per_second: float


SPECTRAL_VALIDATION_THRESHOLDS: dict[AudioContentCategory, SpectralValidationThresholds] = {
    "generic": SpectralValidationThresholds(0.025, 250, 0.0001, 750),
    "bass_drone": SpectralValidationThresholds(0.0005, 75, 0.000001, 150),
    "rhythm": SpectralValidationThresholds(0.001, 100, 0.00001, 250),
    "melody": SpectralValidationThresholds(0.0015, 100, 0.000001, 200),
}


def configure_model_cache(model_cache_path: str | None = None, hf_home: str | None = None) -> None:
    if model_cache_path:
        os.environ["AUDIOCRAFT_CACHE_DIR"] = model_cache_path

    if hf_home or model_cache_path:
        os.environ["HF_HOME"] = hf_home or model_cache_path or ""

    cache_root = os.environ.get("HF_HOME")
    if cache_root:
        os.environ.setdefault("TORCH_HOME", str(Path(cache_root) / "torch"))


def get_backend(preferred_backend: str | None = None) -> str:
    requested = (preferred_backend or os.environ.get("GENOST_GENERATION_BACKEND") or "auto").lower()
    if requested == "auto":
        return "mlx" if platform.system() == "Darwin" and platform.machine() == "arm64" else "audiocraft"
    if requested == "mlx":
        if platform.system() != "Darwin" or platform.machine() != "arm64":
            raise GeneratorError("The MLX backend requires Apple Silicon macOS.")
        return "mlx"
    if requested == "audiocraft":
        return "audiocraft"
    raise GeneratorError(f"Unsupported generation backend: {requested}")


def _prepare_audiocraft_runtime() -> None:
    """Use Torch attention when xformers is unavailable.

    AudioCraft imports xformers unconditionally, but its released MusicGen
    configs can use Torch scaled-dot-product attention on CPU. This import shim
    exists only to make that supported CPU path importable on macOS; it does not
    attempt to make AudioCraft's model execution MPS-compatible.
    """
    import torch

    try:
        import xformers  # noqa: F401
    except ImportError:
        xformers_module = types.ModuleType("xformers")
        ops_module = types.ModuleType("xformers.ops")

        class LowerTriangularMask:
            pass

        def unavailable_xformers_attention(*_args, **_kwargs):
            raise RuntimeError("The xformers attention backend is unavailable on macOS.")

        ops_module.unbind = torch.unbind
        ops_module.LowerTriangularMask = LowerTriangularMask
        ops_module.memory_efficient_attention = unavailable_xformers_attention
        xformers_module.ops = ops_module
        sys.modules["xformers"] = xformers_module
        sys.modules["xformers.ops"] = ops_module

def get_device(preferred_device: str | None = None) -> str:
    try:
        import torch
    except Exception as exc:  # pragma: no cover - exercised by setup script
        raise GeneratorError(f"PyTorch is not available: {exc}") from exc

    requested = (preferred_device or os.environ.get("GENOST_AUDIOCRAFT_DEVICE") or "auto").lower()
    if requested == "mps":
        raise GeneratorError(
            "PyTorch MPS is not supported for AudioCraft generation because it can silently produce "
            "invalid audio. Use GENOST_AUDIOCRAFT_DEVICE=cpu on macOS."
        )
    if requested == "cpu":
        return "cpu"
    if requested == "auto":
        return "cuda" if torch.cuda.is_available() else "cpu"
    if requested == "cuda" or requested.startswith("cuda:"):
        if not torch.cuda.is_available():
            raise GeneratorError(f"Requested AudioCraft device is unavailable: {requested}")
        return requested
    raise GeneratorError(f"Unsupported AudioCraft device: {requested}")


def _load_model(model_name: str, device: str):
    cache_key = (model_name, device)

    if cache_key in _MODEL_CACHE:
        return _MODEL_CACHE[cache_key]

    try:
        _prepare_audiocraft_runtime()
        from audiocraft.models import MusicGen
        from audiocraft.modules.transformer import set_efficient_attention_backend
    except Exception as exc:  # pragma: no cover - depends on local model setup
        raise GeneratorError(f"AudioCraft is not available: {exc}") from exc

    set_efficient_attention_backend("torch")
    model = MusicGen.get_pretrained(model_name, device=device)
    _MODEL_CACHE[cache_key] = model
    return model


def _load_mlx_model(model_name: str):
    if model_name in _MLX_MODEL_CACHE:
        return _MLX_MODEL_CACHE[model_name]

    try:
        _prepare_mlx_loader()
        from mlx_audiocraft import MusicGen
    except Exception as exc:  # pragma: no cover - depends on Apple Silicon setup
        raise GeneratorError(f"MLX AudioCraft is not available: {exc}") from exc

    try:
        model = MusicGen.get_pretrained(model_name)
    except Exception as exc:  # pragma: no cover - depends on local model cache
        raise GeneratorError(f"Failed to load MLX MusicGen model {model_name}: {exc}") from exc
    _MLX_MODEL_CACHE[model_name] = model
    return model


def _prepare_mlx_loader() -> None:
    """Keep MLX checkpoint conversion within a 16 GB Apple Silicon budget."""
    import numpy as np
    import torch
    from huggingface_hub import hf_hub_download
    from mlx_audiocraft.models import loaders
    from mlx_audiocraft.utils import weight_convert

    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

    def load_local_state_dict(file_or_repo, filename=None, cache_dir=None):
        candidate = Path(str(file_or_repo)).expanduser()
        if candidate.is_dir():
            if not filename:
                raise GeneratorError(f"Checkpoint filename is required for {candidate}")
            checkpoint = candidate / filename
        elif candidate.is_file():
            checkpoint = candidate
        elif str(file_or_repo).startswith("https://"):
            raise GeneratorError("MLX checkpoint URLs are disabled; configure a local model cache.")
        else:
            if not filename:
                raise GeneratorError(f"Checkpoint filename is required for {file_or_repo}")
            checkpoint = Path(
                hf_hub_download(
                    repo_id=str(file_or_repo),
                    filename=filename,
                    cache_dir=cache_dir,
                    local_files_only=True,
                )
            )
        try:
            return torch.load(checkpoint, map_location="cpu", weights_only=False, mmap=True)
        except TypeError:
            return torch.load(checkpoint, map_location="cpu", weights_only=False)

    def preserve_checkpoint_dtype(state_dict, dtype=np.float32):
        del dtype
        converted = {}
        for key, value in state_dict.items():
            if hasattr(value, "detach"):
                converted[key] = value.detach().cpu().numpy()
            elif isinstance(value, np.ndarray):
                converted[key] = value
        return converted

    loaders._get_state_dict = load_local_state_dict
    weight_convert.to_numpy = preserve_checkpoint_dtype


def clear_model_cache() -> None:
    """Release cached model instances between incompatible or memory-heavy phases."""
    _MODEL_CACHE.clear()
    _MLX_MODEL_CACHE.clear()
    gc.collect()
    try:
        import mlx.core as mx

        mx.clear_cache()
    except Exception:
        pass


def analyze_audio_file(path: str | Path) -> AudioMetrics:
    try:
        import numpy as np
        import soundfile as sf
    except Exception as exc:  # pragma: no cover - depends on local audio setup
        raise GeneratorError(f"Audio validation dependencies are not available: {exc}") from exc

    audio_path = Path(path)
    try:
        frames, sample_rate = sf.read(str(audio_path), always_2d=True, dtype="float32")
    except Exception as exc:
        raise GeneratorError(f"Failed to read generated audio {audio_path}: {exc}") from exc

    if frames.ndim != 2 or frames.shape[0] < 1 or frames.shape[1] < 1:
        raise GeneratorError(f"Generated audio has an invalid shape: {tuple(frames.shape)}")
    if not bool(np.isfinite(frames).all()):
        raise GeneratorError("Generated audio contains non-finite samples.")

    mono = frames.astype(np.float64, copy=False).mean(axis=1)
    duration_seconds = mono.size / sample_rate
    peak = float(np.abs(mono).max())
    rms = float(np.sqrt(np.mean(np.square(mono))))
    rms_db = 20 * math.log10(max(rms, 1e-12))
    dc_offset = float(np.mean(mono))

    frame_length = min(sample_rate, mono.size)
    frame_count = max(1, mono.size // frame_length)
    framed = mono[: frame_count * frame_length].reshape(frame_count, frame_length)
    framed = framed - framed.mean(axis=1, keepdims=True)
    window = np.hanning(frame_length)
    power = np.mean(np.abs(np.fft.rfft(framed * window, axis=1)) ** 2, axis=0)
    frequencies = np.fft.rfftfreq(frame_length, d=1 / sample_rate)
    total_power = float(np.sum(power))
    if total_power <= 1e-12:
        energy_below_500_hz = 0.0
        energy_above_2000_hz = 0.0
        rolloff_85_hz = 0.0
        spectral_centroid_hz = 0.0
        spectral_flatness = 0.0
    else:
        energy_below_500_hz = float(np.sum(power[frequencies < 500])) / total_power
        energy_above_2000_hz = float(np.sum(power[frequencies >= 2000])) / total_power
        cumulative = np.cumsum(power)
        rolloff_index = int(np.searchsorted(cumulative, cumulative[-1] * 0.85))
        rolloff_85_hz = float(frequencies[min(rolloff_index, frequencies.size - 1)])
        spectral_centroid_hz = float(np.sum(frequencies * power) / np.sum(power))
        spectral_flatness = float(np.exp(np.mean(np.log(np.maximum(power, 1e-12)))) / max(float(np.mean(power)), 1e-12))

    zero_crossings = int(np.count_nonzero(np.diff(np.signbit(mono))))
    zero_crossings_per_second = float(zero_crossings / max(duration_seconds, 1e-12))

    return AudioMetrics(
        duration_seconds=duration_seconds,
        sample_rate=sample_rate,
        channels=int(frames.shape[1]),
        peak=peak,
        rms_db=rms_db,
        dc_offset=dc_offset,
        energy_below_500_hz=energy_below_500_hz,
        energy_above_2000_hz=energy_above_2000_hz,
        rolloff_85_hz=rolloff_85_hz,
        spectral_centroid_hz=spectral_centroid_hz,
        spectral_flatness=spectral_flatness,
        zero_crossings_per_second=zero_crossings_per_second,
    )


def validate_generated_audio(
    path: str | Path,
    expected_duration_seconds: float,
    profile: AudioValidationProfile = "basic",
    content_category: AudioContentCategory = "generic",
) -> AudioMetrics:
    metrics = analyze_audio_file(path)
    issues: list[str] = []

    if metrics.duration_seconds < expected_duration_seconds * 0.98:
        issues.append(
            f"truncated duration {metrics.duration_seconds:.3f}s; expected {expected_duration_seconds:.3f}s"
        )
    if metrics.rms_db < -55:
        issues.append(f"effectively silent RMS {metrics.rms_db:.1f} dBFS")
    if metrics.peak > 1.01:
        issues.append(f"clipped peak amplitude {metrics.peak:.3f}")
    if abs(metrics.dc_offset) > 0.1:
        issues.append(f"excessive DC offset {metrics.dc_offset:.3f}")

    if profile in {"music", "full_mix"}:
        thresholds = SPECTRAL_VALIDATION_THRESHOLDS[content_category]
        if metrics.energy_above_2000_hz < thresholds.energy_above_2000_hz:
            issues.append(f"insufficient energy above 2 kHz {metrics.energy_above_2000_hz:.1%}")
        if metrics.spectral_centroid_hz < thresholds.spectral_centroid_hz:
            issues.append(f"degenerate spectral centroid {metrics.spectral_centroid_hz:.0f} Hz")
        if metrics.spectral_flatness < thresholds.spectral_flatness:
            issues.append(f"degenerate spectral flatness {metrics.spectral_flatness:.6f}")
        if metrics.zero_crossings_per_second < thresholds.zero_crossings_per_second:
            issues.append(f"insufficient high-frequency activity {metrics.zero_crossings_per_second:.0f} crossings/s")

    if issues:
        category_suffix = f"/{content_category}" if profile in {"music", "full_mix"} else ""
        raise GeneratorError(f"Generated audio failed {profile}{category_suffix} validation: {'; '.join(issues)}")
    return metrics


def save_audio(
    audio_tensor,
    output_path: str,
    sample_rate: int = DEFAULT_SAMPLE_RATE,
    *,
    expected_duration_seconds: float | None = None,
    validation_profile: AudioValidationProfile = "basic",
    content_category: AudioContentCategory = "generic",
) -> str:
    try:
        import numpy as np
        import soundfile as sf
    except Exception as exc:  # pragma: no cover - depends on local audio setup
        raise GeneratorError(f"Audio publication dependencies are not available: {exc}") from exc

    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)
    if output_file.exists():
        raise GeneratorError(f"Refusing to overwrite an existing generated stem: {output_file}")

    value = audio_tensor
    if hasattr(value, "detach"):
        value = value.detach()
    if hasattr(value, "cpu"):
        value = value.cpu()
    if hasattr(value, "numpy"):
        value = value.numpy()
    samples = np.asarray(value, dtype=np.float32)
    if samples.ndim == 3 and samples.shape[0] == 1:
        samples = samples[0]
    if samples.ndim == 1:
        samples = samples[np.newaxis, :]
    if samples.ndim != 2 or samples.shape[0] < 1 or samples.shape[1] < 1:
        raise GeneratorError(f"Generated audio has an invalid shape: {tuple(samples.shape)}")
    if not bool(np.isfinite(samples).all()):
        raise GeneratorError("Generated audio contains non-finite samples.")

    peak = float(np.max(np.abs(samples)))
    if peak > 0.98:
        samples = samples * (0.98 / peak)

    temporary = output_file.with_name(f".{output_file.stem}.{uuid4().hex}.tmp{output_file.suffix}")
    try:
        sf.write(str(temporary), samples.T, sample_rate, subtype="PCM_24")
        duration = expected_duration_seconds
        if duration is None:
            duration = float(samples.shape[-1]) / sample_rate
        validate_generated_audio(temporary, duration, validation_profile, content_category)
        temporary.replace(output_file)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    return str(output_file)


def generate_text_stem(
    prompt: str,
    duration_seconds: int,
    output_path: str,
    model_name: str = DEFAULT_TEXT_MODEL,
    model_cache_path: str | None = None,
    hf_home: str | None = None,
    seed: int | None = None,
    preferred_device: str | None = None,
    validation_profile: AudioValidationProfile = "basic",
    content_category: AudioContentCategory = "generic",
    backend: GenerationBackend = "auto",
    progress_callback: ProgressCallback | None = None,
) -> str:
    configure_model_cache(model_cache_path, hf_home)
    selected_backend = get_backend(backend)
    if selected_backend == "mlx":
        try:
            import mlx.core as mx
            import numpy as np
        except Exception as exc:  # pragma: no cover - depends on Apple Silicon setup
            raise GeneratorError(f"MLX generation dependencies are unavailable: {exc}") from exc

        model = _load_mlx_model(model_name)
        model.set_generation_params(duration=duration_seconds, top_k=250, temperature=1.0, cfg_coef=3.0)
        if seed is not None:
            mx.random.seed(seed)
        model.set_custom_progress_callback(progress_callback)
        try:
            wav = model.generate([prompt], progress=True)
        finally:
            model.set_custom_progress_callback(None)
        return save_audio(
            np.array(wav[0], copy=True),
            output_path,
            model.sample_rate,
            expected_duration_seconds=duration_seconds,
            validation_profile=validation_profile,
            content_category=content_category,
        )

    device = get_device(preferred_device)
    model = _load_model(model_name, device)
    model.set_generation_params(duration=duration_seconds)
    if seed is not None:
        import torch

        torch.manual_seed(seed)
    model.set_custom_progress_callback(progress_callback)
    try:
        wav = model.generate([prompt], progress=True)
    finally:
        model.set_custom_progress_callback(None)
    return save_audio(
        wav[0],
        output_path,
        model.sample_rate,
        expected_duration_seconds=duration_seconds,
        validation_profile=validation_profile,
        content_category=content_category,
    )


def generate_conditioned_stem(
    prompt: str,
    reference_audio_path: str,
    duration_seconds: int,
    output_path: str,
    model_cache_path: str | None = None,
    hf_home: str | None = None,
    seed: int | None = None,
    preferred_device: str | None = None,
    validation_profile: AudioValidationProfile = "basic",
    content_category: AudioContentCategory = "generic",
    backend: GenerationBackend = "auto",
    progress_callback: ProgressCallback | None = None,
) -> str:
    configure_model_cache(model_cache_path, hf_home)
    selected_backend = get_backend(backend)
    reference_path = Path(reference_audio_path)
    if not reference_path.exists():
        raise GeneratorError(f"Reference audio does not exist: {reference_audio_path}")

    if selected_backend == "mlx":
        try:
            import mlx.core as mx
            import numpy as np
            import soundfile as sf
        except Exception as exc:  # pragma: no cover - depends on Apple Silicon setup
            raise GeneratorError(f"MLX generation dependencies are unavailable: {exc}") from exc

        model = _load_mlx_model(DEFAULT_MELODY_MODEL)
        model.set_generation_params(duration=duration_seconds, top_k=250, temperature=1.0, cfg_coef=3.0)
        if seed is not None:
            mx.random.seed(seed)
        reference, sample_rate = sf.read(reference_audio_path, always_2d=True, dtype="float32")
        melody = mx.array(reference.T)
        model.set_custom_progress_callback(progress_callback)
        try:
            wav = model.generate_with_chroma(
                descriptions=[prompt],
                melody_wavs=melody,
                melody_sample_rate=sample_rate,
                progress=True,
            )
        finally:
            model.set_custom_progress_callback(None)
        return save_audio(
            np.array(wav[0], copy=True),
            output_path,
            model.sample_rate,
            expected_duration_seconds=duration_seconds,
            validation_profile=validation_profile,
            content_category=content_category,
        )

    device = get_device(preferred_device)
    model = _load_model(DEFAULT_MELODY_MODEL, device)
    model.set_generation_params(duration=duration_seconds)
    if seed is not None:
        import torch

        torch.manual_seed(seed)

    try:
        import torchaudio
    except Exception as exc:  # pragma: no cover - depends on local audio setup
        raise GeneratorError(f"torchaudio is not available: {exc}") from exc

    melody_wav, sample_rate = torchaudio.load(reference_audio_path)
    model.set_custom_progress_callback(progress_callback)
    try:
        wav = model.generate_with_chroma(
            descriptions=[prompt],
            melody_wavs=melody_wav,
            melody_sample_rate=sample_rate,
            progress=True,
        )
    finally:
        model.set_custom_progress_callback(None)
    return save_audio(
        wav[0],
        output_path,
        model.sample_rate,
        expected_duration_seconds=duration_seconds,
        validation_profile=validation_profile,
        content_category=content_category,
    )


def generate_continuation(
    prompt: str,
    source_audio_path: str,
    duration_seconds: int,
    continuation_start_seconds: int,
    output_path: str,
    model_cache_path: str | None = None,
    hf_home: str | None = None,
    seed: int | None = None,
    preferred_device: str | None = None,
    validation_profile: AudioValidationProfile = "basic",
    content_category: AudioContentCategory = "generic",
    backend: GenerationBackend = "auto",
    progress_callback: ProgressCallback | None = None,
) -> str:
    configure_model_cache(model_cache_path, hf_home)
    selected_backend = get_backend(backend)
    source_path = Path(source_audio_path)
    if not source_path.exists():
        raise GeneratorError(f"Source audio does not exist: {source_audio_path}")

    if selected_backend == "mlx":
        try:
            import mlx.core as mx
            import numpy as np
            import soundfile as sf
        except Exception as exc:  # pragma: no cover - depends on Apple Silicon setup
            raise GeneratorError(f"MLX generation dependencies are unavailable: {exc}") from exc

        model = _load_mlx_model(DEFAULT_TEXT_MODEL)
        model.set_generation_params(duration=duration_seconds, top_k=250, temperature=1.0, cfg_coef=3.0)
        if seed is not None:
            mx.random.seed(seed)
        source, sample_rate = sf.read(source_audio_path, always_2d=True, dtype="float32")
        start_frame = max(0, int(continuation_start_seconds * sample_rate))
        prompt_audio = source[start_frame:]
        if prompt_audio.size == 0:
            raise GeneratorError("Continuation start is beyond the source audio duration.")
        model.set_custom_progress_callback(progress_callback)
        try:
            wav = model.generate_continuation(
                prompt=mx.array(prompt_audio.T),
                prompt_sample_rate=sample_rate,
                descriptions=[prompt],
                progress=True,
            )
        finally:
            model.set_custom_progress_callback(None)
        return save_audio(
            np.array(wav[0], copy=True),
            output_path,
            model.sample_rate,
            expected_duration_seconds=duration_seconds,
            validation_profile=validation_profile,
            content_category=content_category,
        )

    device = get_device(preferred_device)
    model = _load_model(DEFAULT_TEXT_MODEL, device)
    model.set_generation_params(duration=duration_seconds)
    if seed is not None:
        import torch

        torch.manual_seed(seed)

    try:
        import torchaudio
    except Exception as exc:  # pragma: no cover - depends on local audio setup
        raise GeneratorError(f"torchaudio is not available: {exc}") from exc

    source_wav, sample_rate = torchaudio.load(source_audio_path)
    model.set_custom_progress_callback(progress_callback)
    try:
        wav = model.generate_continuation(
            prompt=source_wav,
            prompt_sample_rate=sample_rate,
            descriptions=[prompt],
            progress=True,
        )
    finally:
        model.set_custom_progress_callback(None)
    return save_audio(
        wav[0],
        output_path,
        model.sample_rate,
        expected_duration_seconds=duration_seconds,
        validation_profile=validation_profile,
        content_category=content_category,
    )


def generate_fixture_tone(output_path: str, duration_seconds: int, sample_rate: int = DEFAULT_SAMPLE_RATE) -> str:
    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)
    if output_file.exists():
        raise GeneratorError(f"Refusing to overwrite an existing generated stem: {output_file}")
    amplitude = 0.22
    frequency = 110.0
    total_frames = duration_seconds * sample_rate
    temporary = output_file.with_name(f".{output_file.stem}.{uuid4().hex}.tmp{output_file.suffix}")

    try:
        with wave.open(str(temporary), "wb") as wav_file:
            wav_file.setnchannels(2)
            wav_file.setsampwidth(2)
            wav_file.setframerate(sample_rate)

            for frame in range(total_frames):
                envelope = min(1.0, frame / (sample_rate * 0.03), (total_frames - frame) / (sample_rate * 0.03))
                value = int(32767 * amplitude * envelope * math.sin((2 * math.pi * frequency * frame) / sample_rate))
                sample = value.to_bytes(2, byteorder="little", signed=True)
                wav_file.writeframesraw(sample + sample)
        temporary.replace(output_file)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise

    return str(output_file)


def generate_with_metadata(
    *,
    kind: Literal["text", "conditioned", "continuation"],
    prompt: str,
    duration_seconds: int,
    output_path: str,
    model_name: str = DEFAULT_TEXT_MODEL,
    reference_audio_path: str | None = None,
    continuation_start_seconds: int = 15,
    model_cache_path: str | None = None,
    hf_home: str | None = None,
    seed: int | None = None,
    preferred_device: str | None = None,
    validation_profile: AudioValidationProfile = "music",
    content_category: AudioContentCategory = "generic",
    backend: GenerationBackend = "auto",
    progress_callback: ProgressCallback | None = None,
) -> GenerationResult:
    selected_backend = get_backend(backend)
    started = monotonic()
    if kind == "text":
        published = generate_text_stem(
            prompt,
            duration_seconds,
            output_path,
            model_name,
            model_cache_path,
            hf_home,
            seed,
            preferred_device,
            validation_profile,
            content_category,
            backend,
            progress_callback,
        )
        actual_model = model_name
    elif kind == "conditioned":
        if not reference_audio_path:
            raise GeneratorError("Conditioned generation requires reference audio.")
        published = generate_conditioned_stem(
            prompt,
            reference_audio_path,
            duration_seconds,
            output_path,
            model_cache_path,
            hf_home,
            seed,
            preferred_device,
            validation_profile,
            content_category,
            backend,
            progress_callback,
        )
        actual_model = DEFAULT_MELODY_MODEL
    else:
        if not reference_audio_path:
            raise GeneratorError("Continuation generation requires source audio.")
        published = generate_continuation(
            prompt,
            reference_audio_path,
            duration_seconds,
            continuation_start_seconds,
            output_path,
            model_cache_path,
            hf_home,
            seed,
            preferred_device,
            validation_profile,
            content_category,
            backend,
            progress_callback,
        )
        actual_model = DEFAULT_TEXT_MODEL

    return GenerationResult(
        output_path=published,
        backend=selected_backend,
        device="metal" if selected_backend == "mlx" else get_device(preferred_device),
        model=actual_model,
        generation_seconds=monotonic() - started,
        metrics=analyze_audio_file(published),
    )
