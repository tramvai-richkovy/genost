from __future__ import annotations

import os
from dataclasses import dataclass
from importlib.util import find_spec
from pathlib import Path

from .audiocraft_generator import DEFAULT_MELODY_MODEL, DEFAULT_TEXT_MODEL, configure_model_cache, get_backend, get_device

REQUIRED_MUSICGEN_MODELS = (DEFAULT_TEXT_MODEL, DEFAULT_MELODY_MODEL)


@dataclass(frozen=True)
class ModelAvailability:
    name: str
    available: bool
    cache_paths: list[str]
    error: str | None
    download_hint: str


@dataclass(frozen=True)
class ModelPreflight:
    ok: bool
    backend: str
    device: str
    cache_paths: list[str]
    models: dict[str, ModelAvailability]
    errors: list[str]


def _module_installed(module_name: str) -> bool:
    try:
        return find_spec(module_name) is not None
    except (ImportError, ValueError):
        return False


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


def _snapshot_has_files(snapshot_root: Path) -> bool:
    return snapshot_root.is_dir() and any(path.is_file() for path in snapshot_root.rglob("*"))


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
            if snapshots.is_dir() and any(_snapshot_has_files(snapshot) for snapshot in snapshots.iterdir()):
                hits.append(str(candidate))
            elif _snapshot_has_files(candidate):
                hits.append(str(candidate))

    if hits:
        return True, sorted(set(hits))

    if _module_installed("huggingface_hub"):
        try:
            from huggingface_hub import try_to_load_from_cache
            from huggingface_hub.constants import _CACHED_NO_EXIST

            for root in cache_roots:
                result = try_to_load_from_cache(model_name, "config.json", cache_dir=str(root))
                if result and result is not _CACHED_NO_EXIST:
                    return True, [str(Path(result).parents[2])]
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

    dependencies = {
        "torch": _module_installed("torch"),
        "torchaudio": _module_installed("torchaudio"),
        "ffmpeg": _ffmpeg_available(),
    }
    if selected_backend == "audiocraft":
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
        errors=errors,
    )


def _ffmpeg_available() -> bool:
    from shutil import which

    return which("ffmpeg") is not None
