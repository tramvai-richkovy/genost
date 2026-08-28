from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.render_smtv_suite import (
    PROJECT_FOLDERS,
    PROJECTS_ROOT,
    SMTV_VALIDATION_CATEGORY_BLOCKS,
    build_wav_mix,
    build_export_and_cleanup,
    collect_requirements,
    compose_requirement_prompt,
    compose_stem_prompt,
    existing_ready_stem,
    encode_mp3,
    latest_ready_stem_for_block,
    recover_interrupted_renders,
    render_project_with_separation,
    render_requirement,
    separate_project_stems,
    validation_category_for_block,
)


def fixture_project() -> dict:
    return {
        "song": {
            "prompt": "cold nocturnal techno",
            "bpm": 120,
            "key": "D minor",
            "timeSignature": [4, 4],
            "swing": {"feel": "straight", "ratio": 1.0},
        },
        "blocks": [
            {
                "id": "block_pad",
                "name": "Pad",
                "validationCategory": "bass_drone",
                "sourceType": "generated",
                "timeSignature": None,
                "role": "atmosphere",
                "instruments": ["synth pad"],
                "separatorTarget": "other",
                "soundCharacter": "dark",
                "melodyDescription": "slow minor chords",
                "melodyPrompt": "restrained harmonic motion",
                "rhythmFeel": "steady",
                "timbre": "dusty",
                "energy": 4,
                "density": 3,
                "avoid": "bright leads",
            }
        ],
        "arrangement": {
            "lanes": [
                {
                    "id": "lane_1",
                    "name": "Layer 1",
                    "clips": [
                        {
                            "id": "clip_v2",
                            "blockId": "block_pad",
                            "variation": 2,
                            "startBar": 0,
                            "bars": 4,
                            "inputBlockId": None,
                        },
                        {
                            "id": "clip_v1",
                            "blockId": "block_pad",
                            "variation": 1,
                            "startBar": 4,
                            "bars": 4,
                            "inputBlockId": None,
                        },
                    ],
                }
            ]
        },
        "stems": [],
    }


class VariationAnchorTests(unittest.TestCase):
    def test_existing_stem_matches_rounded_musicgen_duration(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project_dir = Path(directory)
            stem_path = project_dir / "STEMS" / "rounded.wav"
            stem_path.parent.mkdir()
            stem_path.write_bytes(b"fixture")
            project = fixture_project()
            project["stems"] = [
                {
                    "id": "stem_rounded",
                    "blockId": "block_pad",
                    "variation": 1,
                    "inputStemId": None,
                    "status": "ready",
                    "filePath": "STEMS/rounded.wav",
                    "durationSeconds": 15.0,
                    "updatedAt": "2026-08-26T00:00:00Z",
                }
            ]

            stem = existing_ready_stem(project, project_dir, "block_pad", 1, None, 14.5454545)

        self.assertIsNotNone(stem)
        self.assertEqual(stem["id"], "stem_rounded")

    def test_cross_block_dependency_stays_pinned_to_variation_one(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project_dir = Path(directory)
            stems_dir = project_dir / "STEMS"
            stems_dir.mkdir()
            (stems_dir / "anchor-v1.wav").write_bytes(b"fixture")
            (stems_dir / "newer-v2.wav").write_bytes(b"fixture")
            project = fixture_project()
            project["stems"] = [
                {
                    "id": "stem_v1",
                    "blockId": "block_pad",
                    "variation": 1,
                    "status": "ready",
                    "filePath": "STEMS/anchor-v1.wav",
                    "updatedAt": "2026-08-26T00:00:00Z",
                },
                {
                    "id": "stem_v2",
                    "blockId": "block_pad",
                    "variation": 2,
                    "status": "ready",
                    "filePath": "STEMS/newer-v2.wav",
                    "updatedAt": "2026-08-26T01:00:00Z",
                },
            ]

            source = latest_ready_stem_for_block(project, "block_pad", project_dir)

        self.assertIsNotNone(source)
        self.assertEqual(source["id"], "stem_v1")

    def test_later_variation_waits_for_variation_one(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            requirements = collect_requirements(fixture_project(), Path(directory))

        by_variation = {item["variation"]: item for item in requirements}
        self.assertFalse(by_variation[1]["inputMissing"])
        self.assertFalse(by_variation[1]["variationAnchor"])
        self.assertTrue(by_variation[2]["inputMissing"])
        self.assertTrue(by_variation[2]["variationAnchor"])
        self.assertEqual(by_variation[2]["waitingFor"], "Pad v1")
        self.assertEqual([item["variation"] for item in requirements], [1, 2])

    def test_later_variation_uses_ready_variation_one_as_input(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project_dir = Path(directory)
            stem_path = project_dir / "STEMS" / "pad_v01.wav"
            stem_path.parent.mkdir()
            stem_path.write_bytes(b"fixture")
            project = fixture_project()
            project["stems"] = [
                {
                    "id": "stem_anchor",
                    "blockId": "block_pad",
                    "variation": 1,
                    "inputStemId": None,
                    "status": "ready",
                    "filePath": "STEMS/pad_v01.wav",
                    "durationSeconds": 8.0,
                    "updatedAt": "2026-08-26T00:00:00Z",
                }
            ]

            requirements = collect_requirements(project, project_dir)

        variation = next(item for item in requirements if item["variation"] == 2)
        self.assertFalse(variation["inputMissing"])
        self.assertEqual(variation["inputStemId"], "stem_anchor")
        self.assertEqual(variation["variationAnchorStemId"], "stem_anchor")

    def test_variation_prompt_wraps_original_requirements(self) -> None:
        project = fixture_project()
        requirement = {
            "block": project["blocks"][0],
            "variation": 2,
            "bars": 4,
            "durationSeconds": 8.0,
            "variationAnchor": True,
        }

        prompt = compose_requirement_prompt(project, requirement)

        self.assertTrue(prompt.startswith("make variation of this stem; requirements: block: Pad"))
        self.assertIn("block: Pad", prompt)
        self.assertIn("variation 2", prompt)

    def test_block_direction_precedes_project_context(self) -> None:
        project = fixture_project()

        prompt = compose_stem_prompt(project, project["blocks"][0], 1, 4, 8.0)

        self.assertLess(prompt.index("block: Pad"), prompt.index("project context"))
        self.assertIn("project direction: cold nocturnal techno", prompt)

    def test_retry_report_retains_all_three_generation_failures(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project_dir = Path(directory)
            project = fixture_project()
            project.update({"id": "project_fixture", "title": "Fixture", "updatedAt": "2026-01-01T00:00:00Z"})
            project["song"].update({"defaultTextModel": "fixture", "modelCachePath": "", "sampleRate": 32000})
            project["blocks"][0].update({
                "importedStemId": None,
                "volumeDb": -6,
                "delaySend": 0,
                "reverbSend": 0,
                "compressorEnabled": False,
            })
            (project_dir / "genost.json").write_text(json.dumps(project), encoding="utf-8")
            (project_dir / "commands.json").write_text(json.dumps({"commands": [], "updatedAt": "x"}), encoding="utf-8")
            requirement = collect_requirements(project, project_dir)[0]

            with (
                patch("scripts.render_smtv_suite.generate_with_metadata", side_effect=RuntimeError("mock generation failed")),
                self.assertRaisesRegex(RuntimeError, "No valid candidate"),
            ):
                render_requirement(project_dir, requirement, "mlx")

            report = next((project_dir / "JOBS").glob("smtv_render_failures_*.json"))
            payload = json.loads(report.read_text(encoding="utf-8"))
            self.assertEqual(len(payload["failures"]), 3)
            self.assertEqual([failure["attempt"] for failure in payload["failures"]], [1, 2, 3])


class ValidationCategoryTests(unittest.TestCase):
    def test_every_smtv_block_has_exactly_one_reviewed_category(self) -> None:
        categorized_names = [name for names in SMTV_VALIDATION_CATEGORY_BLOCKS.values() for name in names]
        self.assertEqual(len(categorized_names), len(set(categorized_names)))

        blocks = []
        for folder in PROJECT_FOLDERS:
            project = json.loads((PROJECTS_ROOT / folder / "genost.json").read_text(encoding="utf-8"))
            blocks.extend(project["blocks"])

        self.assertEqual(len(blocks), 39)
        self.assertTrue(all(block.get("validationCategory") in {"bass_drone", "rhythm", "melody"} for block in blocks))
        self.assertTrue(all(validation_category_for_block(block) != "generic" for block in blocks))

    def test_all_reviewed_prompts_are_block_first_and_concise(self) -> None:
        prohibited = ("smt v", "da-at", "minato", "shinagawa", "chiyoda", "ueno", "asakusa", "shinjuku", "kabukicho", "magatsuhi", "qadistu", "tokyo", "trent reznor")
        for folder in PROJECT_FOLDERS:
            project = json.loads((PROJECTS_ROOT / folder / "genost.json").read_text(encoding="utf-8"))
            all_prompt_text = project["song"]["prompt"].lower()
            for block in project["blocks"]:
                duration = block["bars"] * (block.get("timeSignature") or project["song"]["timeSignature"])[0] * 60 / project["song"]["bpm"]
                prompt = compose_stem_prompt(project, block, 1, block["bars"], duration)
                self.assertTrue(prompt.startswith(f"block: {block['name']}"))
                self.assertLess(len(prompt.split()), 220, f"Prompt is still too long for {project['title']} / {block['name']}")
                all_prompt_text += " " + prompt.lower()
            self.assertFalse(any(term in all_prompt_text for term in prohibited), f"Lore/place text remains in {project['title']}")

    def test_unreviewed_block_is_rejected(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "exactly one validation category"):
            validation_category_for_block({"name": "Unreviewed Layer"})

    def test_interrupted_render_is_recovered_as_canceled(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project_dir = Path(directory)
            (project_dir / "genost.json").write_text(
                json.dumps(
                    {
                        "title": "Fixture",
                        "updatedAt": "2026-08-26T00:00:00Z",
                        "stems": [{"id": "stem_rendering", "status": "rendering", "queueOrder": None}],
                    }
                ),
                encoding="utf-8",
            )
            (project_dir / "commands.json").write_text(json.dumps({"commands": []}), encoding="utf-8")

            recovered = recover_interrupted_renders(project_dir)
            project = json.loads((project_dir / "genost.json").read_text(encoding="utf-8"))
            journal = json.loads((project_dir / "commands.json").read_text(encoding="utf-8"))

        self.assertEqual(recovered, 1)
        self.assertEqual(project["stems"][0]["status"], "canceled")
        self.assertEqual(journal["commands"][0]["type"], "render_components_recovered")

    def test_mix_build_creates_missing_mixes_directory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project_dir = Path(directory)
            project = {"title": "Fixture Mix", "mix": {"outputGainDb": 0}}
            sources = [
                {
                    "path": project_dir / "STEMS" / "fixture.wav",
                    "startSeconds": 0.0,
                    "durationSeconds": 1.0,
                    "block": {"volumeDb": -6},
                }
            ]

            def publish_fake_mix(command: list[str], **_kwargs: object) -> None:
                Path(command[-1]).write_bytes(b"fixture wav")

            with (
                patch("scripts.render_smtv_suite.subprocess.run", side_effect=publish_fake_mix),
                patch("scripts.render_smtv_suite.validate_generated_audio"),
                patch("scripts.render_smtv_suite.probe_duration", return_value=1.0),
            ):
                output, duration = build_wav_mix(project, project_dir, sources)

        self.assertEqual(duration, 1.0)
        self.assertEqual(output.name, "fixture_mix_final.wav")

    def test_mp3_export_failure_removes_intermediate_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "mix.wav"
            target = root / "mix.mp3"
            source.write_bytes(b"fixture")

            def fail(command: list[str], **_kwargs: object) -> None:
                Path(command[-1]).write_bytes(b"partial")
                raise RuntimeError("mp3 failed")

            with (
                patch("scripts.render_smtv_suite.subprocess.run", side_effect=fail),
                self.assertRaisesRegex(RuntimeError, "mp3 failed"),
            ):
                encode_mp3(source, target, 1.0)

            self.assertFalse(target.exists())
            self.assertEqual(list(root.glob(".*.tmp.mp3")), [])

    def test_successful_export_removes_only_intermediate_mix_wav(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project_dir = Path(directory) / "project"
            output_dir = Path(directory) / "output"
            project_dir.mkdir()
            output_dir.mkdir()
            project = {"id": "project_fixture", "title": "Fixture", "updatedAt": "x", "mix": {"lastBuildPath": None}}
            (project_dir / "genost.json").write_text(json.dumps(project), encoding="utf-8")
            (project_dir / "commands.json").write_text(json.dumps({"commands": [], "updatedAt": "x"}), encoding="utf-8")
            source_wav = project_dir / "MIXES" / "fixture_final.wav"

            def fake_build(*_args: object) -> tuple[Path, float]:
                source_wav.parent.mkdir()
                source_wav.write_bytes(b"wav")
                return source_wav, 2.0

            def fake_encode(_source: Path, target: Path, _duration: float) -> None:
                target.write_bytes(b"mp3")

            def fake_copy(_project: dict, source: Path, target_dir: Path) -> Path:
                target = target_dir / "Fixture.mp3"
                target.write_bytes(source.read_bytes())
                return target

            with (
                patch("scripts.render_smtv_suite.mix_sources", return_value=([{"stem": {"id": "stem", "filePath": "STEMS/stem.wav"}, "path": project_dir / "STEMS/stem.wav"}], [])),
                patch("scripts.render_smtv_suite.build_wav_mix", side_effect=fake_build),
                patch("scripts.render_smtv_suite.encode_mp3", side_effect=fake_encode),
                patch("scripts.render_smtv_suite.copy_mp3_to_output", side_effect=fake_copy),
            ):
                build_export_and_cleanup(project_dir, output_dir)

            self.assertFalse(source_wav.exists())
            self.assertTrue((project_dir / "MIXES" / "fixture_final.mp3").exists())
            self.assertTrue((output_dir / "Fixture.mp3").exists())


class SeparationRegenerationTests(unittest.TestCase):
    def test_incomplete_outputs_reject_source_and_stale_descendants(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project_dir = Path(directory)
            source_path = project_dir / "STEMS" / "pad.wav"
            child_path = project_dir / "STEMS" / "pad-v2.wav"
            source_path.parent.mkdir()
            source_path.write_bytes(b"source")
            child_path.write_bytes(b"child")
            project = fixture_project()
            project.update({"id": "project_fixture", "title": "Fixture", "updatedAt": "x", "separationBundles": []})
            source_stem = {
                "id": "stem_source",
                "blockId": "block_pad",
                "variation": 1,
                "inputStemId": None,
                "status": "ready",
                "filePath": "STEMS/pad.wav",
                "durationSeconds": 8.0,
                "updatedAt": "2026-01-01T00:00:00Z",
            }
            child_stem = {
                "id": "stem_child",
                "blockId": "block_pad",
                "variation": 2,
                "inputStemId": "stem_source",
                "status": "ready",
                "filePath": "STEMS/pad-v2.wav",
                "durationSeconds": 8.0,
                "updatedAt": "2026-01-01T00:00:00Z",
            }
            project["stems"] = [source_stem, child_stem]
            (project_dir / "genost.json").write_text(json.dumps(project), encoding="utf-8")
            (project_dir / "commands.json").write_text(json.dumps({"commands": [], "updatedAt": "x"}), encoding="utf-8")
            source = {"stem": source_stem, "block": project["blocks"][0], "path": source_path}
            error = __import__("genost_worker.separation", fromlist=["SeparationError"]).SeparationError(
                "separator_outputs_incomplete",
                "missing drums, guitar, piano, vocals, other",
            )

            with (
                patch("scripts.render_smtv_suite.mix_sources", return_value=([source], [])),
                patch("scripts.render_smtv_suite.separate_stem", side_effect=error),
            ):
                regeneration = separate_project_stems(project_dir)

            updated = json.loads((project_dir / "genost.json").read_text(encoding="utf-8"))
            statuses = {stem["id"]: stem["status"] for stem in updated["stems"]}
            self.assertIsNotNone(regeneration)
            self.assertEqual(statuses, {"stem_source": "failed", "stem_child": "stale"})
            self.assertTrue(updated["separationBundles"][0]["errorCode"], "separator_outputs_incomplete")
            self.assertEqual(regeneration["downstreamStemIds"], ["stem_child"])

    def test_incomplete_outputs_trigger_immediate_new_seed_range(self) -> None:
        regeneration = {
            "retryKey": ("block", 1, 4, None),
            "requirement": {"key": "fixture"},
            "sourceStemId": "stem_source",
            "downstreamStemIds": [],
            "projectTitle": "Fixture",
            "blockName": "Pad",
            "variation": 1,
        }

        with (
            patch("scripts.render_smtv_suite.render_project") as render_project_mock,
            patch("scripts.render_smtv_suite.separate_project_stems", side_effect=[regeneration, None]),
            patch("scripts.render_smtv_suite.render_requirement") as render_requirement_mock,
            patch("scripts.render_smtv_suite.clear_model_cache"),
        ):
            render_project_with_separation(Path("/fixture"), "mlx")

        self.assertEqual(render_project_mock.call_count, 2)
        self.assertEqual(render_requirement_mock.call_count, 1)
        self.assertEqual(render_requirement_mock.call_args.kwargs["seed_attempt_offset"], 3)


if __name__ == "__main__":
    unittest.main()
