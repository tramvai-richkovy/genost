from __future__ import annotations

import platform
import shutil
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from importlib.util import find_spec
from pathlib import Path

from fastapi import FastAPI, HTTPException

from .audiocraft_generator import (
    GeneratorError,
    generate_fixture_tone,
    generate_with_metadata,
    get_backend,
    get_device,
)
from .jobs import jobs
from .midi import MidiWorkflowError, audio_to_midi, generate_text_midi, midi_to_clean_guide_wav
from .model_preflight import check_model_preflight
from .schemas import (
    AudioToMidiRequest,
    AudioToMidiResponse,
    GenerationRequest,
    GenerationResponse,
    GenerationSubmissionResponse,
    HealthResponse,
    MidiGuideWavRequest,
    MidiGuideWavResponse,
    ModelPreflightRequest,
    ModelPreflightResponse,
    SeparationMergeRequest,
    SeparationMergeResponse,
    SeparationRequest,
    SeparationResponse,
    TextToMidiRequest,
    TextToMidiResponse,
)
from .separation import SeparationError, merge_separated_outputs, separate_stem

app = FastAPI(title="GENOST Worker", version="0.1.0")
_render_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="genost-render")


class GenerationCanceled(RuntimeError):
    pass


def _error_code(exc: Exception) -> str:
    message = str(exc).lower()
    if isinstance(exc, MemoryError) or "out of memory" in message or "memoryerror" in message:
        return "out_of_memory"
    if "reference audio does not exist" in message or "source audio does not exist" in message:
        return "missing_input_stem"
    if "cache" in message and ("does not exist" in message or "not writable" in message):
        return "invalid_cache_path"
    if "unavailable" in message or "not supported" in message or "unsupported device" in message:
        return "unsupported_runtime"
    if "failed to read" in message or "failed to write" in message or "torchaudio.save" in message:
        return "audio_io_failed"
    if "import" in message or "is not available" in message:
        return "dependency_unavailable"
    if "validation" in message:
        return "audio_validation_failed"
    return "generation_failed"


def _midi_error_code(exc: Exception) -> str:
    if isinstance(exc, MidiWorkflowError):
        return exc.code
    message = str(exc).lower()
    if "missing" in message or "unavailable" in message or "not found" in message:
        return "midi_dependency_missing"
    if "exists" in message or "conflict" in message or "overwrite" in message:
        return "midi_publication_conflict"
    return "midi_workflow_failed"


def _module_available(module_name: str) -> bool:
    try:
        __import__(module_name)
    except Exception:
        return False

    return True


def _module_installed(module_name: str) -> bool:
    try:
        return find_spec(module_name) is not None
    except (ImportError, ValueError):
        return False


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    torch_available = _module_available("torch")
    mps_available = False

    if torch_available:
        import torch

        mps_available = bool(torch.backends.mps.is_available())

    preflight = check_model_preflight()
    return HealthResponse(
        ok=preflight.ok,
        python=platform.python_version(),
        torch_available=torch_available,
        mps_available=mps_available,
        audiocraft_available=_module_installed("audiocraft"),
        torchaudio_available=_module_available("torchaudio"),
        ffmpeg_available=shutil.which("ffmpeg") is not None,
        mlx_available=_module_available("mlx_audiocraft"),
        generation_backend=preflight.backend,
        device=preflight.device,
        cache_paths=preflight.cache_paths,
        medium_model_available=preflight.models["facebook/musicgen-medium"].available,
        melody_model_available=preflight.models["facebook/musicgen-melody"].available,
        preflight=asdict(preflight),
    )


@app.post("/preflight", response_model=ModelPreflightResponse)
def preflight(request: ModelPreflightRequest) -> ModelPreflightResponse:
    result = check_model_preflight(
        model_cache_path=request.model_cache_path,
        hf_home=request.hf_home,
        backend=request.backend,
        device=request.device,
    )
    return ModelPreflightResponse(**asdict(result))


def _remove_canceled_output(output_path: str) -> None:
    try:
        Path(output_path).unlink(missing_ok=True)
    except OSError:
        pass


def _run_render(request: GenerationRequest) -> None:
    if jobs.is_cancel_requested(request.job_id):
        jobs.upsert(request.job_id, "canceled", "Canceled before generation started")
        return

    jobs.upsert(request.job_id, "rendering", f"Rendering {request.kind}", progress=0.0)

    def report_progress(generated_tokens: int, total_tokens: int) -> None:
        if jobs.is_cancel_requested(request.job_id):
            raise GenerationCanceled("Generation canceled by user")
        progress = generated_tokens / max(1, total_tokens)
        jobs.upsert(
            request.job_id,
            "rendering",
            f"Generating audio · {round(progress * 100)}%",
            progress=progress,
        )

    try:
        if request.kind == "fixture":
            output_path = generate_fixture_tone(request.output_path, request.duration_seconds)
        elif request.kind in {"text", "conditioned", "continuation"}:
            result = generate_with_metadata(
                kind=request.kind,
                prompt=request.prompt,
                duration_seconds=request.duration_seconds,
                output_path=request.output_path,
                model_name=request.model_name,
                reference_audio_path=request.reference_audio_path,
                continuation_start_seconds=request.continuation_start_seconds,
                model_cache_path=request.model_cache_path,
                hf_home=request.hf_home,
                seed=request.seed,
                preferred_device=request.device,
                validation_profile=request.audio_validation_profile,
                content_category=request.audio_content_category,
                backend=request.backend,
                progress_callback=report_progress,
            )
            output_path = result.output_path
        else:
            raise GeneratorError(f"Unsupported generation kind: {request.kind}")
        if jobs.is_cancel_requested(request.job_id):
            _remove_canceled_output(output_path)
            jobs.upsert(request.job_id, "canceled", "Generation canceled by user")
            return
    except GenerationCanceled as exc:
        _remove_canceled_output(request.output_path)
        jobs.upsert(request.job_id, "canceled", str(exc))
        return
    except Exception as exc:
        response = GenerationResponse(
            job_id=request.job_id,
            status="failed",
            error_code=_error_code(exc),
            error=str(exc),
        )
        jobs.upsert(request.job_id, "failed", str(exc), response.model_dump())
        return

    response = GenerationResponse(
        job_id=request.job_id,
        status="ready",
        output_path=output_path,
        sample_rate=32000,
        backend=None if request.kind == "fixture" else result.backend,
        device=None if request.kind == "fixture" else result.device,
        model=None if request.kind == "fixture" else result.model,
        generation_seconds=None if request.kind == "fixture" else result.generation_seconds,
        validation_metrics=None if request.kind == "fixture" else asdict(result.metrics),
    )
    jobs.upsert(request.job_id, "ready", output_path, response.model_dump(), progress=1.0)


@app.post("/render", response_model=GenerationSubmissionResponse, status_code=202)
def render(request: GenerationRequest) -> GenerationSubmissionResponse:
    existing = jobs.get(request.job_id)
    if existing is not None:
        return GenerationSubmissionResponse(job_id=existing.job_id, status=existing.status, message=existing.message)

    job = jobs.upsert(request.job_id, "queued", f"Queued {request.kind}", progress=0.0)
    _render_executor.submit(_run_render, request)
    return GenerationSubmissionResponse(job_id=job.job_id, status=job.status, message=job.message)


@app.get("/jobs/{job_id}")
def job_status(job_id: str) -> dict:
    job = jobs.snapshot(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown render job")
    return asdict(job)


@app.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str) -> dict:
    job = jobs.request_cancel(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown render job")
    snapshot = jobs.snapshot(job_id)
    return asdict(snapshot or job)


@app.post("/separate", response_model=SeparationResponse)
def separate(request: SeparationRequest) -> SeparationResponse:
    try:
        result = separate_stem(
            request.source_stem_path,
            request.bundle_path,
            model=request.model,
            model_cache_path=request.model_cache_path,
        )
        return SeparationResponse(bundle_id=request.bundle_id, status="ready", **result.to_dict())
    except SeparationError as exc:
        return SeparationResponse(bundle_id=request.bundle_id, status="failed", error_code=exc.code, error=str(exc))
    except Exception as exc:
        return SeparationResponse(bundle_id=request.bundle_id, status="failed", error_code="separation_failed", error=str(exc))


@app.post("/separation-merge", response_model=SeparationMergeResponse)
def separation_merge(request: SeparationMergeRequest) -> SeparationMergeResponse:
    try:
        result = merge_separated_outputs(
            request.output_paths,
            request.destination_path,
            input_gains_db=request.input_gains_db or None,
        )
        return SeparationMergeResponse(merge_id=request.merge_id, status="ready", **asdict(result))
    except SeparationError as exc:
        return SeparationMergeResponse(merge_id=request.merge_id, status="failed", error_code=exc.code, error=str(exc))
    except Exception as exc:
        return SeparationMergeResponse(merge_id=request.merge_id, status="failed", error_code="merge_failed", error=str(exc))


@app.post("/midi/text", response_model=TextToMidiResponse)
def text_to_midi(request: TextToMidiRequest) -> TextToMidiResponse:
    try:
        outputs = generate_text_midi(
            prompt=request.prompt,
            output_directory=request.output_directory,
            quantity=request.quantity,
            model_repo_path=request.model_repo_path,
            python_executable=request.python_executable,
        )
        return TextToMidiResponse(status="ready", outputs=[asdict(output) for output in outputs])
    except Exception as exc:
        return TextToMidiResponse(status="failed", error_code=_midi_error_code(exc), error=str(exc))


@app.post("/midi/guide-wav", response_model=MidiGuideWavResponse)
def midi_guide_wav(request: MidiGuideWavRequest) -> MidiGuideWavResponse:
    try:
        result = midi_to_clean_guide_wav(request.midi_path, request.output_wav_path, request.sample_rate)
        return MidiGuideWavResponse(status="ready", **asdict(result))
    except Exception as exc:
        return MidiGuideWavResponse(status="failed", error_code=_midi_error_code(exc), error=str(exc))


@app.post("/midi/from-audio", response_model=AudioToMidiResponse)
def convert_audio_to_midi(request: AudioToMidiRequest) -> AudioToMidiResponse:
    try:
        result = audio_to_midi(request.source_audio_path, request.output_midi_path, mode=request.mode)
        return AudioToMidiResponse(status="ready", mode=request.mode, **asdict(result))
    except Exception as exc:
        return AudioToMidiResponse(status="failed", mode=request.mode, error_code=_midi_error_code(exc), error=str(exc))
