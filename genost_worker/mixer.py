from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SkippedClip:
    clip_id: str
    reason: str


def describe_skipped_clip(clip_id: str, reason: str) -> SkippedClip:
    return SkippedClip(clip_id=clip_id, reason=reason)
