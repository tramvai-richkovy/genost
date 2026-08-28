from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from genost_worker.persistence import (
    append_command,
    archive_stem_pair,
    transition_stem,
    write_json_atomic,
    write_stem_sidecar,
)


class PersistenceTests(unittest.TestCase):
    def test_atomic_json_write_leaves_no_temporary_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "genost.json"
            write_json_atomic(path, {"schemaVersion": 1})
            self.assertEqual(json.loads(path.read_text()), {"schemaVersion": 1})
            self.assertEqual(list(path.parent.glob("*.tmp")), [])

    def test_sidecar_refuses_to_overwrite(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            audio = Path(directory) / "stem.wav"
            audio.write_bytes(b"wav")
            sidecar = write_stem_sidecar(audio, {"id": "stem-1"})
            self.assertEqual(json.loads(sidecar.read_text()), {"id": "stem-1"})
            with self.assertRaises(FileExistsError):
                write_stem_sidecar(audio, {"id": "stem-2"})

    def test_archive_moves_audio_and_sidecar_together(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            audio = project / "STEMS" / "stem.wav"
            audio.parent.mkdir()
            audio.write_bytes(b"wav")
            audio.with_suffix(".json").write_text("{}")
            archived_audio, archived_sidecar = archive_stem_pair(project, audio, reason="validation")
            self.assertFalse(audio.exists())
            self.assertTrue(archived_audio.name.startswith("REJECTED_"))
            self.assertTrue(archived_sidecar and archived_sidecar.exists())

    def test_transition_and_command_append_preserve_existing_records(self) -> None:
        project = {"updatedAt": "before", "stems": [{"id": "s1", "status": "ready"}, {"id": "s2"}]}
        updated = transition_stem(project, "s1", "archived", archivePath="ARCHIVE/s1.wav")
        self.assertEqual(updated["stems"][0]["status"], "archived")
        self.assertEqual(updated["stems"][1], {"id": "s2"})
        journal = {"commands": [{"id": "old"}], "updatedAt": "before"}
        changed = append_command(journal, command_type="archive_stem", summary="Archived", payload={"stemId": "s1"})
        self.assertEqual([item["id"] for item in changed["commands"][:1]], ["old"])
        self.assertEqual(changed["commands"][-1]["actor"], "code-agent")


if __name__ == "__main__":
    unittest.main()
