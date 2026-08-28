from __future__ import annotations

from dataclasses import dataclass, field
from copy import deepcopy
from datetime import datetime, timezone
from threading import RLock
from typing import Any, Literal


JobStatus = Literal["queued", "rendering", "ready", "failed", "canceled"]


@dataclass
class RenderJob:
    job_id: str
    status: JobStatus
    message: str
    details: dict[str, Any] | None = None
    progress: float = 0.0
    cancel_requested: bool = False
    started_at: str | None = None
    finished_at: str | None = None
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class JobStore:
    def __init__(self) -> None:
        self._jobs: dict[str, RenderJob] = {}
        self._lock = RLock()

    def upsert(
        self,
        job_id: str,
        status: JobStatus,
        message: str,
        details: dict[str, Any] | None = None,
        progress: float | None = None,
    ) -> RenderJob:
        with self._lock:
            job = self._jobs.get(job_id)

            if job is None:
                job = RenderJob(
                    job_id=job_id,
                    status=status,
                    message=message,
                    details=details,
                    progress=progress or 0.0,
                )
                self._jobs[job_id] = job
            else:
                job.status = status
                job.message = message
                job.details = details
                if progress is not None:
                    job.progress = max(0.0, min(1.0, progress))
                job.updated_at = datetime.now(timezone.utc).isoformat()

            if status == "rendering" and job.started_at is None:
                job.started_at = job.updated_at
            if status in {"ready", "failed", "canceled"}:
                job.finished_at = job.updated_at

            return job

    def get(self, job_id: str) -> RenderJob | None:
        with self._lock:
            return self._jobs.get(job_id)

    def snapshot(self, job_id: str) -> RenderJob | None:
        with self._lock:
            job = self._jobs.get(job_id)
            return deepcopy(job) if job is not None else None

    def request_cancel(self, job_id: str) -> RenderJob | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job.status in {"ready", "failed", "canceled"}:
                return job
            job.cancel_requested = True
            job.message = "Cancellation requested"
            job.updated_at = datetime.now(timezone.utc).isoformat()
            return job

    def is_cancel_requested(self, job_id: str) -> bool:
        with self._lock:
            return bool(self._jobs.get(job_id) and self._jobs[job_id].cancel_requested)

    def clear(self) -> None:
        with self._lock:
            self._jobs.clear()


jobs = JobStore()
