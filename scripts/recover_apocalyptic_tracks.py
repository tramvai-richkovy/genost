#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from genost_worker.audiocraft_generator import (
    DEFAULT_MELODY_MODEL,
    DEFAULT_TEXT_MODEL,
    GeneratorError,
    clear_model_cache,
    generate_with_metadata,
    validate_generated_audio,
)
from genost_worker.persistence import (
    append_command,
    archive_stem_pair,
    content_hash,
    now_iso,
    read_json,
    write_json_atomic,
    write_stem_sidecar,
)

PROJECTS_ROOT = Path(os.environ.get("GENOST_OUTPUT_ROOT", ROOT / "GENOST_PROJECTS"))
REVISION = "r02"
CLIP_SECONDS = 16
CROSSFADE_SECONDS = 0.75
SAMPLE_RATE = 32000
SEQUENCE = (0, 1, 2, 3, 4, 5, 1, 3, 2, 4, 5, 0)
NAMESPACE = uuid.UUID("09163178-c435-4978-a336-a345fd8f7566")


@dataclass(frozen=True)
class Track:
    slug: str
    title: str
    kind: str
    bpm: int
    key: str
    bars: int
    rhythm: str
    palette: str
    prompts: tuple[str, ...]
    seeds: tuple[int, ...]
    gain_db: float


TRACKS = (
    Track(
        "Ash_Meridian",
        "Ash Meridian",
        "world",
        120,
        "E Phrygian",
        8,
        "measured four-beat pulse, crisp shakers, negative space and small syncopated disruptions",
        "frame drums, shakers, prepared piano, glass synth, bowed metal, clean guitar, granular wind",
        (
            "90s industrial rock instrumental with loud clean guitars, heavy acoustic drums and bright cymbals, 120 BPM, E Phrygian, post-apocalyptic atmosphere, prepared piano signals, glass-synth five-note motif, bowed metal and textured wind, detailed full-frequency game soundtrack mix, no vocals",
            "Evolving dark electronic game music, 120 BPM, E Phrygian, preserve the input motif, dry clean-guitar ostinato, crisp hand percussion, metallic clicks, prepared-piano replies and airy high-frequency texture, instrumental, no vocals",
            "90s industrial rock instrumental variation with loud clean guitars, heavy acoustic drums and bright cymbals, 120 BPM, E Phrygian, follow the input melody with fractured glass synth, syncopated frame drums, shakers and bowed-metal accents, no vocals",
            "90s industrial rock instrumental passage with loud guitars, heavy drums and bright cymbals, 120 BPM, E Phrygian, follow the input contour with tom pulse, guitar harmonics, prepared piano, metallic percussion and windswept texture, no vocals",
            "90s industrial rock instrumental climax with loud distorted guitars, heavy drums and bright cymbal swells, 120 BPM, E Phrygian, follow the input motif with urgent piano repetitions, metallic texture and layered glass synth, no vocals",
            "90s industrial rock instrumental resolution with clean guitars, heavy acoustic drums and crisp cymbals, 120 BPM, E Phrygian, follow the input harmony with prepared piano, shaker pulse, glass bells and fading metallic wind, no vocals",
        ),
        (42, 43, 44, 45, 46, 47),
        -1.0,
    ),
    Track(
        "Covenant_Breaker",
        "Covenant Breaker",
        "battle",
        180,
        "D Phrygian",
        12,
        "relentless straight pulse, fast hi-hats, polyrhythmic toms, abrupt gaps and off-beat accents",
        "machine drums, bright cymbals, distorted guitar, acid synth, detuned piano, metallic percussion",
        (
            "Ferocious industrial techno and progressive metal battle soundtrack, 180 BPM, D Phrygian, punchy machine drums, fast bright hi-hats, distorted guitar shards, acid synth, detuned piano strikes and metallic percussion, detailed full-frequency game mix, instrumental, no vocals",
            "Escalating industrial battle variation, 180 BPM, D Phrygian, lock to the input hook and pulse, broken drum-machine fills, bright crash cymbals, acid-synth pressure, dissonant guitar harmonics and abrupt gaps, instrumental, no vocals",
            "Alien techno-metal combat passage, 180 BPM, D Phrygian, preserve the input rhythm, rapid hi-hats, polyrhythmic toms, serrated guitar noise, detuned piano and sharp metallic impacts, aggressive detailed mix, instrumental, no vocals",
            "Tactical industrial breakdown, 180 BPM, D Phrygian, preserve the input three-note hook, stop-start machine drums, filtered acid sequence, bright cymbal cuts and processed wordless choir texture, instrumental, no lyrics",
            "Supernatural battle climax, 180 BPM, D Phrygian, preserve the input pulse, relentless kick and snare, bright ride cymbal, distorted bass attack, guitar-noise shards, acid synth and metallic polyrhythms, instrumental, no vocals",
            "Final hostile combat variation, 180 BPM, D Phrygian, preserve the input hook, syncopated machine drums, rapid hi-hats, detuned piano stabs, dissonant guitar harmonics and abrupt final accents, detailed full-frequency mix, instrumental, no vocals",
        ),
        (142, 143, 144, 145, 146, 147),
        -1.5,
    ),
)


def stable_id(prefix: str, value: str) -> str:
    return f"{prefix}_{uuid.uuid5(NAMESPACE, value)}"


def base(track: Track) -> Path:
    return PROJECTS_ROOT / track.slug


def rel(track: Track, path: Path) -> str:
    return str(path.relative_to(base(track)))


def stem_path(track: Track, section: int, seed: int) -> Path:
    return base(track) / "STEMS" / f"{track.slug.lower()}_{REVISION}_section_{section + 1:02d}_s{seed}.wav"


def candidate_seeds(preferred: int, section: int) -> tuple[int, ...]:
    return tuple(dict.fromkeys((preferred, 242 + section, 542 + section)))


def archive_mix(track: Track, source: Path) -> Path:
    target = base(track) / "ARCHIVE" / f"REJECTED_{source.stem}_degenerate_musicgen_{now_iso().replace(':', '').replace('-', '')}{source.suffix}"
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(source, target)
    sidecar = source.with_suffix(".json")
    if sidecar.exists():
        shutil.move(sidecar, target.with_suffix(".json"))
    return target


def archive_project(track: Track) -> None:
    project_file = base(track) / "genost.json"
    journal_file = base(track) / "commands.json"
    project = read_json(project_file)
    journal = read_json(journal_file)
    before_hash = content_hash(project)
    archived: list[dict[str, str]] = []
    stems: list[dict[str, Any]] = []

    for stem in project["stems"]:
        path = base(track) / stem["filePath"] if stem.get("filePath") else None
        if path and path.exists() and path.parent == base(track) / "STEMS" and REVISION not in path.name:
            archived_audio, _ = archive_stem_pair(base(track), path, reason="degenerate_musicgen")
            archive_path = rel(track, archived_audio)
            stems.append(
                {
                    **stem,
                    "status": "archived",
                    "queueOrder": None,
                    "filePath": None,
                    "archivePath": archive_path,
                    "staleReason": "Rejected after objective and listening review: degenerate low-frequency MusicGen output.",
                    "updatedAt": now_iso(),
                }
            )
            archived.append({"stemId": stem["id"], "archivePath": archive_path})
        else:
            stems.append(stem)

    mix_archive = None
    mix_value = project["mix"].get("lastBuildPath")
    if mix_value:
        mix_path = base(track) / mix_value
        if mix_path.exists() and REVISION not in mix_path.name:
            mix_archive = rel(track, archive_mix(track, mix_path))

    if not archived and not mix_archive:
        print(f"archive already complete: {track.title}", flush=True)
        return

    updated = {
        **project,
        "updatedAt": now_iso(),
        "stems": stems,
        "mix": {**project["mix"], "lastBuildPath": None},
    }
    journal = append_command(
        journal,
        command_type="archive_rejected_generation",
        summary="Archived rejected MusicGen stems and mix before recovery",
        payload={"stems": archived, "mixArchivePath": mix_archive, "reason": "degenerate low-frequency output"},
        before_hash=before_hash,
        after_hash=content_hash(updated),
    )
    write_json_atomic(project_file, updated)
    write_json_atomic(journal_file, journal)
    print(f"archived {track.title}: {len(archived)} stems, mix={bool(mix_archive)}", flush=True)


def load_existing(track: Track, section: int) -> dict[str, Any] | None:
    for seed in candidate_seeds(track.seeds[section], section):
        audio = stem_path(track, section, seed)
        sidecar = audio.with_suffix(".json")
        if audio.exists() and sidecar.exists():
            validate_generated_audio(audio, CLIP_SECONDS, "music")
            return {"audio": audio, "metadata": read_json(sidecar)}
    return None


def generate_section(track: Track, section: int, anchor: dict[str, Any] | None) -> dict[str, Any]:
    existing = load_existing(track, section)
    if existing:
        print(f"validated existing {track.title} section {section + 1}", flush=True)
        return existing

    kind = "text" if section == 0 else "conditioned"
    failures = []
    for seed in candidate_seeds(track.seeds[section], section):
        output = stem_path(track, section, seed)
        try:
            print(f"generating {track.title} section {section + 1}/6 seed={seed} ({kind})", flush=True)
            result = generate_with_metadata(
                kind=kind,
                prompt=track.prompts[section],
                duration_seconds=CLIP_SECONDS,
                output_path=str(output),
                model_name=DEFAULT_TEXT_MODEL,
                reference_audio_path=str(anchor["audio"]) if anchor else None,
                seed=seed,
                backend="mlx",
                validation_profile="music",
            )
        except Exception as exc:
            failures.append({"seed": seed, "error": str(exc)})
            print(f"candidate rejected: {exc}", flush=True)
            continue

        stem_id = stable_id("stem", f"{track.slug}:{REVISION}:{section}:{seed}")
        block_id = stable_id("block", f"{track.slug}:{REVISION}:{section}")
        settings = {
            "backend": result.backend,
            "device": result.device,
            "topK": 250,
            "temperature": 1.0,
            "cfgCoefficient": 3.0,
            "durationSeconds": CLIP_SECONDS,
            "sampleRate": result.metrics.sample_rate,
            "peakNormalization": 0.98,
            "validationProfile": "music",
        }
        metadata = {
            "schemaVersion": 1,
            "id": stem_id,
            "blockId": block_id,
            "variation": section + 1,
            "inputStemId": anchor["metadata"]["id"] if anchor else None,
            "inputStemPath": rel(track, anchor["audio"]) if anchor else None,
            "prompt": track.prompts[section],
            "promptHash": content_hash({"prompt": track.prompts[section], "settings": settings}),
            "backend": result.backend,
            "backendVersion": "mlx-audiocraft==0.1.0",
            "model": result.model,
            "seed": seed,
            "durationSeconds": result.metrics.duration_seconds,
            "sampleRate": result.metrics.sample_rate,
            "device": result.device,
            "generationSettings": settings,
            "validationMetrics": asdict(result.metrics),
            "generationSeconds": result.generation_seconds,
            "filePath": rel(track, output),
            "generatedAt": now_iso(),
            "creativeDirection": "Original work; no copyrighted reference audio was used.",
        }
        write_stem_sidecar(output, metadata)
        if failures:
            report = base(track) / "JOBS" / f"{REVISION}_section_{section + 1:02d}_attempts.json"
            write_json_atomic(
                report,
                {
                    "createdAt": now_iso(),
                    "kind": kind,
                    "prompt": track.prompts[section],
                    "failures": failures,
                    "acceptedSeed": seed,
                    "acceptedPath": rel(track, output),
                },
            )
        return {"audio": output, "metadata": metadata}

    report = base(track) / "JOBS" / f"{REVISION}_section_{section + 1:02d}_failures.json"
    write_json_atomic(report, {"createdAt": now_iso(), "kind": kind, "prompt": track.prompts[section], "failures": failures})
    raise GeneratorError(f"No valid candidate for {track.title} section {section + 1}; see {report}")


def project_from_sections(track: Track, sections: list[dict[str, Any]]) -> None:
    project_file = base(track) / "genost.json"
    journal_file = base(track) / "commands.json"
    project = read_json(project_file)
    journal = read_json(journal_file)
    expected_stem_ids = [item["metadata"]["id"] for item in sections]
    expected_block_ids = [item["metadata"]["blockId"] for item in sections]
    current_stem_ids = [stem["id"] for stem in project["stems"] if stem["status"] == "ready"]
    current_block_ids = [block["id"] for block in project["blocks"]]
    current_clip_ids = [clip["id"] for lane in project["arrangement"]["lanes"] for clip in lane["clips"]]
    expected_clip_ids = [stable_id("clip", f"{track.slug}:{REVISION}:{position}") for position in range(len(SEQUENCE))]
    if (
        current_stem_ids == expected_stem_ids
        and current_block_ids == expected_block_ids
        and current_clip_ids == expected_clip_ids
    ):
        print(f"project state already current: {track.title}", flush=True)
        return

    before_hash = content_hash(project)
    timestamp = now_iso()
    prior = [stem for stem in project["stems"] if stem["status"] in {"archived", "detached"}]
    prior_ids = [stem["id"] for stem in prior]
    blocks = []
    stems = []

    for index, item in enumerate(sections):
        metadata = item["metadata"]
        audio = item["audio"]
        blocks.append(
            {
                "id": metadata["blockId"],
                "name": "Anchor" if index == 0 else f"Evolved Section {index + 1}",
                "bars": track.bars,
                "timeSignature": None,
                "role": "text anchor" if index == 0 else "melody-conditioned evolution",
                "instruments": [value.strip() for value in track.palette.split(",")],
                "melodyDescription": "Original recurring motif transformed into a distinct arranged section",
                "melodyPrompt": metadata["prompt"],
                "rhythmFeel": track.rhythm,
                "timbre": track.palette,
                "energy": min(10, (5 if track.kind == "world" else 8) + index),
                "density": min(10, (4 if track.kind == "world" else 8) + index),
                "avoid": "recognizable melodies, lyrics, heroic trailer brass, festival EDM drops, low-frequency-only drone",
                "volumeDb": -4 if index == 0 else -5,
                "delaySend": 0.18 if track.kind == "world" else 0.08,
                "reverbSend": 0.30 if track.kind == "world" else 0.12,
                "compressorEnabled": track.kind == "battle",
                "implementedMelodies": [
                    {
                        "id": stable_id("melody", f"{track.slug}:{REVISION}:{index}"),
                        "stemId": metadata["id"],
                        "textMetadata": metadata["prompt"],
                        "createdAt": metadata["generatedAt"],
                    }
                ],
            }
        )
        stems.append(
            {
                "id": metadata["id"],
                "blockId": metadata["blockId"],
                "variation": index + 1,
                "inputStemId": metadata["inputStemId"],
                "model": metadata["model"],
                "promptHash": metadata["promptHash"],
                "seed": metadata["seed"],
                "durationSeconds": metadata["durationSeconds"],
                "status": "ready",
                "queueOrder": None,
                "fileName": audio.name,
                "filePath": rel(track, audio),
                "archivePath": None,
                "revisionOfStemId": prior_ids[index] if index < len(prior_ids) else None,
                "staleReason": None,
                "error": None,
                "createdAt": metadata["generatedAt"],
                "updatedAt": metadata["generatedAt"],
            }
        )

    clips = []
    for position, section in enumerate(SEQUENCE):
        clips.append(
            {
                "id": stable_id("clip", f"{track.slug}:{REVISION}:{position}"),
                "blockId": stems[section]["blockId"],
                "variation": section + 1,
                "startBar": position * track.bars,
                "bars": track.bars,
                "inputBlockId": None if section == 0 else stems[0]["blockId"],
                "inputStemId": stems[section]["inputStemId"],
                "stemId": stems[section]["id"],
            }
        )

    updated = {
        **project,
        "updatedAt": timestamp,
        "song": {
            **project["song"],
            "prompt": track.prompts[0],
            "rhythmFeel": track.rhythm,
            "sonicPalette": track.palette,
            "productionNotes": "MLX MusicGen on Metal, objective music-profile validation, peak normalization and 32 kHz mix build",
            "arrangementNotes": "Six distinct sections arranged across twelve 16-second forms with 0.75-second crossfades",
            "defaultTextModel": DEFAULT_TEXT_MODEL,
            "defaultMelodyModel": DEFAULT_MELODY_MODEL,
            "modelCachePath": os.environ.get("HF_HOME", project["song"].get("modelCachePath", "")),
        },
        "blocks": blocks,
        "arrangement": {"lanes": [{"id": stable_id("lane", f"{track.slug}:{REVISION}"), "name": "Recovered forms", "clips": clips}]},
        "stems": [*prior, *stems],
        "mix": {**project["mix"], "lastBuildPath": None},
    }
    journal = append_command(
        journal,
        command_type="render_recovery_stems",
        summary=f"Rendered six validated MLX MusicGen sections for {track.title}",
        payload={"backend": "mlx", "stemIds": [stem["id"] for stem in stems], "validationProfile": "music"},
        before_hash=before_hash,
        after_hash=content_hash(updated),
    )
    write_json_atomic(project_file, updated)
    write_json_atomic(journal_file, journal)


def generate_all() -> None:
    all_sections: dict[str, list[dict[str, Any]]] = {track.slug: [] for track in TRACKS}
    for track in TRACKS:
        archive_project(track)
        all_sections[track.slug].append(generate_section(track, 0, None))
    clear_model_cache()
    for track in TRACKS:
        anchor = all_sections[track.slug][0]
        for section in range(1, 6):
            all_sections[track.slug].append(generate_section(track, section, anchor))
        project_from_sections(track, all_sections[track.slug])


def duration(path: Path) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(result.stdout.strip())


def assemble(track: Track) -> Path:
    project_file = base(track) / "genost.json"
    journal_file = base(track) / "commands.json"
    project = read_json(project_file)
    journal = read_json(journal_file)
    ready = {stem["id"]: stem for stem in project["stems"] if stem["status"] == "ready"}
    clips = sorted(project["arrangement"]["lanes"][0]["clips"], key=lambda item: item["startBar"])
    sources = [base(track) / ready[clip["stemId"]]["filePath"] for clip in clips]
    expected = len(sources) * CLIP_SECONDS - (len(sources) - 1) * CROSSFADE_SECONDS
    output = base(track) / "MIXES" / f"{track.slug.lower()}_{REVISION}_final.wav"

    if not output.exists():
        temporary = output.with_name(f".{output.stem}.{uuid.uuid4().hex}.tmp.wav")
        command = ["ffmpeg", "-hide_banner", "-loglevel", "warning", "-y"]
        for source in sources:
            command.extend(["-i", str(source)])
        filters = [
            f"[{index}:a]aresample={SAMPLE_RATE},pan=stereo|c0=c0|c1=c0,highpass=f=28,volume={0.82 if index in (0, len(sources) - 1) else 0.92}[a{index}]"
            for index in range(len(sources))
        ]
        current = "a0"
        for index in range(1, len(sources)):
            next_label = f"x{index}"
            filters.append(f"[{current}][a{index}]acrossfade=d={CROSSFADE_SECONDS}:c1=tri:c2=tri[{next_label}]")
            current = next_label
        filters.append(
            f"[{current}]loudnorm=I=-16:TP=-1.5:LRA=10,volume={track.gain_db}dB,alimiter=limit=0.94,"
            f"afade=t=in:st=0:d=2,afade=t=out:st={expected - 3}:d=3[out]"
        )
        command.extend(["-filter_complex", ";".join(filters), "-map", "[out]", "-ar", str(SAMPLE_RATE), "-c:a", "pcm_s24le", str(temporary)])
        try:
            subprocess.run(command, check=True)
            validate_generated_audio(temporary, expected, "full_mix")
            temporary.replace(output)
        except Exception:
            temporary.unlink(missing_ok=True)
            raise

    metrics = validate_generated_audio(output, expected, "full_mix")
    actual_duration = duration(output)
    if actual_duration < 180:
        raise GeneratorError(f"Final mix is shorter than three minutes: {actual_duration:.3f}s")
    sidecar = output.with_suffix(".json")
    if not sidecar.exists():
        write_json_atomic(
            sidecar,
            {
                "schemaVersion": 1,
                "projectId": project["id"],
                "sourceStemIds": [clip["stemId"] for clip in clips],
                "sourcePaths": [rel(track, source) for source in sources],
                "durationSeconds": actual_duration,
                "sampleRate": SAMPLE_RATE,
                "crossfadeSeconds": CROSSFADE_SECONDS,
                "targetLoudnessLufs": -16,
                "truePeakDb": -1.5,
                "validationMetrics": asdict(metrics),
                "builtAt": now_iso(),
            },
        )
    if project["mix"].get("lastBuildPath") != rel(track, output):
        before_hash = content_hash(project)
        updated = {
            **project,
            "updatedAt": now_iso(),
            "song": {**project["song"], "arrangementNotes": f"Six distinct sections over twelve forms; final duration {actual_duration:.3f} seconds"},
            "mix": {**project["mix"], "lastBuildPath": rel(track, output)},
        }
        journal = append_command(
            journal,
            command_type="build_mix_completed",
            summary=f"Built validated recovery mix {output.name}",
            payload={"path": rel(track, output), "durationSeconds": actual_duration, "validationMetrics": asdict(metrics)},
            before_hash=before_hash,
            after_hash=content_hash(updated),
        )
        write_json_atomic(project_file, updated)
        write_json_atomic(journal_file, journal)
    print(f"assembled {track.title}: {actual_duration:.3f}s", flush=True)
    return output


def export(mixes: list[tuple[Track, Path]]) -> None:
    desktop = Path.home() / "Desktop"
    desktop.mkdir(parents=True, exist_ok=True)
    for track, source in mixes:
        target = desktop / f"{track.title} - GENOST {REVISION}.wav"
        if not target.exists():
            temporary = target.with_name(f".{target.stem}.{uuid.uuid4().hex}.tmp.wav")
            shutil.copy2(source, temporary)
            validate_generated_audio(temporary, 180, "full_mix")
            temporary.replace(target)
        else:
            validate_generated_audio(target, 180, "full_mix")
        print(f"exported {target}", flush=True)

        mp3_target = target.with_suffix(".mp3")
        if not mp3_target.exists():
            mp3_temporary = mp3_target.with_name(f".{mp3_target.stem}.{uuid.uuid4().hex}.tmp.mp3")
            try:
                subprocess.run(
                    [
                        "ffmpeg",
                        "-hide_banner",
                        "-loglevel",
                        "warning",
                        "-i",
                        str(source),
                        "-codec:a",
                        "libmp3lame",
                        "-b:a",
                        "320k",
                        "-ar",
                        "44100",
                        str(mp3_temporary),
                    ],
                    check=True,
                )
                validate_generated_audio(mp3_temporary, 180, "full_mix")
                mp3_temporary.replace(mp3_target)
            except Exception:
                mp3_temporary.unlink(missing_ok=True)
                raise
        else:
            validate_generated_audio(mp3_target, 180, "full_mix")
        print(f"exported {mp3_target} (320 kbps)", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Recover and export the two GENOST tracks.")
    parser.add_argument("phase", choices=("archive", "generate", "assemble", "export", "all"))
    args = parser.parse_args()
    if args.phase in {"archive", "all"}:
        for track in TRACKS:
            archive_project(track)
    if args.phase in {"generate", "all"}:
        generate_all()
    mixes = []
    if args.phase in {"assemble", "export", "all"}:
        for track in TRACKS:
            output = base(track) / "MIXES" / f"{track.slug.lower()}_{REVISION}_final.wav"
            if args.phase != "export" or not output.exists():
                output = assemble(track)
            mixes.append((track, output))
    if args.phase in {"export", "all"}:
        export(mixes)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
