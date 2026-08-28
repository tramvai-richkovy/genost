#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from genost_worker.persistence import append_command, content_hash, now_iso, read_json, write_json_atomic  # noqa: E402

PROJECT_FOLDERS = (
    "smtv Sketch 01",
    "smtv Sketch 02 - Salt Glass Shinagawa",
    "smtv Sketch 03 - Iron Basilica Chiyoda",
    "smtv Sketch 04 - Godless Ueno Spiral",
    "smtv Sketch 05 - Shinjuku Wound Array",
)

PROJECT_DIRECTIONS = {
    PROJECT_FOLDERS[0]: {
        "title": "smtv Sketch 01",
        "purpose": "loopable exposed wasteland exploration cue with sacred industrial tension",
        "referenceNotes": "dark ambient, ritual downtempo, industrial electronica, processed wordless voice, detuned brass, dry percussion",
        "mood": "desolate, sacred, wind-scoured, disoriented, watchful",
        "rhythmFeel": "sparse traversal pulse with negative space, dry ritual hits, off-grid sand and metal accents",
        "sonicPalette": "sand wind, concrete resonance, low analog drone, bowed metal, frame drums, old drum machines, wordless choir grains, detuned horn synth, distant guitar feedback, bell fragments",
        "productionNotes": "dry foreground transients, huge empty air, controlled sub pressure, dusty high end, readable layers",
        "arrangementNotes": "48-bar loop; atmosphere persists while percussion, horn synth, bell motif, voice stabs, guitar feedback, and bass toms enter sparsely",
        "avoid": "recognizable reference melodies, lyrics, heroic fanfares, bright festival leads, stereotyped regional scales, clean cyberpunk gloss",
    },
    PROJECT_FOLDERS[1]: {
        "title": "smtv Sketch 02 - Salt Glass District",
        "purpose": "loopable humid industrial-water exploration cue with cautious harmonic light",
        "referenceNotes": "dark ambient, downtempo electronica, ritual post-rock, industrial dub, nonfunctional modal harmony",
        "mood": "humid, wary, luminous, wounded, quietly alive",
        "rhythmFeel": "slow locked pulse with off-grid droplets, container echoes, and soft swung percussion",
        "sonicPalette": "glass pads, corroded container hits, distant water, bowed metal, processed bells, muted guitar harmonics, sub fog",
        "productionNotes": "wide detailed image, clean sub floor, short transient tails, damp reverb, sparse melody",
        "arrangementNotes": "48-bar loop; pad and pulse persist while bells, guitar harmonics, choir grains, and rail noise rotate in short events",
        "avoid": "recognizable reference melodies, lyrics, heroic fanfares, bright festival leads, stereotyped regional hooks, polished pop drums",
    },
    PROJECT_FOLDERS[2]: {
        "title": "smtv Sketch 03 - Iron Basilica",
        "purpose": "loopable industrial fortress exploration cue crossing into combat pressure",
        "referenceNotes": "industrial techno, ritual metal, dungeon ambient, processed choir, original alarm motifs",
        "mood": "martial, ceremonial, infernal, focused, authoritarian",
        "rhythmFeel": "machine-straight march with polyrhythmic tom interruptions and deliberate dropouts",
        "sonicPalette": "distorted bass, iron impacts, pipe-organ synth, analog alarms, scraped guitar, low wordless choir, concrete reflections",
        "productionNotes": "high pressure without brickwalling, forward transients, controlled distortion, dry center, tall alarm reverb",
        "arrangementNotes": "64-bar escalation; drone and kick establish the march while alarms, choir, guitar swarm, and acid bass rotate in controlled assaults",
        "avoid": "recognizable battle riffs, copied pacing, lyrics, heroic brass, power-metal chorus, festival drops, trap rolls",
    },
    PROJECT_FOLDERS[3]: {
        "title": "smtv Sketch 04 - Godless Spiral",
        "purpose": "loopable late-region exploration cue with unstable sacred vertical space",
        "referenceNotes": "dark ambient, ritual minimalism, electroacoustic percussion, post-rock, original locrian harmony",
        "mood": "ethereal, ancient, exposed, reverent, unstable",
        "rhythmFeel": "slow spiral pulse with asymmetric bell answers, tom clusters, and floating phrase entrances",
        "sonicPalette": "ancient organ synth, metallophone fragments, bowed cymbals, deep toms, wordless choir haze, high guitar halos, dust wind",
        "productionNotes": "tall vertical space, precise low mids, long reverb only on bells and voice, restrained master gain",
        "arrangementNotes": "56-bar open spiral; organ drone loops while bells, toms, choir, bass, and guitar enter in nonlinear waves",
        "avoid": "recognizable reference motifs, lyrics, triumphant finale melody, bright fantasy orchestra, generic temple ambience",
    },
    PROJECT_FOLDERS[4]: {
        "title": "smtv Sketch 05 - Wound Array",
        "purpose": "loopable wounded urban exploration cue with predatory triplet motion",
        "referenceNotes": "dark ambient, industrial trip-hop, occult downtempo, noise rock, processed non-lyrical human texture",
        "mood": "bewitching, wounded, predatory, urban, feverish",
        "rhythmFeel": "heavy triplet lurch with broken drum machines, delayed claps, and breathy gaps",
        "sonicPalette": "fogged pads, broken drum machines, distorted sub, wordless voice cuts, feedback guitar, rail noise, cold piano fragments",
        "productionNotes": "close humid image, narrow aggressive mids, controlled bass, heavily processed non-lyrical voice",
        "arrangementNotes": "56-bar fever loop; pad and drums sustain the triplet lurch while bass, voice, guitar, rail noise, and piano appear sparsely",
        "avoid": "recognizable reference motifs, named-character material, lyrics, pop hooks, festival drops, heroic chorus, clean cyberpunk gloss",
    },
}

CATEGORIES = {
    "bass_drone": {
        "Atmosphere", "Bass Toms", "Salt Glass Pad", "Sludge Tide Bass", "Breathing Choir Grain", "Siege Drone",
        "Castle Gate Choir", "Acid Oracle Bass", "Ueno Dust Organ", "Seraphic Sub Choir", "Lost Deity Bass",
        "Fogged Highrise Pad", "Vengeance Subline", "Kabukicho Static Veil",
    },
    "rhythm": {
        "Percussion Organic Layer", "Beat", "Container Pulse", "Rail Noise Bloom", "War Machine Kick",
        "Magatsuhi Pillar Toms", "Asakusa Spiral Pulse", "Mythic Tom Spiral", "Final Gate Dust", "Broken Neon Drums", "Rail Slice FX",
    },
    "melody": {
        "Horn", "Melody", "Guitar ambient lead", "Choir Stabs", "Fairy Bell Codes", "Worn Guitar Harmonics",
        "Analog Basilica Alarm", "Scraped Guitar Swarm", "Broken Edict Bell", "Shrine Bell Coordinates",
        "Frozen Guitar Halo", "Wordless Cut Choir", "Apartment Feedback Guitar", "Null Saint Piano",
    },
}

RENAMES = {
    "Magatsuhi Pillar Toms": "Pillar Toms",
    "Ueno Dust Organ": "Dust Organ",
    "Asakusa Spiral Pulse": "Spiral Pulse",
    "Kabukicho Static Veil": "Static Veil",
}

REPLACEMENTS = {
    r"SMT\s*V(?::\s*Vengeance)?": "reference score",
    r"Da-at": "wasteland",
    r"Minato": "starting region",
    r"Shinagawa": "humid district",
    r"Chiyoda": "iron district",
    r"Ginza": "ruined infrastructure",
    r"Ueno": "late region",
    r"Asakusa": "circular district",
    r"Shinjuku": "wounded city",
    r"Kabukicho": "broken nightlife",
    r"Tokyo": "ruined city",
    r"Magatsuhi": "supernatural",
    r"Qadistu": "named-character",
    r"HEALTH": "industrial noise rock",
    r"Trent Reznor": "textural industrial production",
    r"Demon King": "fortress",
}
PROHIBITED = re.compile("|".join(f"(?:{pattern})" for pattern in REPLACEMENTS), re.IGNORECASE)


def clean_text(value: str) -> str:
    cleaned = value
    for pattern, replacement in REPLACEMENTS.items():
        cleaned = re.sub(pattern, replacement, cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def category_for(name: str) -> str:
    matches = [category for category, names in CATEGORIES.items() if name in names]
    if len(matches) != 1:
        raise RuntimeError(f"Block {name!r} needs exactly one reviewed validation category; found {matches}")
    return matches[0]


def build_prompt(song: dict) -> str:
    swing = song["swing"]
    first = swing["ratio"] / (swing["ratio"] + 1) * 100
    second = 100 - first
    swing_label = {"straight": "Straight time", "soft": "Soft swing", "triplet": "Triplet swing", "hard": "Hard swing"}[swing["feel"]]
    parts = [
        f"{song['bpm']} BPM", f"{song['timeSignature'][0]}/{song['timeSignature'][1]} time",
        f"swing: {swing_label} {swing['ratio']:.2f}:1 ({first:.1f}% / {second:.1f}%)", song["key"],
        f"genre references: {', '.join(song['genreReferences'])}", f"mood: {song['mood']}",
        f"purpose: {song['purpose']}", f"references: {song['referenceNotes']}", f"rhythm feel: {song['rhythmFeel']}",
        f"sonic palette: {song['sonicPalette']}", f"production notes: {song['productionNotes']}",
        f"arrangement: {song['arrangementNotes']}", f"avoid: {song['avoid']}",
    ]
    return "; ".join(part for part in parts if part.split(": ", 1)[-1])


def migrate_project(project_dir: Path) -> None:
    project_path = project_dir / "genost.json"
    journal_path = project_dir / "commands.json"
    project = read_json(project_path)
    journal = read_json(journal_path)
    direction = PROJECT_DIRECTIONS[project_dir.name]
    before_hash = content_hash(project)
    timestamp = now_iso()
    song = {**project["song"], **{key: value for key, value in direction.items() if key != "title"}}
    song["genreReferences"] = [clean_text(value) for value in song.get("genreReferences", [])]
    song["prompt"] = build_prompt(song)
    blocks = []
    classifications = []
    for block in project["blocks"]:
        original_name = block["name"]
        category = category_for(original_name)
        updated_block = {
            **block,
            "name": RENAMES.get(original_name, original_name),
            "role": clean_text(block.get("role", "")),
            "instruments": [clean_text(value) for value in block.get("instruments", [])],
            "melodyDescription": clean_text(block.get("melodyDescription", "")),
            "melodyPrompt": clean_text(block.get("melodyPrompt", "")),
            "rhythmFeel": clean_text(block.get("rhythmFeel", "")),
            "timbre": clean_text(block.get("timbre", "")),
            "avoid": clean_text(block.get("avoid", "")),
            "validationCategory": category,
        }
        blocks.append(updated_block)
        classifications.append({"blockId": block["id"], "name": updated_block["name"], "category": category})

    updated = {
        **project,
        "title": direction["title"],
        "updatedAt": timestamp,
        "song": song,
        "blocks": blocks,
        "stems": [
            {
                **stem,
                "status": "stale" if stem["status"] in {"queued", "rendering", "ready"} else stem["status"],
                "queueOrder": None if stem["status"] in {"queued", "rendering", "ready"} else stem.get("queueOrder"),
                "staleReason": "SMTV prompt preflight changed project and block requirements." if stem["status"] in {"queued", "rendering", "ready"} else stem.get("staleReason"),
                "updatedAt": timestamp if stem["status"] in {"queued", "rendering", "ready"} else stem["updatedAt"],
            }
            for stem in project["stems"]
        ],
    }
    serialized_prompt_fields = " ".join(
        [song["prompt"], *[" ".join([block["name"], block["melodyDescription"], block["melodyPrompt"], block["avoid"]]) for block in blocks]]
    )
    if PROHIBITED.search(serialized_prompt_fields):
        raise RuntimeError(f"Prohibited lore/place name remains in {project_dir.name}: {PROHIBITED.search(serialized_prompt_fields).group(0)}")
    command = append_command(
        journal,
        command_type="preflight_smtv_prompts",
        summary=f"Preflighted whole-song direction and {len(blocks)} block prompts",
        payload={
            "review": "removed lore/place/character names, visual prose, duplication, contradictions, and low-priority noise",
            "classifications": classifications,
            "staleStemIds": [stem["id"] for stem in updated["stems"] if stem["status"] == "stale"],
        },
        before_hash=before_hash,
        after_hash=content_hash(updated),
    )
    write_json_atomic(project_path, updated)
    write_json_atomic(journal_path, command)
    print(f"preflighted: {project_dir}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Clean and classify all five SMTV GENOST projects without rendering.")
    parser.add_argument("--projects-root", type=Path, default=ROOT.parent / "ost_drafts")
    args = parser.parse_args()
    for folder in PROJECT_FOLDERS:
        migrate_project(args.projects_root.expanduser().resolve() / folder)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
