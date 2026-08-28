from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from genost_worker.audiocraft_generator import AudioMetrics, GenerationResult, generate_fixture_tone
from scripts.recover_apocalyptic_tracks import REVISION, TRACKS, archive_project, assemble, export, generate_section


def journal(project_id: str = "project_fixture") -> dict:
    return {"schemaVersion": 1, "projectId": project_id, "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z", "commands": []}


def metrics() -> AudioMetrics:
    return AudioMetrics(16.0, 32000, 1, 0.5, -12, 0, 0.5, 0.2, 4000, 1200, 0.1, 2000)


class RecoveryScriptTests(unittest.TestCase):
    def test_archive_preserves_rejected_audio_and_sidecar(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            track = replace(TRACKS[0], slug="Fixture")
            project_dir = root / track.slug
            stem = project_dir / "STEMS" / "old.wav"
            stem.parent.mkdir(parents=True)
            stem.write_bytes(b"wav")
            stem.with_suffix(".json").write_text("{}", encoding="utf-8")
            (project_dir / "genost.json").write_text(json.dumps({"updatedAt": "x", "stems": [{"id": "old", "status": "ready", "filePath": "STEMS/old.wav"}], "mix": {"lastBuildPath": None}}), encoding="utf-8")
            (project_dir / "commands.json").write_text(json.dumps(journal()), encoding="utf-8")

            with patch("scripts.recover_apocalyptic_tracks.PROJECTS_ROOT", root):
                archive_project(track)

            updated = json.loads((project_dir / "genost.json").read_text(encoding="utf-8"))
            archived = project_dir / updated["stems"][0]["archivePath"]
            self.assertTrue(archived.exists())
            self.assertTrue(archived.with_suffix(".json").exists())

    def test_generation_retries_and_writes_attempt_report(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            track = replace(TRACKS[0], slug="Fixture")
            calls = 0

            def fake_generate(**kwargs: object) -> GenerationResult:
                nonlocal calls
                calls += 1
                if calls == 1:
                    raise RuntimeError("candidate failed")
                generate_fixture_tone(str(kwargs["output_path"]), 1)
                return GenerationResult(str(kwargs["output_path"]), "mlx", "metal", "fixture", 0.1, metrics())

            with (
                patch("scripts.recover_apocalyptic_tracks.PROJECTS_ROOT", root),
                patch("scripts.recover_apocalyptic_tracks.load_existing", return_value=None),
                patch("scripts.recover_apocalyptic_tracks.generate_with_metadata", side_effect=fake_generate),
            ):
                generated = generate_section(track, 0, None)

            self.assertEqual(calls, 2)
            self.assertTrue(generated["audio"].exists())
            self.assertTrue((root / track.slug / "JOBS" / f"{REVISION}_section_01_attempts.json").exists())

    def test_generation_exhaustion_writes_every_failure(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            track = replace(TRACKS[0], slug="Fixture")

            with (
                patch("scripts.recover_apocalyptic_tracks.PROJECTS_ROOT", root),
                patch("scripts.recover_apocalyptic_tracks.load_existing", return_value=None),
                patch("scripts.recover_apocalyptic_tracks.generate_with_metadata", side_effect=RuntimeError("mock generation failed")),
                self.assertRaisesRegex(RuntimeError, "No valid candidate"),
            ):
                generate_section(track, 0, None)

            report = root / track.slug / "JOBS" / f"{REVISION}_section_01_failures.json"
            payload = json.loads(report.read_text(encoding="utf-8"))
            self.assertEqual(len(payload["failures"]), 3)
            self.assertTrue(all(failure["error"] == "mock generation failed" for failure in payload["failures"]))

    def test_archive_failure_keeps_project_and_journal_unchanged(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            track = replace(TRACKS[0], slug="Fixture")
            project_dir = root / track.slug
            stem = project_dir / "STEMS" / "old.wav"
            stem.parent.mkdir(parents=True)
            stem.write_bytes(b"wav")
            project = {"updatedAt": "x", "stems": [{"id": "old", "status": "ready", "filePath": "STEMS/old.wav"}], "mix": {"lastBuildPath": None}}
            commands = journal()
            (project_dir / "genost.json").write_text(json.dumps(project), encoding="utf-8")
            (project_dir / "commands.json").write_text(json.dumps(commands), encoding="utf-8")

            with (
                patch("scripts.recover_apocalyptic_tracks.PROJECTS_ROOT", root),
                patch("scripts.recover_apocalyptic_tracks.archive_stem_pair", side_effect=OSError("archive unavailable")),
                self.assertRaisesRegex(OSError, "archive unavailable"),
            ):
                archive_project(track)

            self.assertTrue(stem.exists())
            self.assertEqual(json.loads((project_dir / "genost.json").read_text(encoding="utf-8")), project)
            self.assertEqual(json.loads((project_dir / "commands.json").read_text(encoding="utf-8")), commands)

    def test_ffmpeg_mix_failure_removes_partial_wav(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            track = replace(TRACKS[0], slug="Fixture")
            project_dir = root / track.slug
            (project_dir / "STEMS").mkdir(parents=True)
            (project_dir / "MIXES").mkdir()
            (project_dir / "STEMS" / "stem.wav").write_bytes(b"fixture")
            project = {
                "id": "project_fixture", "updatedAt": "x",
                "stems": [{"id": "stem", "status": "ready", "filePath": "STEMS/stem.wav"}],
                "arrangement": {"lanes": [{"clips": [{"stemId": "stem", "startBar": 0}]}]},
                "song": {"arrangementNotes": ""}, "mix": {"lastBuildPath": None},
            }
            (project_dir / "genost.json").write_text(json.dumps(project), encoding="utf-8")
            (project_dir / "commands.json").write_text(json.dumps(journal()), encoding="utf-8")

            with (
                patch("scripts.recover_apocalyptic_tracks.PROJECTS_ROOT", root),
                patch("scripts.recover_apocalyptic_tracks.subprocess.run", side_effect=subprocess.CalledProcessError(1, "ffmpeg")),
                self.assertRaises(subprocess.CalledProcessError),
            ):
                assemble(track)

            self.assertEqual(list((project_dir / "MIXES").glob(".*.tmp.wav")), [])

    def test_mp3_export_failure_removes_partial_mp3(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.wav"
            source.write_bytes(b"fixture")
            track = replace(TRACKS[0], slug="Fixture", title="Fixture")
            with (
                patch("scripts.recover_apocalyptic_tracks.Path.home", return_value=root),
                patch("scripts.recover_apocalyptic_tracks.validate_generated_audio"),
                patch("scripts.recover_apocalyptic_tracks.subprocess.run", side_effect=subprocess.CalledProcessError(1, "ffmpeg")),
                self.assertRaises(subprocess.CalledProcessError),
            ):
                export([(track, source)])

            self.assertEqual(list((root / "Desktop").glob(".*.tmp.mp3")), [])


if __name__ == "__main__":
    unittest.main()
