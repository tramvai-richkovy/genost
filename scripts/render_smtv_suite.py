#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import uuid
from dataclasses import asdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from genost_worker.audiocraft_generator import (  # noqa: E402
    AudioContentCategory,
    DEFAULT_MELODY_MODEL,
    DEFAULT_TEXT_MODEL,
    GeneratorError,
    clear_model_cache,
    generate_with_metadata,
    validate_generated_audio,
)
from genost_worker.persistence import (  # noqa: E402
    append_command,
    content_hash,
    now_iso,
    read_json,
    transition_stem,
    write_json_atomic,
    write_stem_sidecar,
)
from genost_worker.separation import SEPARATION_MODEL, SeparationError, separate_stem  # noqa: E402

PROJECTS_ROOT = Path(os.environ.get("GENOST_SMTV_PROJECTS_ROOT", ROOT.parent / "ost_drafts"))
PROJECT_FOLDERS = (
    "smtv Sketch 01",
    "smtv Sketch 02 - Salt Glass Shinagawa",
    "smtv Sketch 03 - Iron Basilica Chiyoda",
    "smtv Sketch 04 - Godless Ueno Spiral",
    "smtv Sketch 05 - Shinjuku Wound Array",
)
SAMPLE_RATE = 32000
SAFE_RENDER_SECONDS = 29
CROSSFADE_SECONDS = 0.05
MAX_INCOMPLETE_SEPARATION_REGENERATIONS = 3
SMTV_VALIDATION_CATEGORY_BLOCKS: dict[AudioContentCategory, frozenset[str]] = {
    "bass_drone": frozenset(
        {
            "Atmosphere",
            "Bass Toms",
            "Salt Glass Pad",
            "Sludge Tide Bass",
            "Breathing Choir Grain",
            "Siege Drone",
            "Castle Gate Choir",
            "Acid Oracle Bass",
            "Ueno Dust Organ",
            "Seraphic Sub Choir",
            "Lost Deity Bass",
            "Fogged Highrise Pad",
            "Vengeance Subline",
            "Kabukicho Static Veil",
        }
    ),
    "rhythm": frozenset(
        {
            "Percussion Organic Layer",
            "Beat",
            "Container Pulse",
            "Rail Noise Bloom",
            "War Machine Kick",
            "Magatsuhi Pillar Toms",
            "Asakusa Spiral Pulse",
            "Mythic Tom Spiral",
            "Final Gate Dust",
            "Broken Neon Drums",
            "Rail Slice FX",
        }
    ),
    "melody": frozenset(
        {
            "Horn",
            "Melody",
            "Guitar ambient lead",
            "Choir Stabs",
            "Fairy Bell Codes",
            "Worn Guitar Harmonics",
            "Analog Basilica Alarm",
            "Scraped Guitar Swarm",
            "Broken Edict Bell",
            "Shrine Bell Coordinates",
            "Frozen Guitar Halo",
            "Wordless Cut Choir",
            "Apartment Feedback Guitar",
            "Null Saint Piano",
        }
    ),
}


def validation_category_for_block(block: dict[str, Any]) -> AudioContentCategory:
    declared = block.get("validationCategory")
    if declared in SMTV_VALIDATION_CATEGORY_BLOCKS:
        return declared
    matches = [category for category, names in SMTV_VALIDATION_CATEGORY_BLOCKS.items() if block["name"] in names]
    if len(matches) != 1:
        raise RuntimeError(f"SMTV block {block['name']!r} must have exactly one validation category; found {matches}")
    return matches[0]


def repo_relative(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def project_path(folder: str, projects_root: Path) -> Path:
    return projects_root / folder


def project_file(project: Path) -> Path:
    return project / "genost.json"


def journal_file(project: Path) -> Path:
    return project / "commands.json"


def require_tools() -> None:
    missing = [tool for tool in ("ffmpeg", "ffprobe") if shutil.which(tool) is None]
    if missing:
        raise RuntimeError(f"Missing required audio tool(s): {', '.join(missing)}")


def expand_output_path(path: str) -> Path:
    output = Path(path).expanduser()
    if not output.is_absolute():
        output = (Path.cwd() / output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    return output


def validate_projects_root(projects_root: Path) -> None:
    missing = [folder for folder in PROJECT_FOLDERS if not project_file(project_path(folder, projects_root)).exists()]
    if missing:
        raise RuntimeError(f"Missing SMTV GENOST project(s) under {projects_root}: {', '.join(missing)}")


def bars_to_seconds(bars: int, bpm: int, beats_per_bar: int) -> float:
    return bars * beats_per_bar * 60 / bpm


def effective_time_signature(project: dict[str, Any], block: dict[str, Any]) -> list[int]:
    return block.get("timeSignature") or project["song"]["timeSignature"]


def format_time_signature(time_signature: list[int]) -> str:
    return f"{time_signature[0]}/{time_signature[1]}"


def format_swing(swing: dict[str, Any]) -> str:
    ratio = float(swing["ratio"])
    first = ratio / (ratio + 1) * 100
    second = 100 - first
    labels = {
        "straight": "Straight time",
        "soft": "Soft swing",
        "triplet": "Triplet swing",
        "hard": "Hard swing",
    }
    return f"{labels.get(swing['feel'], swing['feel'])} {ratio:.2f}:1 ({first:.1f}% / {second:.1f}%)"


def block_prompt_text(block: dict[str, Any]) -> str:
    return " ".join(
        str(part)
        for part in (
            block.get("name", ""),
            block.get("role", ""),
            block.get("melodyDescription", ""),
            block.get("melodyPrompt", ""),
            block.get("rhythmFeel", ""),
            block.get("timbre", ""),
            *block.get("instruments", []),
        )
        if part
    ).lower()


def instrument_focus_instruction(block: dict[str, Any]) -> str:
    instruments = ", ".join(block.get("instruments", []))
    if not instruments:
        return "generate one isolated arrangement stem, not a complete backing track"

    text = block_prompt_text(block)
    excluded: list[str]
    if any(word in text for word in ("bass", "sub", "reese", "low end")):
        excluded = ["kick drums", "snare", "hi-hats", "percussion loops", "synth pads", "lead melodies"]
    elif any(word in text for word in ("drum", "kick", "snare", "hat", "break", "percussion", "perc", "tom")):
        excluded = ["basslines", "sub bass", "synth pads", "chord progressions", "lead melodies", "choirs"]
    elif any(word in text for word in ("pad", "chord", "harmony", "harmonic", "atmosphere", "atmospheric", "drone")):
        excluded = ["kick drums", "snare", "hi-hats", "percussion loops", "basslines", "lead riffs"]
    elif any(word in text for word in ("lead", "melody", "melodic", "hook", "arp", "bell", "pluck", "guitar")):
        excluded = ["kick drums", "snare", "hi-hats", "full drum kit", "basslines", "pad washes"]
    elif any(word in text for word in ("choir", "voice", "vocal")):
        excluded = ["lyrics", "kick drums", "snare", "basslines", "lead synths"]
    else:
        excluded = ["full drum kit", "basslines", "lead melodies", "extra instruments"]

    return f"isolated stem target: {instruments} only; keep unrelated arrangement parts out; avoid {', '.join(excluded)}"


def sanitize_file_stem(value: str) -> str:
    cleaned = "".join(char.lower() if char.isalnum() else "_" for char in value)
    cleaned = "_".join(part for part in cleaned.split("_") if part)
    return cleaned[:80] or "genost_audio"


def resolve_project_file(project: Path, file_path: str | None) -> Path | None:
    if not file_path:
        return None
    path = Path(file_path)
    return path if path.is_absolute() else project / path


def relative_to_project(project: Path, path: Path) -> str:
    return str(path.relative_to(project))


def all_clips(project: dict[str, Any]) -> list[dict[str, Any]]:
    clips: list[dict[str, Any]] = []
    for lane_index, lane in enumerate(project["arrangement"]["lanes"]):
        for clip_index, clip in enumerate(lane["clips"]):
            clips.append({**clip, "_laneIndex": lane_index, "_clipIndex": clip_index})
    return sorted(clips, key=lambda item: (item["startBar"], item["_laneIndex"], item["_clipIndex"]))


def find_block(project: dict[str, Any], block_id: str) -> dict[str, Any]:
    for block in project["blocks"]:
        if block["id"] == block_id:
            return block
    raise KeyError(f"Unknown block id: {block_id}")


def latest_ready_stem_for_block(project: dict[str, Any], block_id: str, project_dir: Path) -> dict[str, Any] | None:
    candidates = []
    for stem in project["stems"]:
        if stem["blockId"] != block_id or stem["variation"] != 1 or stem["status"] != "ready":
            continue
        path = resolve_project_file(project_dir, stem.get("filePath"))
        if path and path.exists():
            candidates.append(stem)
    return sorted(candidates, key=lambda item: item["updatedAt"], reverse=True)[0] if candidates else None


def recover_interrupted_renders(project_dir: Path) -> int:
    project = read_json(project_file(project_dir))
    interrupted_ids = [stem["id"] for stem in project["stems"] if stem["status"] == "rendering"]
    if not interrupted_ids:
        return 0

    journal = read_json(journal_file(project_dir))
    before_hash = content_hash(project)
    for stem_id in interrupted_ids:
        project = transition_stem(
            project,
            stem_id,
            "canceled",
            queueOrder=None,
            error="Interrupted before audio publication.",
        )
    journal = append_command(
        journal,
        command_type="render_components_recovered",
        summary=f"Canceled {len(interrupted_ids)} interrupted component render(s)",
        payload={"stemIds": interrupted_ids, "reason": "interrupted_before_audio_publication"},
        before_hash=before_hash,
        after_hash=content_hash(project),
    )
    write_json_atomic(project_file(project_dir), project)
    write_json_atomic(journal_file(project_dir), journal)
    print(f"recovered interrupted renders: {project['title']} count={len(interrupted_ids)}", flush=True)
    return len(interrupted_ids)


def compose_stem_prompt(project: dict[str, Any], block: dict[str, Any], variation: int, bars: int, duration: float) -> str:
    time_signature = effective_time_signature(project, block)
    song = project["song"]
    genre_references = ", ".join(song.get("genreReferences", []))
    parts = [
        f"block: {block['name']}",
        f"role: {block['role']}" if block.get("role") else "",
        instrument_focus_instruction(block),
        block.get("melodyPrompt", ""),
        block.get("melodyDescription", ""),
        f"target instruments: {', '.join(block.get('instruments', []))}",
        f"rhythm feel: {block['rhythmFeel']}" if block.get("rhythmFeel") else "",
        f"timbre: {block['timbre']}" if block.get("timbre") else "",
        f"sound character: {block['soundCharacter']}",
        f"energy {block['energy']}/10",
        f"density {block['density']}/10",
        f"avoid in this block: {block['avoid']}" if block.get("avoid") else "",
        "project context",
        f"{song['bpm']} BPM",
        song["key"],
        f"{format_time_signature(time_signature)} time",
        f"swing: {format_swing(song['swing'])}",
        f"genres: {genre_references}" if genre_references else "",
        f"mood: {song['mood']}" if song.get("mood") else "",
        f"production: {song['productionNotes']}" if song.get("productionNotes") else "",
        f"palette: {song['sonicPalette']}" if song.get("sonicPalette") else "",
        f"project direction: {song['prompt']}"
        if not genre_references and not song.get("mood") and not song.get("productionNotes")
        else "",
        f"variation {variation}",
        f"{bars} arranged bar{'s' if bars != 1 else ''}",
        f"{duration:.2f} seconds",
    ]
    return "; ".join(part for part in parts if part)


def compose_requirement_prompt(project: dict[str, Any], requirement: dict[str, Any]) -> str:
    prompt = compose_stem_prompt(
        project,
        requirement["block"],
        requirement["variation"],
        requirement["bars"],
        requirement["durationSeconds"],
    )
    if requirement.get("variationAnchor"):
        return f"make variation of this stem; requirements: {prompt}"
    return prompt


def requirement_seed(project: dict[str, Any], block: dict[str, Any], variation: int, bars: int, input_stem_id: str | None, attempt: int) -> int:
    value = content_hash(
        {
            "projectId": project["id"],
            "blockId": block["id"],
            "variation": variation,
            "bars": bars,
            "inputStemId": input_stem_id,
            "attempt": attempt,
        }
    )
    return int(value[:8], 16) & 0x7FFFFFFF


def requirement_hash(
    project: dict[str, Any],
    block: dict[str, Any],
    variation: int,
    bars: int,
    input_stem_id: str | None,
    seed: int,
) -> str:
    return content_hash(
        {
            "promptCompositionVersion": 3,
            "projectPrompt": project["song"]["prompt"],
            "bpm": project["song"]["bpm"],
            "key": project["song"]["key"],
            "swing": project["song"]["swing"],
            "timeSignature": effective_time_signature(project, block),
            "sampleRate": project["song"]["sampleRate"],
            "block": {
                "id": block["id"],
                "sourceType": block["sourceType"],
                "importedStemId": block["importedStemId"],
                "bars": bars,
                "timeSignature": block["timeSignature"],
                "role": block["role"],
                "instruments": block["instruments"],
                "soundCharacter": block["soundCharacter"],
                "melodyDescription": block["melodyDescription"],
                "melodyPrompt": block["melodyPrompt"],
                "rhythmFeel": block["rhythmFeel"],
                "timbre": block["timbre"],
                "energy": block["energy"],
                "density": block["density"],
                "avoid": block["avoid"],
                "volumeDb": block["volumeDb"],
                "delaySend": block["delaySend"],
                "reverbSend": block["reverbSend"],
                "compressorEnabled": block["compressorEnabled"],
            },
            "variation": variation,
            "inputStemId": input_stem_id,
            "seed": seed,
        }
    )[:16]


def existing_ready_stem(
    project: dict[str, Any],
    project_dir: Path,
    block_id: str,
    variation: int,
    input_stem_id: str | None,
    duration_seconds: float,
) -> dict[str, Any] | None:
    candidates = []
    for stem in project["stems"]:
        path = resolve_project_file(project_dir, stem.get("filePath"))
        if (
            stem["blockId"] == block_id
            and stem["variation"] == variation
            and stem["inputStemId"] == input_stem_id
            and stem["status"] == "ready"
            and path
            and path.exists()
            and abs(float(stem["durationSeconds"]) - round(duration_seconds)) < 0.15
        ):
            candidates.append(stem)
    return sorted(candidates, key=lambda item: item["updatedAt"], reverse=True)[0] if candidates else None


def collect_requirements(project: dict[str, Any], project_dir: Path) -> list[dict[str, Any]]:
    requirements_by_key: dict[tuple[Any, ...], dict[str, Any]] = {}

    for clip in all_clips(project):
        block = find_block(project, clip["blockId"])
        if block["sourceType"] == "imported":
            continue
        time_signature = effective_time_signature(project, block)
        duration = bars_to_seconds(clip["bars"], project["song"]["bpm"], time_signature[0])
        source_stem = latest_ready_stem_for_block(project, clip["inputBlockId"], project_dir) if clip.get("inputBlockId") else None
        input_stem_id = source_stem["id"] if source_stem else None
        key = (block["id"], clip["variation"], clip["bars"], clip.get("inputBlockId"), input_stem_id)
        requirement = requirements_by_key.get(key)
        if not requirement:
            requirement = {
                "key": key,
                "block": block,
                "validationCategory": validation_category_for_block(block),
                "variation": clip["variation"],
                "bars": clip["bars"],
                "durationSeconds": duration,
                "inputBlockId": clip.get("inputBlockId"),
                "inputStemId": input_stem_id,
                "inputStem": source_stem,
                "inputMissing": bool(clip.get("inputBlockId") and not source_stem),
                "waitingFor": find_block(project, clip["inputBlockId"])["name"] if clip.get("inputBlockId") and not source_stem else None,
                "variationAnchor": False,
                "variationAnchorStemId": None,
                "clips": [],
                "existingStem": existing_ready_stem(project, project_dir, block["id"], clip["variation"], input_stem_id, duration),
            }
            requirements_by_key[key] = requirement
        requirement["clips"].append(clip)

    requirements = list(requirements_by_key.values())
    anchors = {
        (item["block"]["id"], item["bars"], item["inputBlockId"]): item
        for item in requirements
        if item["variation"] == 1
    }

    for requirement in requirements:
        if requirement["variation"] == 1:
            continue
        anchor = anchors.get((requirement["block"]["id"], requirement["bars"], requirement["inputBlockId"]))
        if not anchor:
            continue
        anchor_stem = anchor["existingStem"]
        requirement["variationAnchor"] = True
        requirement["variationAnchorStemId"] = anchor_stem["id"] if anchor_stem else None
        requirement["inputStemId"] = anchor_stem["id"] if anchor_stem else None
        requirement["inputStem"] = anchor_stem
        requirement["inputMissing"] = anchor_stem is None
        requirement["waitingFor"] = f"{requirement['block']['name']} v1" if not anchor_stem else None
        requirement["key"] = (
            requirement["block"]["id"],
            requirement["variation"],
            requirement["bars"],
            requirement["inputBlockId"],
            "variation-anchor",
            requirement["inputStemId"],
        )
        requirement["existingStem"] = (
            existing_ready_stem(
                project,
                project_dir,
                requirement["block"]["id"],
                requirement["variation"],
                requirement["inputStemId"],
                requirement["durationSeconds"],
            )
            if anchor_stem
            else None
        )

    return sorted(requirements, key=lambda item: (item["variation"] != 1, item["variation"]))


def update_clips_for_stem(project: dict[str, Any], clip_ids: set[str], stem_id: str, input_stem_id: str | None) -> dict[str, Any]:
    return {
        **project,
        "arrangement": {
            "lanes": [
                {
                    **lane,
                    "clips": [
                        {**clip, "stemId": stem_id, "inputStemId": input_stem_id} if clip["id"] in clip_ids else clip
                        for clip in lane["clips"]
                    ],
                }
                for lane in project["arrangement"]["lanes"]
            ]
        },
    }


def sync_existing_stems(project_dir: Path) -> bool:
    project = read_json(project_file(project_dir))
    changed = False

    for requirement in collect_requirements(project, project_dir):
        stem = requirement["existingStem"]
        if not stem:
            continue
        clip_ids = {clip["id"] for clip in requirement["clips"]}
        for clip in all_clips(project):
            if clip["id"] in clip_ids and (clip.get("stemId") != stem["id"] or clip.get("inputStemId") != requirement["inputStemId"]):
                changed = True
                break
        if changed:
            project = update_clips_for_stem(project, clip_ids, stem["id"], requirement["inputStemId"])

    if changed:
        project["updatedAt"] = now_iso()
        write_json_atomic(project_file(project_dir), project)
    return changed


def unique_stem_path(project_dir: Path, block_name: str, variation: int, prompt_hash: str, seed: int) -> Path:
    base_name = f"{sanitize_file_stem(block_name)}_v{variation:02d}_{prompt_hash}_s{seed}"
    candidate = project_dir / "STEMS" / f"{base_name}.wav"
    if not candidate.exists() and not candidate.with_suffix(".json").exists():
        return candidate
    for index in range(2, 100):
        candidate = project_dir / "STEMS" / f"{base_name}_{index}.wav"
        if not candidate.exists() and not candidate.with_suffix(".json").exists():
            return candidate
    raise RuntimeError(f"Could not allocate a unique stem path for {block_name} v{variation}")


def mark_rendering(
    project_dir: Path,
    requirement: dict[str, Any],
    stem_id: str,
    prompt_hash: str,
    seed: int,
    output: Path,
) -> None:
    project = read_json(project_file(project_dir))
    timestamp = now_iso()
    stem = {
        "id": stem_id,
        "blockId": requirement["block"]["id"],
        "variation": requirement["variation"],
        "inputStemId": requirement["inputStemId"],
        "model": DEFAULT_MELODY_MODEL if requirement["inputStemId"] else DEFAULT_TEXT_MODEL,
        "promptHash": prompt_hash,
        "seed": seed,
        "durationSeconds": requirement["durationSeconds"],
        "status": "rendering",
        "queueOrder": None,
        "fileName": output.name,
        "filePath": None,
        "archivePath": None,
        "revisionOfStemId": requirement["existingStem"]["id"] if requirement.get("existingStem") else None,
        "staleReason": None,
        "error": None,
        "createdAt": timestamp,
        "updatedAt": timestamp,
    }
    project["stems"] = [*project["stems"], stem]
    project["updatedAt"] = timestamp
    write_json_atomic(project_file(project_dir), project)


def finish_render(
    project_dir: Path,
    requirement: dict[str, Any],
    stem_id: str,
    output: Path,
    result: Any,
    prompt: str,
    prompt_hash: str,
    seed: int,
) -> None:
    project = read_json(project_file(project_dir))
    journal = read_json(journal_file(project_dir))
    before_hash = content_hash(project)
    timestamp = now_iso()
    settings = {
        "backend": result.backend,
        "device": result.device,
        "durationSeconds": requirement["durationSeconds"],
        "sampleRate": result.metrics.sample_rate,
        "seed": seed,
        "validationProfile": "music",
        "validationCategory": requirement["validationCategory"],
    }
    metadata = {
        "schemaVersion": 1,
        "id": stem_id,
        "blockId": requirement["block"]["id"],
        "variation": requirement["variation"],
        "inputStemId": requirement["inputStemId"],
        "inputStemPath": None
        if not requirement["inputStem"]
        else requirement["inputStem"].get("filePath"),
        "prompt": prompt,
        "promptHash": prompt_hash,
        "backend": result.backend,
        "model": result.model,
        "seed": seed,
        "durationSeconds": result.metrics.duration_seconds,
        "sampleRate": result.metrics.sample_rate,
        "device": result.device,
        "generationSettings": settings,
        "validationMetrics": asdict(result.metrics),
        "validationCategory": requirement["validationCategory"],
        "generationSeconds": result.generation_seconds,
        "filePath": relative_to_project(project_dir, output),
        "generatedAt": timestamp,
        "creativeDirection": "Original SMTV-inspired GENOST project render; no copyrighted reference audio was used.",
    }
    write_stem_sidecar(output, metadata)
    clip_ids = {clip["id"] for clip in requirement["clips"]}
    updated = update_clips_for_stem(project, clip_ids, stem_id, requirement["inputStemId"])
    updated["updatedAt"] = timestamp
    updated["stems"] = [
        {
            **stem,
            "status": "ready",
            "filePath": relative_to_project(project_dir, output),
            "durationSeconds": result.metrics.duration_seconds,
            "updatedAt": timestamp,
        }
        if stem["id"] == stem_id
        else stem
        for stem in updated["stems"]
    ]
    updated["blocks"] = [
        {
            **block,
            "implementedMelodies": [
                *[
                    melody
                    for melody in block.get("implementedMelodies", [])
                    if melody.get("stemId") != stem_id
                ],
                {
                    "id": f"melody_{uuid.uuid4()}",
                    "stemId": stem_id,
                    "textMetadata": prompt,
                    "createdAt": timestamp,
                },
            ],
        }
        if block["id"] == requirement["block"]["id"]
        else block
        for block in updated["blocks"]
    ]
    journal = append_command(
        journal,
        command_type="render_component_completed",
        summary=f"Rendered {requirement['block']['name']} v{requirement['variation']}",
        payload={
            "stemId": stem_id,
            "blockId": requirement["block"]["id"],
            "variation": requirement["variation"],
            "bars": requirement["bars"],
            "durationSeconds": result.metrics.duration_seconds,
            "filePath": relative_to_project(project_dir, output),
            "inputStemId": requirement["inputStemId"],
        },
        before_hash=before_hash,
        after_hash=content_hash(updated),
    )
    write_json_atomic(project_file(project_dir), updated)
    write_json_atomic(journal_file(project_dir), journal)


def fail_render(project_dir: Path, stem_id: str, error: Exception) -> None:
    project = read_json(project_file(project_dir))
    journal = read_json(journal_file(project_dir))
    before_hash = content_hash(project)
    timestamp = now_iso()
    updated = {
        **project,
        "updatedAt": timestamp,
        "stems": [
            {**stem, "status": "failed", "queueOrder": None, "error": str(error), "updatedAt": timestamp}
            if stem["id"] == stem_id
            else stem
            for stem in project["stems"]
        ],
    }
    journal = append_command(
        journal,
        command_type="render_component_failed",
        summary="Component render failed",
        payload={"stemId": stem_id, "error": str(error)},
        before_hash=before_hash,
        after_hash=content_hash(updated),
    )
    write_json_atomic(project_file(project_dir), updated)
    write_json_atomic(journal_file(project_dir), journal)


def render_requirement(
    project_dir: Path,
    requirement: dict[str, Any],
    backend: str,
    *,
    seed_attempt_offset: int = 0,
) -> None:
    project = read_json(project_file(project_dir))
    block = requirement["block"]
    duration = requirement["durationSeconds"]
    if duration > SAFE_RENDER_SECONDS:
        raise RuntimeError(
            f"{project['title']} / {block['name']} v{requirement['variation']} is {duration:.2f}s; "
            f"MusicGen guard is {SAFE_RENDER_SECONDS}s"
        )

    failures = []
    for attempt in range(seed_attempt_offset + 1, seed_attempt_offset + 4):
        seed = requirement_seed(project, block, requirement["variation"], requirement["bars"], requirement["inputStemId"], attempt)
        prompt_hash = requirement_hash(project, block, requirement["variation"], requirement["bars"], requirement["inputStemId"], seed)
        output = unique_stem_path(project_dir, block["name"], requirement["variation"], prompt_hash, seed)
        stem_id = f"stem_{uuid.uuid4()}"
        prompt = compose_requirement_prompt(project, requirement)
        mark_rendering(project_dir, requirement, stem_id, prompt_hash, seed, output)
        try:
            print(
                f"render {project['title']}: {block['name']} v{requirement['variation']} "
                f"category={requirement['validationCategory']} seed={seed}",
                flush=True,
            )
            result = generate_with_metadata(
                kind="conditioned" if requirement["inputStemId"] else "text",
                prompt=prompt,
                duration_seconds=int(round(duration)),
                output_path=str(output),
                model_name=project["song"]["defaultTextModel"],
                reference_audio_path=None
                if not requirement["inputStem"]
                else str(resolve_project_file(project_dir, requirement["inputStem"].get("filePath"))),
                model_cache_path=project["song"].get("modelCachePath") or None,
                seed=seed,
                backend=backend,
                validation_profile="music",
                content_category=requirement["validationCategory"],
            )
            finish_render(project_dir, requirement, stem_id, output, result, prompt, prompt_hash, seed)
            return
        except Exception as exc:
            failures.append({"attempt": attempt, "seed": seed, "error": str(exc)})
            fail_render(project_dir, stem_id, exc)
            print(f"rejected {project['title']}: {block['name']} v{requirement['variation']}: {exc}", flush=True)

    report = project_dir / "JOBS" / f"smtv_render_failures_{sanitize_file_stem(block['name'])}_v{requirement['variation']:02d}.json"
    write_json_atomic(report, {"createdAt": now_iso(), "requirement": str(requirement["key"]), "failures": failures})
    raise GeneratorError(f"No valid candidate for {block['name']} v{requirement['variation']}; see {report}")


def render_project(project_dir: Path, backend: str) -> None:
    recover_interrupted_renders(project_dir)
    while True:
        sync_existing_stems(project_dir)
        project = read_json(project_file(project_dir))
        requirements = collect_requirements(project, project_dir)
        pending = [item for item in requirements if not item["existingStem"]]
        if not pending:
            print(f"rendered project stems: {project['title']}", flush=True)
            return
        ready = [item for item in pending if not item["inputMissing"]]
        if not ready:
            missing = [
                f"{item['block']['name']} v{item['variation']} waits for {item['waitingFor'] or item['inputBlockId']}"
                for item in pending
            ]
            raise RuntimeError(f"Render dependency deadlock in {project['title']}: {missing}")
        render_requirement(project_dir, ready[0], backend)


def _regeneration_for_incomplete_separation(
    project: dict[str, Any],
    project_dir: Path,
    stem_id: str,
    error: SeparationError,
) -> tuple[dict[str, Any], dict[str, Any]] | None:
    requirement = next(
        (
            item
            for item in collect_requirements(project, project_dir)
            if item.get("existingStem") and item["existingStem"]["id"] == stem_id
        ),
        None,
    )
    if not requirement or requirement["block"]["sourceType"] != "generated":
        return None

    affected_ids = {stem_id}
    queue = [stem_id]
    while queue:
        input_stem_id = queue.pop(0)
        for stem in project["stems"]:
            if stem.get("inputStemId") == input_stem_id and stem["id"] not in affected_ids:
                affected_ids.add(stem["id"])
                queue.append(stem["id"])

    timestamp = now_iso()
    stale_reason = f"Input stem {stem_id} failed mandatory six-output separation and must be regenerated."
    updated_stems = []
    for stem in project["stems"]:
        if stem["id"] == stem_id:
            updated_stems.append(
                {
                    **stem,
                    "status": "failed",
                    "queueOrder": None,
                    "staleReason": "Mandatory six-output separation failed.",
                    "error": str(error),
                    "updatedAt": timestamp,
                }
            )
        elif stem["id"] in affected_ids and stem["status"] in {"queued", "rendering", "ready"}:
            updated_stems.append(
                {
                    **stem,
                    "status": "stale",
                    "queueOrder": None,
                    "staleReason": stale_reason,
                    "updatedAt": timestamp,
                }
            )
        else:
            updated_stems.append(stem)

    retry_key = (
        requirement["block"]["id"],
        requirement["variation"],
        requirement["bars"],
        requirement["inputStemId"],
    )
    regeneration = {
        "retryKey": retry_key,
        "requirement": requirement,
        "sourceStemId": stem_id,
        "downstreamStemIds": sorted(affected_ids - {stem_id}),
        "projectTitle": project["title"],
        "blockName": requirement["block"]["name"],
        "variation": requirement["variation"],
    }
    return regeneration, {**project, "stems": updated_stems, "updatedAt": timestamp}


def separate_project_stems(project_dir: Path) -> dict[str, Any] | None:
    project = read_json(project_file(project_dir))
    existing_source_ids = {
        bundle["sourceStemId"]
        for bundle in project.get("separationBundles", [])
        if bundle.get("status") == "ready"
    }
    sources, _skipped = mix_sources(project, project_dir)
    unique_sources = {item["stem"]["id"]: item for item in sources}
    for stem_id, source in unique_sources.items():
        if stem_id in existing_source_ids:
            continue
        bundle_id = f"separation_{uuid.uuid4()}"
        bundle_dir = project_dir / "STEMS" / "SEPARATIONS" / bundle_id
        block = source["block"]
        try:
            result = separate_stem(source["path"], bundle_dir, model=SEPARATION_MODEL)
        except SeparationError as exc:
            latest = read_json(project_file(project_dir))
            journal = read_json(journal_file(project_dir))
            before_hash = content_hash(latest)
            timestamp = now_iso()
            failed_bundle = {
                "id": bundle_id,
                "blockId": block["id"],
                "sourceStemId": stem_id,
                "rawStemPath": relative_to_project(project_dir, source["path"]),
                "model": SEPARATION_MODEL,
                "preferredTarget": block["separatorTarget"],
                "status": "failed",
                "selectedOutputIds": [],
                "outputs": [],
                "merges": [],
                "previewMetadata": {},
                "errorCode": exc.code,
                "error": str(exc),
                "createdAt": timestamp,
                "updatedAt": timestamp,
            }
            updated = {**latest, "updatedAt": timestamp, "separationBundles": [*latest.get("separationBundles", []), failed_bundle]}
            regeneration = (
                _regeneration_for_incomplete_separation(updated, project_dir, stem_id, exc)
                if exc.code == "separator_outputs_incomplete"
                else None
            )
            if regeneration:
                regeneration_details, updated = regeneration
            journal = append_command(
                journal,
                command_type="separate_stem_failed",
                summary=f"Separation failed for {block['name']}",
                payload={
                    "bundleId": bundle_id,
                    "sourceStemId": stem_id,
                    "errorCode": exc.code,
                    "error": str(exc),
                    "regenerationRequired": bool(regeneration),
                    "downstreamStemIds": regeneration_details["downstreamStemIds"] if regeneration else [],
                },
                before_hash=before_hash,
                after_hash=content_hash(updated),
                actor="worker",
                source="worker",
            )
            write_json_atomic(project_file(project_dir), updated)
            write_json_atomic(journal_file(project_dir), journal)
            if regeneration:
                return regeneration_details
            raise

        latest = read_json(project_file(project_dir))
        journal = read_json(journal_file(project_dir))
        before_hash = content_hash(latest)
        timestamp = now_iso()
        bundle = {
            "id": bundle_id,
            "blockId": block["id"],
            "sourceStemId": stem_id,
            "rawStemPath": relative_to_project(project_dir, source["path"]),
            "model": result.model,
            "preferredTarget": block["separatorTarget"],
            "status": "ready",
            "selectedOutputIds": [],
            "outputs": [
                {
                    "id": f"separated_{uuid.uuid4()}",
                    "label": output.label,
                    "fileName": output.file_name,
                    "filePath": relative_to_project(project_dir, Path(output.file_path)),
                    "status": "ready",
                    "volumeDb": 0,
                    "durationSeconds": output.duration_seconds,
                    "peak": output.peak,
                    "createdAt": timestamp,
                }
                for output in result.outputs
            ],
            "merges": [],
            "previewMetadata": {"outputCount": len(result.outputs), "model": result.model},
            "errorCode": None,
            "error": None,
            "createdAt": timestamp,
            "updatedAt": timestamp,
        }
        updated = {**latest, "updatedAt": timestamp, "separationBundles": [*latest.get("separationBundles", []), bundle]}
        journal = append_command(
            journal,
            command_type="separate_stem_completed",
            summary=f"Published six-stem bundle for {block['name']}",
            payload={"bundleId": bundle_id, "sourceStemId": stem_id, "model": result.model, "outputs": bundle["outputs"]},
            before_hash=before_hash,
            after_hash=content_hash(updated),
            actor="worker",
            source="worker",
        )
        write_json_atomic(project_file(project_dir), updated)
        write_json_atomic(journal_file(project_dir), journal)
    return None


def render_project_with_separation(project_dir: Path, backend: str) -> None:
    regeneration_counts: dict[tuple[Any, ...], int] = {}
    render_project(project_dir, backend)
    while True:
        regeneration = separate_project_stems(project_dir)
        if not regeneration:
            return

        retry_key = regeneration["retryKey"]
        regeneration_count = regeneration_counts.get(retry_key, 0) + 1
        regeneration_counts[retry_key] = regeneration_count
        if regeneration_count > MAX_INCOMPLETE_SEPARATION_REGENERATIONS:
            raise SeparationError(
                "separator_regeneration_exhausted",
                f"{regeneration['projectTitle']} / {regeneration['blockName']} v{regeneration['variation']} "
                f"still failed mandatory six-output separation after "
                f"{MAX_INCOMPLETE_SEPARATION_REGENERATIONS} regenerated candidates.",
            )

        print(
            f"regenerate after incomplete separation: {regeneration['projectTitle']}: "
            f"{regeneration['blockName']} v{regeneration['variation']} "
            f"attempt={regeneration_count}/{MAX_INCOMPLETE_SEPARATION_REGENERATIONS}",
            flush=True,
        )
        clear_model_cache()
        render_requirement(
            project_dir,
            regeneration["requirement"],
            backend,
            seed_attempt_offset=regeneration_count * 3,
        )
        render_project(project_dir, backend)


def probe_duration(path: Path) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(result.stdout.strip())


def mix_sources(project: dict[str, Any], project_dir: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    ready = {stem["id"]: stem for stem in project["stems"] if stem["status"] == "ready"}
    sources = []
    skipped = []
    project_bar_seconds = project["song"]["timeSignature"][0] * 60 / project["song"]["bpm"]

    for clip in all_clips(project):
        block = find_block(project, clip["blockId"])
        stem = ready.get(clip.get("stemId"))
        path = resolve_project_file(project_dir, stem.get("filePath")) if stem else None
        if not stem or not path or not path.exists():
            skipped.append({"clipId": clip["id"], "blockId": clip["blockId"], "stemId": clip.get("stemId"), "reason": "missing stem"})
            continue
        sources.append(
            {
                "clip": clip,
                "block": block,
                "stem": stem,
                "path": path,
                "startSeconds": clip["startBar"] * project_bar_seconds,
                "durationSeconds": float(stem["durationSeconds"]),
            }
        )
    return sources, skipped


def build_wav_mix(project: dict[str, Any], project_dir: Path, sources: list[dict[str, Any]]) -> tuple[Path, float]:
    if not sources:
        raise RuntimeError(f"No ready stems to mix for {project['title']}")

    output = project_dir / "MIXES" / f"{sanitize_file_stem(project['title'])}_final.wav"
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(f".{output.stem}.{uuid.uuid4().hex}.tmp.wav")
    total_duration = max(item["startSeconds"] + item["durationSeconds"] for item in sources)
    command = ["ffmpeg", "-hide_banner", "-loglevel", "warning", "-y"]
    for item in sources:
        command.extend(["-i", str(item["path"])])

    filters = []
    for index, item in enumerate(sources):
        delay_ms = max(0, int(round(item["startSeconds"] * 1000)))
        fade_out_start = max(0.0, item["durationSeconds"] - CROSSFADE_SECONDS)
        filters.append(
            f"[{index}:a]aresample={SAMPLE_RATE},aformat=channel_layouts=stereo,"
            f"highpass=f=28,volume={item['block']['volumeDb']}dB,"
            f"afade=t=in:st=0:d={CROSSFADE_SECONDS},"
            f"afade=t=out:st={fade_out_start:.3f}:d={CROSSFADE_SECONDS},"
            f"adelay={delay_ms}|{delay_ms}[a{index}]"
        )

    inputs = "".join(f"[a{index}]" for index in range(len(sources)))
    filters.append(f"{inputs}amix=inputs={len(sources)}:duration=longest:normalize=0[mix]")
    filters.append(
        f"[mix]loudnorm=I=-16:TP=-1.5:LRA=10,volume={project['mix']['outputGainDb']}dB,"
        f"alimiter=limit=0.94,afade=t=in:st=0:d=1,afade=t=out:st={max(0, total_duration - 2):.3f}:d=2[out]"
    )
    command.extend(["-filter_complex", ";".join(filters), "-map", "[out]", "-ar", str(SAMPLE_RATE), "-c:a", "pcm_s24le", str(temporary)])
    try:
        subprocess.run(command, check=True)
        validate_generated_audio(temporary, total_duration, "basic")
        temporary.replace(output)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    return output, probe_duration(output)


def encode_mp3(source_wav: Path, mp3_path: Path, expected_duration: float) -> None:
    temporary = mp3_path.with_name(f".{mp3_path.stem}.{uuid.uuid4().hex}.tmp.mp3")
    try:
        subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "warning",
                "-y",
                "-i",
                str(source_wav),
                "-codec:a",
                "libmp3lame",
                "-b:a",
                "320k",
                "-ar",
                "44100",
                str(temporary),
            ],
            check=True,
        )
        validate_generated_audio(temporary, expected_duration, "basic")
        temporary.replace(mp3_path)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def copy_mp3_to_output(project: dict[str, Any], project_mp3: Path, output_dir: Path) -> Path:
    target = output_dir / f"{project['title']}.mp3"
    temporary = target.with_name(f".{target.stem}.{uuid.uuid4().hex}.tmp.mp3")
    try:
        shutil.copy2(project_mp3, temporary)
        validate_generated_audio(temporary, 1, "basic")
        temporary.replace(target)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    return target


def build_export_and_cleanup(project_dir: Path, output_dir: Path) -> None:
    project = read_json(project_file(project_dir))
    journal = read_json(journal_file(project_dir))
    sources, skipped = mix_sources(project, project_dir)
    mix_wav, duration = build_wav_mix(project, project_dir, sources)
    project_mp3 = project_dir / "MIXES" / f"{sanitize_file_stem(project['title'])}_final.mp3"
    encode_mp3(mix_wav, project_mp3, duration)
    exported = copy_mp3_to_output(project, project_mp3, output_dir)
    mix_wav.unlink(missing_ok=True)

    before_hash = content_hash(project)
    timestamp = now_iso()
    sidecar = project_mp3.with_suffix(".json")
    write_json_atomic(
        sidecar,
        {
            "schemaVersion": 1,
            "projectId": project["id"],
            "sourceStemIds": [item["stem"]["id"] for item in sources],
            "sourcePaths": [relative_to_project(project_dir, item["path"]) for item in sources],
            "skippedClips": skipped,
            "durationSeconds": duration,
            "sampleRate": 44100,
            "bitrateKbps": 320,
            "removedIntermediateWav": relative_to_project(project_dir, mix_wav),
            "exportedPath": str(exported),
            "builtAt": timestamp,
        },
    )
    updated = {
        **project,
        "updatedAt": timestamp,
        "mix": {**project["mix"], "lastBuildPath": relative_to_project(project_dir, project_mp3)},
    }
    journal = append_command(
        journal,
        command_type="build_mix_mp3_completed",
        summary=f"Built and exported MP3 mix {exported.name}",
        payload={
            "projectMp3Path": relative_to_project(project_dir, project_mp3),
            "exportedPath": str(exported),
            "durationSeconds": duration,
            "skippedClips": skipped,
            "removedIntermediateWav": relative_to_project(project_dir, mix_wav),
        },
        before_hash=before_hash,
        after_hash=content_hash(updated),
    )
    write_json_atomic(project_file(project_dir), updated)
    write_json_atomic(journal_file(project_dir), journal)
    print(f"exported mp3: {exported}", flush=True)


def plan(projects_root: Path, output_dir: Path) -> None:
    require_tools()
    validate_projects_root(projects_root)
    print(f"output: {output_dir}")
    for folder in PROJECT_FOLDERS:
        project_dir = project_path(folder, projects_root)
        project = read_json(project_file(project_dir))
        requirements = collect_requirements(project, project_dir)
        too_long = [item for item in requirements if item["durationSeconds"] > SAFE_RENDER_SECONDS]
        print(f"{project['title']}: {len(requirements)} component requirement(s)")
        if too_long:
            for item in too_long:
                print(f"  too long: {item['block']['name']} v{item['variation']} {item['durationSeconds']:.2f}s")
            raise RuntimeError(f"{project['title']} has over-length requirements")


def run(output_dir: Path, projects_root: Path, backend: str) -> None:
    require_tools()
    validate_projects_root(projects_root)
    for folder in PROJECT_FOLDERS:
        project_dir = project_path(folder, projects_root)
        project = read_json(project_file(project_dir))
        print(f"starting project: {project['title']}", flush=True)
        render_project_with_separation(project_dir, backend)
        clear_model_cache()
        build_export_and_cleanup(project_dir, output_dir)
        clear_model_cache()
    print(f"SMTV suite complete: {output_dir}", flush=True)


def start_background(output_dir: Path, projects_root: Path, backend: str) -> None:
    require_tools()
    validate_projects_root(projects_root)
    log_root = projects_root / "JOBS"
    log_root.mkdir(parents=True, exist_ok=True)
    timestamp = now_iso().replace(":", "").replace("-", "")
    log_path = log_root / f"smtv_suite_{timestamp}.log"
    command = [
        sys.executable,
        str(Path(__file__).resolve()),
        "run",
        "--path",
        str(output_dir),
        "--projects-root",
        str(projects_root),
        "--backend",
        backend,
    ]
    env = {**os.environ, "PYTHONUNBUFFERED": "1"}
    with log_path.open("a", encoding="utf-8") as log:
        process = subprocess.Popen(
            command,
            cwd=str(ROOT),
            stdout=log,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
            env=env,
        )
    print(f"started SMTV render worker pid={process.pid}")
    print(f"log: {log_path}")
    print(f"mp3 output: {output_dir}")


def parser() -> argparse.ArgumentParser:
    argument_parser = argparse.ArgumentParser(description="Render the five SMTV-inspired GENOST projects and export MP3 mixes.")
    subparsers = argument_parser.add_subparsers(dest="command", required=True)
    for command in ("start", "run", "plan"):
        subparser = subparsers.add_parser(command)
        subparser.add_argument("--path", required=True, help="Required directory that receives the exported MP3 files.")
        subparser.add_argument("--projects-root", default=str(PROJECTS_ROOT), help="GENOST projects root. Defaults to ../ost_drafts.")
        subparser.add_argument("--backend", default=os.environ.get("GENOST_GENERATION_BACKEND", "auto"), choices=("auto", "mlx", "audiocraft"))
    return argument_parser


def main() -> int:
    args = parser().parse_args()
    output_dir = expand_output_path(args.path)
    projects_root = Path(args.projects_root).expanduser().resolve()

    if args.command == "plan":
        plan(projects_root, output_dir)
    elif args.command == "run":
        run(output_dir, projects_root, args.backend)
    else:
        start_background(output_dir, projects_root, args.backend)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
