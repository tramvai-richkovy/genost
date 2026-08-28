from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


GenerationKind = Literal["text", "conditioned", "continuation", "fixture"]
AudioValidationProfile = Literal["basic", "music", "full_mix"]
AudioContentCategory = Literal["generic", "bass_drone", "rhythm", "melody"]
GenerationBackend = Literal["auto", "audiocraft", "mlx"]
AudioToMidiMode = Literal["melodic", "drum"]


class ModelAvailabilityResponse(BaseModel):
    name: str
    available: bool
    cache_paths: list[str] = Field(default_factory=list)
    error: str | None = None
    download_hint: str


class ModelPreflightResponse(BaseModel):
    ok: bool
    backend: str
    device: str
    cache_paths: list[str] = Field(default_factory=list)
    models: dict[str, ModelAvailabilityResponse] = Field(default_factory=dict)
    errors: list[str] = Field(default_factory=list)


class ModelPreflightRequest(BaseModel):
    model_cache_path: str | None = None
    hf_home: str | None = None
    backend: GenerationBackend = "auto"
    device: str | None = None


class HealthResponse(BaseModel):
    ok: bool
    python: str
    torch_available: bool
    mps_available: bool
    audiocraft_available: bool
    torchaudio_available: bool
    ffmpeg_available: bool
    mlx_available: bool
    generation_backend: str
    device: str
    cache_paths: list[str] = Field(default_factory=list)
    medium_model_available: bool = False
    melody_model_available: bool = False
    preflight: ModelPreflightResponse


class GenerationRequest(BaseModel):
    job_id: str = Field(min_length=1)
    kind: GenerationKind
    prompt: str = Field(min_length=1)
    output_path: str = Field(min_length=1)
    duration_seconds: int = Field(ge=1, le=30)
    model_name: str = "facebook/musicgen-medium"
    reference_audio_path: str | None = None
    continuation_start_seconds: int = 15
    seed: int | None = None
    model_cache_path: str | None = None
    hf_home: str | None = None
    device: str | None = None
    backend: GenerationBackend = "auto"
    audio_validation_profile: AudioValidationProfile = "basic"
    audio_content_category: AudioContentCategory = "generic"


class GenerationResponse(BaseModel):
    job_id: str
    status: Literal["ready", "failed"]
    output_path: str | None = None
    sample_rate: int | None = None
    backend: str | None = None
    device: str | None = None
    model: str | None = None
    generation_seconds: float | None = None
    validation_metrics: dict[str, float | int] | None = None
    error_code: str | None = None
    error: str | None = None


class GenerationSubmissionResponse(BaseModel):
    job_id: str
    status: Literal["queued", "rendering", "ready", "failed", "canceled"]
    message: str


class SeparationRequest(BaseModel):
    bundle_id: str = Field(min_length=1)
    source_stem_path: str = Field(min_length=1)
    bundle_path: str = Field(min_length=1)
    model: str = "htdemucs_6s.yaml"
    model_cache_path: str | None = None


class SeparatedOutputResponse(BaseModel):
    label: Literal["bass", "drums", "guitar", "piano", "vocals", "other"]
    file_name: str
    file_path: str
    duration_seconds: float
    peak: float


class SeparationResponse(BaseModel):
    bundle_id: str
    status: Literal["ready", "failed"]
    model: str | None = None
    raw_stem_path: str | None = None
    bundle_path: str | None = None
    outputs: list[SeparatedOutputResponse] = Field(default_factory=list)
    error_code: str | None = None
    error: str | None = None


class SeparationMergeRequest(BaseModel):
    merge_id: str = Field(min_length=1)
    output_paths: list[str] = Field(min_length=1)
    input_gains_db: list[float] = Field(default_factory=list)
    destination_path: str = Field(min_length=1)


class SeparationMergeResponse(BaseModel):
    merge_id: str
    status: Literal["ready", "failed"]
    file_name: str | None = None
    file_path: str | None = None
    duration_seconds: float | None = None
    peak: float | None = None
    error_code: str | None = None
    error: str | None = None


class TextToMidiRequest(BaseModel):
    prompt: str = Field(min_length=1)
    output_directory: str = Field(min_length=1)
    quantity: int = Field(ge=1, le=16)
    model_repo_path: str | None = None
    python_executable: str | None = None


class MidiOutputResponse(BaseModel):
    file_name: str
    file_path: str


class TextToMidiResponse(BaseModel):
    status: Literal["ready", "failed"]
    outputs: list[MidiOutputResponse] = Field(default_factory=list)
    error_code: str | None = None
    error: str | None = None


class MidiGuideWavRequest(BaseModel):
    midi_path: str = Field(min_length=1)
    output_wav_path: str = Field(min_length=1)
    sample_rate: int = Field(default=32000, ge=8000, le=96000)


class MidiGuideWavResponse(BaseModel):
    status: Literal["ready", "failed"]
    file_name: str | None = None
    file_path: str | None = None
    sample_rate: int | None = None
    duration_seconds: float | None = None
    error_code: str | None = None
    error: str | None = None


class AudioToMidiRequest(BaseModel):
    source_audio_path: str = Field(min_length=1)
    output_midi_path: str = Field(min_length=1)
    mode: AudioToMidiMode


class AudioToMidiResponse(BaseModel):
    status: Literal["ready", "failed"]
    file_name: str | None = None
    file_path: str | None = None
    mode: AudioToMidiMode
    error_code: str | None = None
    error: str | None = None
