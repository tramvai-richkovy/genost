from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scripts.preflight_smtv_projects import DEFAULT_PROJECTS_ROOT, PROJECT_FOLDERS, category_for, migrate_project


def fixture_project() -> dict:
    return {
        "id": "project_fixture",
        "title": "old title",
        "updatedAt": "2026-01-01T00:00:00Z",
        "song": {
            "bpm": 100,
            "timeSignature": [4, 4],
            "swing": {"feel": "straight", "ratio": 1.0},
            "key": "D minor",
            "genreReferences": ["SMT V dark ambient"],
            "mood": "old",
            "purpose": "old",
            "referenceNotes": "old",
            "rhythmFeel": "old",
            "sonicPalette": "old",
            "productionNotes": "old",
            "arrangementNotes": "old",
            "avoid": "old",
            "prompt": "old",
        },
        "blocks": [{
            "id": "block_toms",
            "name": "Magatsuhi Pillar Toms",
            "role": "Magatsuhi ritual rhythm",
            "instruments": ["Tokyo metal"],
            "melodyDescription": "Asakusa pulse",
            "melodyPrompt": "Shinjuku pressure",
            "rhythmFeel": "straight",
            "timbre": "iron",
            "avoid": "SMT V melody",
        }],
        "stems": [{
            "id": "stem_ready",
            "status": "ready",
            "queueOrder": 1,
            "staleReason": None,
            "updatedAt": "2026-01-01T00:00:00Z",
        }],
    }


class SmtvPreflightTests(unittest.TestCase):
    def test_renamed_blocks_keep_their_reviewed_category(self) -> None:
        self.assertEqual(category_for("Pillar Toms"), "rhythm")
        self.assertEqual(category_for("Dust Organ"), "bass_drone")
        self.assertEqual(category_for("Spiral Pulse"), "rhythm")
        self.assertEqual(category_for("Static Veil"), "bass_drone")

    def test_second_preflight_is_byte_for_byte_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project_dir = Path(directory) / PROJECT_FOLDERS[0]
            project_dir.mkdir()
            project_path = project_dir / "genost.json"
            journal_path = project_dir / "commands.json"
            project_path.write_text(json.dumps(fixture_project()), encoding="utf-8")
            journal_path.write_text(json.dumps({
                "schemaVersion": 1,
                "projectId": "project_fixture",
                "updatedAt": "2026-01-01T00:00:00Z",
                "commands": [],
            }), encoding="utf-8")

            self.assertTrue(migrate_project(project_dir))
            first_project = project_path.read_bytes()
            first_journal = journal_path.read_bytes()
            migrated = json.loads(first_project)
            journal = json.loads(first_journal)

            self.assertEqual(migrated["blocks"][0]["name"], "Pillar Toms")
            self.assertEqual(migrated["blocks"][0]["validationCategory"], "rhythm")
            self.assertEqual(migrated["stems"][0]["status"], "stale")
            self.assertEqual(migrated["stems"][0]["queueOrder"], None)
            self.assertEqual(len(journal["commands"]), 1)
            self.assertEqual(journal["commands"][0]["actor"], "code-agent")
            self.assertEqual(journal["commands"][0]["source"], "code-agent")

            self.assertFalse(migrate_project(project_dir))
            self.assertEqual(project_path.read_bytes(), first_project)
            self.assertEqual(journal_path.read_bytes(), first_journal)

    def test_default_root_points_to_live_games_drafts(self) -> None:
        self.assertEqual(DEFAULT_PROJECTS_ROOT.name, "ost_drafts")
        self.assertEqual(DEFAULT_PROJECTS_ROOT.parent.name, "games")


if __name__ == "__main__":
    unittest.main()
