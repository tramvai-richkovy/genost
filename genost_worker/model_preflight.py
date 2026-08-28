from __future__ import annotations

import os
import platform
import shutil
from dataclasses import dataclass
from functools import lru_cache
from importlib.util import find_spec
from pathlib import Path

from .audiocraft_generator import DEFAULT_MELODY_MODEL, DEFAULT_TEXT_MODEL, configure_model_cache, get_backend, get_device

REQUIRED_MUSICGEN_MODELS = (DEFAULT_TEXT_MODEL, DEFAULT_MELODY_MODEL)
REQUIRED_MODEL_FILES = ("state_dict.bin", "compression_state_dict.bin")


@dataclass(frozen=True)
class ModelAvailability:
    name: str
    available: bool
    cache_paths: list[str]
    error: str | None
    download_hint: str


@dataclass(frozen=True)
class ActionCapability:
    available: bool
    detail: str
    error: str | None
    setup_hint: str | None


@dataclass(frozen=True)
class ModelPreflight:
    ok: bool
    backend: str
    device: str
    cache_paths: list[str]
    models: dict[str, ModelAvailability]
    cache_writable: bool
    capabilities: dict[str, ActionCapability]
    errors: list[str]


def _module_installed(module_name: str) -> bool:
    try:
        return find_spec(module_name) is not None
    except (ImportError, ValueError):
        return False


def _modules_installed(*module_names: str) -> bool:
    return all(_module_installed(module_name) for module_name in module_names)


def _cache_is_writable(path: Path) -> bool:
    candidate = path
    while not candidate.exists() and candidate != candidate.parent:
        candidate = candidate.parent
    return candidate.is_dir() and os.access(candidate, os.W_OK)


def _text2midi_available() -> tuple[bool, str]:
    if os.environ.get("GENOST_TEXT2MIDI_COMMAND"):
        return True, "Configured through GENOST_TEXT2MIDI_COMMAND"
    repo_value = os.environ.get("GENOST_TEXT2MIDI_REPO")
    if not repo_value:
        return False, "GENOST_TEXT2MIDI_REPO or GENOST_TEXT2MIDI_COMMAND is not configured"
    script = Path(repo_value).expanduser() / "model" / "transformer_model.py"
    return script.is_file(), f"Expected Text2midi entrypoint at {script}"


def _separator_available() -> tuple[bool, str]:
    configured = os.environ.get("GENOST_AUDIO_SEPARATOR_BIN")
    binary = (
        Path(configured).expanduser()
        if configured
        else Path(__file__).resolve().parents[1] / ".venv-separator/bin/audio-separator"
    )
    return binary.is_file() and os.access(binary, os.X_OK), str(binary)


@lru_cache(maxsize=1)
def _basic_pitch_available() -> tuple[bool, str]:
    if not _module_installed("basic_pitch"):
        return False, "Basic Pitch package is not installed"
    try:
        from .midi import probe_basic_pitch_runtime

        return probe_basic_pitch_runtime()
    except Exception as exc:
        return False, f"Basic Pitch runtime probe failed: {exc}"


def _capability(
    available: bool,
    detail: str,
    *,
    setup_hint: str | None = None,
) -> ActionCapability:
    return ActionCapability(
        available=available,
        detail=detail,
        error=None if available else detail,
        setup_hint=None if available else setup_hint,
    )


def _action_capabilities() -> dict[str, ActionCapability]:
    text2midi, text2midi_detail = _text2midi_available()
    guide = _modules_installed("numpy", "pretty_midi", "scipy")
    basic_pitch, basic_pitch_detail = _basic_pitch_available()
    separator, separator_detail = _separator_available()
    ffmpeg = _ffmpeg_available()
    omnizart_binary = shutil.which("omnizart")
    omnizart_arm_blocked = platform.system() == "Darwin" and platform.machine() == "arm64"
    omnizart = bool(omnizart_binary) and not omnizart_arm_blocked
    omnizart_detail = (
        "Omnizart is disabled on ARM macOS because its official runtime is incompatible"
        if omnizart_arm_blocked
        else f"omnizart executable: {omnizart_binary or 'missing'}"
    )
    return {
        "text2midi": _capability(
            text2midi,
            text2midi_detail,
            setup_hint="Configure a local AMAAI-Lab/Text2midi checkout.",
        ),
        "midi_guide": _capability(
            guide,
            "numpy, pretty_midi, and scipy are available" if guide else "MIDI guide dependencies are missing",
            setup_hint="Install genost_worker/requirements.txt.",
        ),
        "basic_pitch": _capability(
            basic_pitch,
            basic_pitch_detail,
            setup_hint="Install the pinned Basic Pitch worker dependencies and run the local smoke test.",
        ),
        "separator": _capability(
            separator,
            f"audio-separator executable: {separator_detail}",
            setup_hint="Run scripts/setup-audio-separator.sh.",
        ),
        "merge": _capability(
            ffmpeg,
            "ffmpeg is available" if ffmpeg else "ffmpeg is unavailable",
            setup_hint="Install ffmpeg with Homebrew.",
        ),
        "omnizart": _capability(
            omnizart,
            omnizart_detail,
            setup_hint="Use a verified compatible Omnizart runtime; it remains optional.",
        ),
    }


def _candidate_cache_roots(model_cache_path: str | None = None, hf_home: str | None = None) -> list[Path]:
    roots: list[Path] = []
    for raw in [
        model_cache_path,
        hf_home,
        os.environ.get("AUDIOCRAFT_CACHE_DIR"),
        os.environ.get("HF_HOME"),
        str(Path.home() / ".cache" / "huggingface"),
    ]:
        if not raw:
            continue
        path = Path(raw).expanduser()
        if path not in roots:
            roots.append(path)
    return roots


def _repo_cache_names(model_name: str) -> tuple[str, str]:
    namespace, repo = model_name.split("/", 1)
    return (f"models--{namespace}--{repo}", repo)


def _snapshot_has_model_files(snapshot_root: Path) -> bool:
    return snapshot_root.is_dir() and all((snapshot_root / filename).is_file() for filename in REQUIRED_MODEL_FILES)


def _model_present_in_cache(model_name: str, cache_roots: list[Path]) -> tuple[bool, list[str]]:
    repo_cache_name, repo_short_name = _repo_cache_names(model_name)
    hits: list[str] = []

    for root in cache_roots:
        candidates = [
            root / "hub" / repo_cache_name,
            root / repo_cache_name,
            root / "models" / repo_short_name,
            root / repo_short_name,
        ]
        for candidate in candidates:
            snapshots = candidate / "snapshots"
            if snapshots.is_dir() and any(_snapshot_has_model_files(snapshot) for snapshot in snapshots.iterdir()):
                hits.append(str(candidate))
            elif _snapshot_has_model_files(candidate):
                hits.append(str(candidate))

    if hits:
        return True, sorted(set(hits))

    if _module_installed("huggingface_hub"):
        try:
            from huggingface_hub import try_to_load_from_cache
            from huggingface_hub.constants import _CACHED_NO_EXIST

            for root in cache_roots:
                results = [
                    try_to_load_from_cache(model_name, filename, cache_dir=str(root))
                    for filename in REQUIRED_MODEL_FILES
                ]
                if all(result and result is not _CACHED_NO_EXIST for result in results):
                    return True, [str(Path(str(results[0])).parents[2])]
        except Exception:
            pass

    return False, []


def check_model_preflight(
    *,
    model_cache_path: str | None = None,
    hf_home: str | None = None,
    backend: str | None = None,
    device: str | None = None,
) -> ModelPreflight:
    configure_model_cache(model_cache_path, hf_home)
    cache_roots = _candidate_cache_roots(model_cache_path, hf_home)
    cache_paths = [str(path) for path in cache_roots]
    errors: list[str] = []
    cache_writable = bool(cache_roots) and _cache_is_writable(cache_roots[0])
    if (model_cache_path and not cache_writable):
        errors.append(f"Configured model cache is not writable: {cache_roots[0]}")

    try:
        selected_backend = get_backend(backend)
    except Exception as exc:
        selected_backend = backend or "auto"
        errors.append(str(exc))

    try:
        selected_device = "metal" if selected_backend == "mlx" else get_device(device)
    except Exception as exc:
        selected_device = "unavailable"
        errors.append(str(exc))

    models: dict[str, ModelAvailability] = {}
    for model_name in REQUIRED_MUSICGEN_MODELS:
        available, hits = _model_present_in_cache(model_name, cache_roots)
        hint = f"huggingface-cli download {model_name} --cache-dir <GENOST model cache>"
        error = None if available else f"{model_name} was not found in the configured local Hugging Face/AudioCraft cache."
        if error:
            errors.append(error)
        models[model_name] = ModelAvailability(model_name, available, hits, error, hint)

    dependencies = {"soundfile": _module_installed("soundfile")}
    if selected_backend == "audiocraft":
        dependencies["torch"] = _module_installed("torch")
        dependencies["torchaudio"] = _module_installed("torchaudio")
        dependencies["audiocraft"] = _module_installed("audiocraft")
    if selected_backend == "mlx":
        dependencies["mlx_audiocraft"] = _module_installed("mlx_audiocraft")

    for dependency, installed in dependencies.items():
        if not installed:
            errors.append(f"Missing dependency: {dependency}")

    return ModelPreflight(
        ok=not errors,
        backend=selected_backend,
        device=selected_device,
        cache_paths=cache_paths,
        models=models,
        cache_writable=cache_writable,
        capabilities=_action_capabilities(),
        errors=errors,
    )


def _ffmpeg_available() -> bool:
    from shutil import which

    return which("ffmpeg") is not None
