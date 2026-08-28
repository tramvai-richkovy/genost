from __future__ import annotations

import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4


StemStatus = Literal[
    "missing",
    "queued",
    "rendering",
    "ready",
    "failed",
    "canceled",
    "stale",
    "superseded",
    "archived",
    "detached",
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def content_hash(value: object) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def read_json(path: str | Path) -> dict[str, Any]:
    with Path(path).open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"Expected a JSON object in {path}")
    return value


def write_json_atomic(path: str | Path, value: object) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f".{target.name}.{uuid4().hex}.tmp")
    try:
        with temporary.open("x", encoding="utf-8") as handle:
            json.dump(value, handle, indent=2)
            handle.write("\n")
            handle.flush()
        temporary.replace(target)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def write_stem_sidecar(audio_path: str | Path, metadata: dict[str, Any]) -> Path:
    audio = Path(audio_path)
    if not audio.exists():
        raise FileNotFoundError(f"Cannot write sidecar for missing audio: {audio}")
    sidecar = audio.with_suffix(".json")
    if sidecar.exists():
        raise FileExistsError(f"Refusing to overwrite an existing stem sidecar: {sidecar}")
    write_json_atomic(sidecar, metadata)
    return sidecar


def archive_stem_pair(
    project_path: str | Path,
    audio_path: str | Path,
    *,
    detached: bool = False,
    reason: str = "rejected",
) -> tuple[Path, Path | None]:
    project = Path(project_path)
    audio = Path(audio_path)
    if not audio.exists():
        raise FileNotFoundError(f"Cannot archive missing stem: {audio}")
    archive = project / "ARCHIVE"
    archive.mkdir(parents=True, exist_ok=True)
    prefix = "DETACHED_" if detached else "REJECTED_"
    suffix = f"_{reason}_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
    archived_audio = archive / f"{prefix}{audio.stem}{suffix}{audio.suffix}"
    if archived_audio.exists():
        raise FileExistsError(f"Archive target already exists: {archived_audio}")
    shutil.move(str(audio), archived_audio)

    sidecar = audio.with_suffix(".json")
    archived_sidecar: Path | None = None
    if sidecar.exists():
        archived_sidecar = archived_audio.with_suffix(".json")
        shutil.move(str(sidecar), archived_sidecar)
    return archived_audio, archived_sidecar


def transition_stem(project: dict[str, Any], stem_id: str, status: StemStatus, **changes: Any) -> dict[str, Any]:
    stems = project.get("stems")
    if not isinstance(stems, list):
        raise ValueError("Project stems must be a list.")
    found = False
    updated_stems: list[dict[str, Any]] = []
    timestamp = now_iso()
    for stem in stems:
        if isinstance(stem, dict) and stem.get("id") == stem_id:
            updated_stems.append({**stem, **changes, "status": status, "updatedAt": timestamp})
            found = True
        else:
            updated_stems.append(stem)
    if not found:
        raise KeyError(f"Unknown stem id: {stem_id}")
    return {**project, "stems": updated_stems, "updatedAt": timestamp}


def append_command(
    journal: dict[str, Any],
    *,
    command_type: str,
    summary: str,
    payload: dict[str, Any],
    before_hash: str | None = None,
    after_hash: str | None = None,
    actor: str = "code-agent",
    source: str = "code-agent",
) -> dict[str, Any]:
    commands = journal.get("commands")
    if not isinstance(commands, list):
        raise ValueError("Command journal commands must be a list.")
    timestamp = now_iso()
    entry = {
        "id": f"cmd_{uuid4()}",
        "createdAt": timestamp,
        "actor": actor,
        "source": source,
        "type": command_type,
        "summary": summary,
        "payload": payload,
    }
    if before_hash is not None:
        entry["beforeHash"] = before_hash
    if after_hash is not None:
        entry["afterHash"] = after_hash
    return {**journal, "commands": [*commands, entry], "updatedAt": timestamp}
