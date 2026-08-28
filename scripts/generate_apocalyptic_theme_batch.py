#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY_ROOT))

from genost_worker.audiocraft_generator import (
    DEFAULT_MELODY_MODEL,
    DEFAULT_TEXT_MODEL,
    generate_conditioned_stem,
    generate_text_stem,
)


OUTPUT_ROOT = Path(os.environ.get("GENOST_OUTPUT_ROOT", REPOSITORY_ROOT / "GENOST_PROJECTS"))
CLIP_SECONDS = 16
CROSSFADE_SECONDS = 0.75
SAMPLE_RATE = 32000
PROJECT_DIRECTORIES = ("STEMS", "MIXES", "REFERENCES", "WAVEFORMS", "JOBS", "ARCHIVE")
NAMESPACE = uuid.UUID("ff5cb2ce-9574-46ce-928e-0bca67f5b6d4")


@dataclass(frozen=True)
class TrackSpec:
    slug: str
    title: str
    kind: str
    bpm: int
    key: str
    bars_per_clip: int
    swing_feel: str
    swing_ratio: float
    mood: str
    genre_references: tuple[str, ...]
    rhythm_feel: str
    sonic_palette: str
    anchor_prompt: str
    variation_prompts: tuple[str, ...]
    seeds: tuple[int, ...]
    sequence: tuple[int, ...]
    lowpass_sequence: tuple[int, ...]
    output_gain_db: float


TRACKS = (
    TrackSpec(
        slug="Ash_Meridian",
        title="Ash Meridian",
        kind="world",
        bpm=120,
        key="E Phrygian",
        bars_per_clip=8,
        swing_feel="soft",
        swing_ratio=1.22,
        mood="desolate, numinous, watchful, quietly propulsive",
        genre_references=("dark ambient", "industrial electronica", "post-rock", "ritual minimalism"),
        rhythm_feel="measured four-beat pulse with negative space and small syncopated disruptions",
        sonic_palette="granular wind, bowed metal, muted frame drums, sub pulse, glassy synth, prepared piano",
        anchor_prompt=(
            "Original instrumental post-apocalyptic exploration music, 120 BPM, E Phrygian, "
            "a spacious two-chord nonfunctional vamp, granular desert wind, bowed metallic drone, "
            "muted frame drums emphasizing the pulse, deep restrained sub bass, tiny prepared-piano "
            "signals, an unfamiliar five-note glass-synth motif, austere and mystical, detailed game "
            "soundtrack mix, no lyrics, no heroic melody, no trailer rise, no EDM drop"
        ),
        variation_prompts=(
            "Original instrumental environmental variation, 120 BPM, E Phrygian, preserve the input "
            "motif and harmony while adding a dry clean rhythm-guitar ostinato, distant industrial "
            "machinery, soft tom pulse and brighter prepared-piano replies, eerie open space, no lyrics, "
            "no triumphant cadence, no EDM drop",
            "Original instrumental environmental variation, 120 BPM, E Phrygian, preserve the input "
            "melodic contour but fracture it into granular synth echoes, heavier sub pulses, irregular "
            "metal percussion and a thin saw-wave countermelody, ominous yet traversable, no lyrics, "
            "no cinematic brass, no EDM drop",
        ),
        seeds=(825101, 825102, 825103),
        sequence=(0, 0, 1, 0, 2, 1, 0, 2, 1, 2, 0, 1),
        lowpass_sequence=(4200, 5600, 7800, 9500, 11000, 13500, 16000, 14500, 12500, 10500, 7800, 5200),
        output_gain_db=-0.5,
    ),
    TrackSpec(
        slug="Covenant_Breaker",
        title="Covenant Breaker",
        kind="battle",
        bpm=180,
        key="D Phrygian",
        bars_per_clip=12,
        swing_feel="straight",
        swing_ratio=1.0,
        mood="violent, alien, ecstatic, tactically focused",
        genre_references=("industrial techno", "progressive metal", "electroacoustic percussion", "dark ritual"),
        rhythm_feel="relentless straight pulse with polyrhythmic toms, abrupt gaps, and off-beat accents",
        sonic_palette="distorted bass, machine drums, guitar-noise shards, detuned piano, acid synth, wordless choir texture",
        anchor_prompt=(
            "Original instrumental supernatural battle music, 180 BPM, D Phrygian, punishing industrial "
            "techno drums, distorted bass ostinato, serrated guitar-noise shards, metallic polyrhythms, "
            "detuned piano strikes, tense chromatic three-note hook, abrupt rhythmic voids, ferocious and "
            "strange rather than heroic, high-impact game combat mix, no lyrics, no familiar melody, "
            "no festival EDM drop"
        ),
        variation_prompts=(
            "Original instrumental battle variation, 180 BPM, D Phrygian, lock to the input hook and "
            "pulse while escalating with broken drum-machine fills, acid-synth pressure, processed "
            "wordless ritual choir as background texture, dissonant guitar harmonics and percussion-led "
            "breakdowns, relentless but unpredictable, no lyrics, no heroic brass, no EDM drop",
        ),
        seeds=(825201, 825202),
        sequence=(0, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1),
        lowpass_sequence=(6200, 9000, 13500, 17000, 18000, 15500, 18000, 18000, 16500, 18000, 14000, 8500),
        output_gain_db=-1.0,
    ),
)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def stable_id(prefix: str, value: str) -> str:
    return f"{prefix}_{uuid.uuid5(NAMESPACE, value)}"


def content_hash(value: object) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def write_json_atomic(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.tmp")
    temporary.write_text(f"{json.dumps(value, indent=2)}\n", encoding="utf-8")
    temporary.replace(path)


def project_path(spec: TrackSpec) -> Path:
    return OUTPUT_ROOT / spec.slug


def stem_path(spec: TrackSpec, variation_index: int) -> Path:
    label = "anchor" if variation_index == 0 else f"variation_{variation_index + 1:02d}"
    return project_path(spec) / "STEMS" / f"{spec.slug.lower()}_{label}.wav"


def stem_prompt(spec: TrackSpec, variation_index: int) -> str:
    if variation_index == 0:
        return spec.anchor_prompt
    return spec.variation_prompts[variation_index - 1]


def ensure_layout() -> None:
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    for spec in TRACKS:
        base = project_path(spec)
        base.mkdir(parents=True, exist_ok=True)
        for directory in PROJECT_DIRECTORIES:
            (base / directory).mkdir(parents=True, exist_ok=True)


def require_hf_home() -> str:
    hf_home = os.environ.get("HF_HOME")
    if not hf_home:
        raise RuntimeError("HF_HOME must point to the local MusicGen cache.")
    if not Path(hf_home).is_dir():
        raise RuntimeError(f"HF_HOME does not exist: {hf_home}")
    return hf_home


def write_sidecar(spec: TrackSpec, variation_index: int, model: str) -> None:
    output = stem_path(spec, variation_index)
    prompt = stem_prompt(spec, variation_index)
    anchor_id = stable_id("stem", f"{spec.slug}:0")
    stem_id = stable_id("stem", f"{spec.slug}:{variation_index}")
    block_id = stable_id("block", f"{spec.slug}:{variation_index}")
    generated_at = datetime.fromtimestamp(output.stat().st_mtime, timezone.utc).isoformat().replace("+00:00", "Z")
    settings = {
        "durationSeconds": CLIP_SECONDS,
        "sampleRate": SAMPLE_RATE,
        "device": "mps",
        "topK": 250,
        "temperature": 1.0,
        "useSampling": True,
    }
    metadata = {
        "schemaVersion": 1,
        "id": stem_id,
        "blockId": block_id,
        "variation": variation_index + 1,
        "inputStemId": None if variation_index == 0 else anchor_id,
        "inputStemPath": None if variation_index == 0 else str(stem_path(spec, 0).relative_to(project_path(spec))),
        "prompt": prompt,
        "promptHash": content_hash({"prompt": prompt, "settings": settings}),
        "model": model,
        "seed": spec.seeds[variation_index],
        "durationSeconds": CLIP_SECONDS,
        "sampleRate": SAMPLE_RATE,
        "device": "mps",
        "generationSettings": settings,
        "filePath": str(output.relative_to(project_path(spec))),
        "generatedAt": generated_at,
        "creativeDirection": "Original work informed only by broad post-apocalyptic JRPG scoring vocabulary; no reference audio was used.",
    }
    write_json_atomic(output.with_suffix(".json"), metadata)


def generate_seeds() -> None:
    hf_home = require_hf_home()
    for spec in TRACKS:
        output = stem_path(spec, 0)
        if output.exists():
            print(f"seed exists: {output}", flush=True)
        else:
            print(f"generating seed: {spec.title}", flush=True)
            generate_text_stem(
                prompt=spec.anchor_prompt,
                duration_seconds=CLIP_SECONDS,
                output_path=str(output),
                model_name=DEFAULT_TEXT_MODEL,
                hf_home=hf_home,
                seed=spec.seeds[0],
            )
        write_sidecar(spec, 0, DEFAULT_TEXT_MODEL)


def generate_variations() -> None:
    hf_home = require_hf_home()
    for spec in TRACKS:
        anchor = stem_path(spec, 0)
        if not anchor.exists():
            raise RuntimeError(f"Missing anchor stem: {anchor}")
        for variation_index in range(1, len(spec.variation_prompts) + 1):
            output = stem_path(spec, variation_index)
            if output.exists():
                print(f"variation exists: {output}", flush=True)
            else:
                print(f"generating variation {variation_index + 1}: {spec.title}", flush=True)
                generate_conditioned_stem(
                    prompt=stem_prompt(spec, variation_index),
                    reference_audio_path=str(anchor),
                    duration_seconds=CLIP_SECONDS,
                    output_path=str(output),
                    hf_home=hf_home,
                    seed=spec.seeds[variation_index],
                )
            write_sidecar(spec, variation_index, DEFAULT_MELODY_MODEL)


def probe_duration(path: Path) -> float:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(result.stdout.strip())


def assemble_mix(spec: TrackSpec) -> tuple[Path, float]:
    sources = [stem_path(spec, index) for index in spec.sequence]
    missing = [str(path) for path in sources if not path.exists()]
    if missing:
        raise RuntimeError(f"Cannot assemble {spec.title}; missing stems: {missing}")

    expected_duration = len(sources) * CLIP_SECONDS - (len(sources) - 1) * CROSSFADE_SECONDS
    mix_path = project_path(spec) / "MIXES" / f"{spec.slug.lower()}_final.wav"
    temporary = mix_path.with_name(f"{mix_path.stem}.tmp.wav")
    command = ["ffmpeg", "-hide_banner", "-loglevel", "warning", "-y"]
    for source in sources:
        command.extend(["-i", str(source)])

    filters: list[str] = []
    for index, cutoff in enumerate(spec.lowpass_sequence):
        cutoff = min(cutoff, int(SAMPLE_RATE * 0.48))
        level = 0.78 if index == 0 else 0.9 if index == len(sources) - 1 else 1.0
        filters.append(
            f"[{index}:a]aresample={SAMPLE_RATE},pan=stereo|c0=c0|c1=c0,"
            f"highpass=f=28,lowpass=f={cutoff},volume={level}[a{index}]"
        )

    previous = "a0"
    for index in range(1, len(sources)):
        output_label = f"x{index}"
        filters.append(
            f"[{previous}][a{index}]acrossfade=d={CROSSFADE_SECONDS}:c1=tri:c2=tri[{output_label}]"
        )
        previous = output_label

    fade_out_start = expected_duration - 3.0
    filters.append(
        f"[{previous}]loudnorm=I=-16:TP=-1.5:LRA=10,volume={spec.output_gain_db}dB,"
        f"alimiter=limit=0.94,afade=t=in:st=0:d=2,afade=t=out:st={fade_out_start}:d=3[out]"
    )
    command.extend(
        [
            "-filter_complex",
            ";".join(filters),
            "-map",
            "[out]",
            "-ar",
            str(SAMPLE_RATE),
            "-c:a",
            "pcm_s16le",
            str(temporary),
        ]
    )
    subprocess.run(command, check=True)
    temporary.replace(mix_path)
    duration = probe_duration(mix_path)
    if duration < 180:
        raise RuntimeError(f"Final mix is shorter than three minutes: {duration:.3f}s")
    return mix_path, duration


def write_project(spec: TrackSpec, mix_path: Path, mix_duration: float) -> None:
    base = project_path(spec)
    created_at = now_iso()
    project_id = stable_id("project", spec.slug)
    blocks = []
    stems = []
    for variation_index in range(len(spec.variation_prompts) + 1):
        prompt = stem_prompt(spec, variation_index)
        output = stem_path(spec, variation_index)
        block_id = stable_id("block", f"{spec.slug}:{variation_index}")
        stem_id = stable_id("stem", f"{spec.slug}:{variation_index}")
        input_stem_id = None if variation_index == 0 else stable_id("stem", f"{spec.slug}:0")
        block_name = "Anchor" if variation_index == 0 else f"Evolved Form {variation_index + 1}"
        blocks.append(
            {
                "id": block_id,
                "name": block_name,
                "bars": spec.bars_per_clip,
                "timeSignature": None,
                "role": "environmental anchor" if variation_index == 0 else "melody-conditioned evolution",
                "instruments": spec.sonic_palette.split(", "),
                "melodyDescription": "Original compact motif transformed across the arranged forms",
                "melodyPrompt": prompt,
                "rhythmFeel": spec.rhythm_feel,
                "timbre": spec.sonic_palette,
                "energy": 5 + min(variation_index, 2) if spec.kind == "world" else 9,
                "density": 4 + min(variation_index, 3) if spec.kind == "world" else 8,
                "avoid": "recognizable melodies, lyrics, heroic trailer brass, festival EDM drops",
                "volumeDb": -4 if variation_index == 0 else -5,
                "delaySend": 0.18 if spec.kind == "world" else 0.08,
                "reverbSend": 0.32 if spec.kind == "world" else 0.14,
                "compressorEnabled": spec.kind == "battle",
                "implementedMelodies": [
                    {
                        "id": stable_id("melody", f"{spec.slug}:{variation_index}"),
                        "stemId": stem_id,
                        "textMetadata": prompt,
                        "createdAt": created_at,
                    }
                ],
            }
        )
        settings_hash = content_hash({"prompt": prompt, "duration": CLIP_SECONDS, "seed": spec.seeds[variation_index]})
        stems.append(
            {
                "id": stem_id,
                "blockId": block_id,
                "variation": variation_index + 1,
                "inputStemId": input_stem_id,
                "model": DEFAULT_TEXT_MODEL if variation_index == 0 else DEFAULT_MELODY_MODEL,
                "promptHash": settings_hash,
                "seed": spec.seeds[variation_index],
                "durationSeconds": CLIP_SECONDS,
                "status": "ready",
                "queueOrder": None,
                "fileName": output.name,
                "filePath": str(output.relative_to(base)),
                "archivePath": None,
                "revisionOfStemId": None,
                "staleReason": None,
                "error": None,
                "createdAt": created_at,
                "updatedAt": created_at,
            }
        )

    clips = []
    for index, variation_index in enumerate(spec.sequence):
        clips.append(
            {
                "id": stable_id("clip", f"{spec.slug}:{index}"),
                "blockId": stable_id("block", f"{spec.slug}:{variation_index}"),
                "variation": variation_index + 1,
                "startBar": index * spec.bars_per_clip,
                "bars": spec.bars_per_clip,
                "inputBlockId": None if variation_index == 0 else stable_id("block", f"{spec.slug}:0"),
                "inputStemId": None if variation_index == 0 else stable_id("stem", f"{spec.slug}:0"),
                "stemId": stable_id("stem", f"{spec.slug}:{variation_index}"),
            }
        )

    song = {
        "prompt": spec.anchor_prompt,
        "bpm": spec.bpm,
        "key": spec.key,
        "timeSignature": [4, 4],
        "swing": {"feel": spec.swing_feel, "ratio": spec.swing_ratio},
        "mood": spec.mood,
        "referenceNotes": (
            "Broad vocabulary researched from post-apocalyptic JRPG environment and battle scoring: "
            "nonfunctional vamps, percussion-forward structures, industrial processing, and altered vocal texture. "
            "No copyrighted reference audio was used."
        ),
        "purpose": f"Original three-minute {spec.kind} theme for local personal use",
        "avoid": "recognizable source melodies, direct imitation, lyrics, heroic trailer brass, festival EDM drops",
        "genreReferences": list(spec.genre_references),
        "rhythmFeel": spec.rhythm_feel,
        "sonicPalette": spec.sonic_palette,
        "productionNotes": "32 kHz stereo final mix, short crossfades, high-pass cleanup, section filter evolution, loudness normalization and limiting",
        "arrangementNotes": f"Twelve {CLIP_SECONDS}-second forms with {CROSSFADE_SECONDS}-second transitions; final duration {mix_duration:.3f} seconds",
        "referenceTrackPath": None,
        "referenceTrackName": None,
        "sampleRate": SAMPLE_RATE,
        "defaultTextModel": DEFAULT_TEXT_MODEL,
        "defaultMelodyModel": DEFAULT_MELODY_MODEL,
        "modelCachePath": os.environ.get("HF_HOME", ""),
    }
    project = {
        "schemaVersion": 1,
        "id": project_id,
        "title": spec.title,
        "createdAt": created_at,
        "updatedAt": created_at,
        "song": song,
        "blocks": blocks,
        "arrangement": {
            "lanes": [
                {
                    "id": stable_id("lane", spec.slug),
                    "name": "Generated forms",
                    "clips": clips,
                }
            ]
        },
        "stems": stems,
        "mix": {
            "masterDelay": 0.08 if spec.kind == "world" else 0.03,
            "masterDelayEnabled": True,
            "masterDelayTimeMs": 375 if spec.kind == "world" else 240,
            "masterDelayFeedback": 0.22 if spec.kind == "world" else 0.12,
            "masterDelayFilterHz": 6200,
            "masterReverb": 0.16 if spec.kind == "world" else 0.07,
            "masterReverbEnabled": True,
            "masterReverbDecaySeconds": 4.8 if spec.kind == "world" else 2.2,
            "masterReverbPreDelayMs": 28 if spec.kind == "world" else 14,
            "masterReverbDampeningHz": 7600,
            "masterLimiter": True,
            "masterLimiterThresholdDb": -1.5,
            "masterLimiterReleaseMs": 120,
            "outputGainDb": spec.output_gain_db,
            "lastBuildPath": str(mix_path.relative_to(base)),
        },
        "roadmap": {"nextPriority": "MIDI and chord progression support"},
    }
    project_hash = content_hash(project)
    commands = {
        "schemaVersion": 1,
        "projectId": project_id,
        "createdAt": created_at,
        "updatedAt": created_at,
        "commands": [
            {
                "id": stable_id("cmd", f"{spec.slug}:create"),
                "createdAt": created_at,
                "actor": "code-agent",
                "source": "code-agent",
                "type": "create_project",
                "summary": f"Created original project {spec.title}",
                "payload": {"kind": spec.kind, "bpm": spec.bpm, "key": spec.key},
                "afterHash": project_hash,
            },
            {
                "id": stable_id("cmd", f"{spec.slug}:research"),
                "createdAt": created_at,
                "actor": "code-agent",
                "source": "code-agent",
                "type": "set_composition_prompt",
                "summary": "Set an original prompt from broad researched genre characteristics without reference audio",
                "payload": {"prompt": spec.anchor_prompt, "noReferenceAudio": True},
                "afterHash": project_hash,
            },
            {
                "id": stable_id("cmd", f"{spec.slug}:render"),
                "createdAt": created_at,
                "actor": "code-agent",
                "source": "code-agent",
                "type": "render_generated_stems",
                "summary": f"Rendered {len(stems)} explicit MusicGen stems and metadata sidecars",
                "payload": {"stemIds": [stem["id"] for stem in stems]},
                "afterHash": project_hash,
            },
            {
                "id": stable_id("cmd", f"{spec.slug}:mix"),
                "createdAt": created_at,
                "actor": "code-agent",
                "source": "code-agent",
                "type": "build_mix_completed",
                "summary": f"Built final mix {mix_path.name}",
                "payload": {"path": str(mix_path.relative_to(base)), "durationSeconds": mix_duration},
                "afterHash": project_hash,
            },
        ],
    }
    write_json_atomic(base / "genost.json", project)
    write_json_atomic(base / "commands.json", commands)


def assemble_all() -> None:
    genres: set[str] = set()
    for spec in TRACKS:
        mix_path, duration = assemble_mix(spec)
        write_project(spec, mix_path, duration)
        genres.update(spec.genre_references)
        print(f"assembled: {mix_path} ({duration:.3f}s)", flush=True)
    write_json_atomic(
        OUTPUT_ROOT / "genost-workspace.json",
        {"schemaVersion": 1, "updatedAt": now_iso(), "genreReferences": sorted(genres)},
    )


def run_all() -> None:
    for phase in ("seed", "variation", "assemble"):
        print(f"starting phase: {phase}", flush=True)
        subprocess.run([sys.executable, str(Path(__file__).resolve()), phase], check=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate and assemble two original GENOST themes.")
    parser.add_argument("phase", choices=("seed", "variation", "assemble", "all"))
    args = parser.parse_args()
    ensure_layout()
    if args.phase == "seed":
        generate_seeds()
    elif args.phase == "variation":
        generate_variations()
    elif args.phase == "assemble":
        assemble_all()
    else:
        run_all()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
