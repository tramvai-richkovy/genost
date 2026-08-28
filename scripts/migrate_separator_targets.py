#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Literal

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from genost_worker.persistence import append_command, content_hash, now_iso, read_json, write_json_atomic  # noqa: E402

SeparatorTarget = Literal["bass", "drums", "guitar", "piano", "vocals", "other", "instrumental"]

SMTV_SEPARATOR_TARGETS: dict[str, SeparatorTarget] = {
    "Atmosphere": "other",
    "Percussion Organic Layer": "drums",
    "Horn": "other",
    "Beat": "drums",
    "Melody": "other",
    "Guitar ambient lead": "guitar",
    "Choir Stabs": "vocals",
    "Bass Toms": "bass",
    "Salt Glass Pad": "other",
    "Container Pulse": "drums",
    "Sludge Tide Bass": "bass",
    "Fairy Bell Codes": "other",
    "Breathing Choir Grain": "vocals",
    "Worn Guitar Harmonics": "guitar",
    "Rail Noise Bloom": "other",
    "Siege Drone": "other",
    "War Machine Kick": "drums",
    "Magatsuhi Pillar Toms": "drums",
    "Analog Basilica Alarm": "other",
    "Castle Gate Choir": "vocals",
    "Scraped Guitar Swarm": "guitar",
    "Acid Oracle Bass": "bass",
    "Broken Edict Bell": "other",
    "Ueno Dust Organ": "other",
    "Asakusa Spiral Pulse": "drums",
    "Shrine Bell Coordinates": "other",
    "Seraphic Sub Choir": "vocals",
    "Mythic Tom Spiral": "drums",
    "Frozen Guitar Halo": "guitar",
    "Lost Deity Bass": "bass",
    "Final Gate Dust": "other",
    "Fogged Highrise Pad": "other",
    "Broken Neon Drums": "drums",
    "Vengeance Subline": "bass",
    "Wordless Cut Choir": "vocals",
    "Apartment Feedback Guitar": "guitar",
    "Rail Slice FX": "other",
    "Null Saint Piano": "piano",
    "Kabukicho Static Veil": "other",
}


def target_for_block(project_dir: Path, block: dict) -> SeparatorTarget:
    if project_dir.parent.name == "ost_drafts":
        try:
            return SMTV_SEPARATOR_TARGETS[block["name"]]
        except KeyError as exc:
            raise RuntimeError(f"No explicit SMTV separator target for {block['name']!r}") from exc
    return "instrumental"


def migrate_project(project_dir: Path) -> bool:
    project_path = project_dir / "genost.json"
    journal_path = project_dir / "commands.json"
    project = read_json(project_path)
    assignments = [
        {"blockId": block["id"], "blockName": block["name"], "separatorTarget": target_for_block(project_dir, block)}
        for block in project["blocks"]
    ]
    if all(block.get("separatorTarget") == assignment["separatorTarget"] for block, assignment in zip(project["blocks"], assignments)):
        return False

    before_hash = content_hash(project)
    timestamp = now_iso()
    updated = {
        **project,
        "updatedAt": timestamp,
        "blocks": [
            {**block, "separatorTarget": assignment["separatorTarget"]}
            for block, assignment in zip(project["blocks"], assignments)
        ],
    }
    journal = append_command(
        read_json(journal_path),
        command_type="set_block_separator_targets",
        summary=f"Assigned separator targets to {len(assignments)} blocks",
        payload={
            "model": "htdemucs_6s.yaml",
            "assignments": assignments,
            "reason": "mandatory_instrument_aware_post_generation_cleanup",
        },
        before_hash=before_hash,
        after_hash=content_hash(updated),
    )
    write_json_atomic(project_path, updated)
    write_json_atomic(journal_path, journal)
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Assign mandatory audio-separator targets to GENOST blocks.")
    parser.add_argument("project_dirs", nargs="+", type=Path)
    args = parser.parse_args()
    for project_dir in args.project_dirs:
        resolved = project_dir.expanduser().resolve()
        changed = migrate_project(resolved)
        print(f"{'migrated' if changed else 'unchanged'}: {resolved}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
