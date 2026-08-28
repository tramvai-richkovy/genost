from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import genost_worker.api as api
from fastapi.middleware.cors import CORSMiddleware
from genost_worker.audiocraft_generator import AudioMetrics, GenerationResult
from genost_worker.jobs import jobs
from genost_worker.schemas import GenerationRequest, SeparationMergeRequest, SeparationRequest
from genost_worker.separation import MergeResult, SeparatedOutput, SeparationError, SeparationResult


def generation_result(path: Path, *, model: str = "facebook/musicgen-medium") -> GenerationResult:
    return GenerationResult(
        output_path=str(path),
        backend="mlx",
        device="metal",
        model=model,
        generation_seconds=3.5,
        metrics=AudioMetrics(
            duration_seconds=4.0,
            sample_rate=32000,
            channels=2,
            peak=0.8,
            rms_db=-12.0,
            dc_offset=0.0,
            energy_below_500_hz=0.3,
            energy_above_2000_hz=0.2,
            rolloff_85_hz=5000,
            spectral_centroid_hz=2200,
            spectral_flatness=0.05,
            zero_crossings_per_second=2200,
        ),
    )


class WorkerApiTests(unittest.TestCase):
    def setUp(self) -> None:
        jobs.clear()
        api._module_available.cache_clear()
        api._module_installed.cache_clear()

    def submit(self, request: GenerationRequest):
        with patch.object(api._render_executor, "submit") as submit:
            response = api.render(request)
        self.assertEqual(response.status, "queued")
        callback, callback_request = submit.call_args.args
        self.assertEqual(callback_request, request)
        return callback

    def test_fixture_job_runs_asynchronously_and_keeps_response_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "fixture.wav"
            request = GenerationRequest(
                job_id="job_fixture",
                kind="fixture",
                prompt="fixture tone",
                output_path=str(output),
                duration_seconds=1,
            )
            callback = self.submit(request)
            with patch("genost_worker.api.generate_fixture_tone", return_value=str(output)) as generate:
                callback(request)

            generate.assert_called_once_with(str(output), 1)
            job = api.job_status(request.job_id)
            self.assertEqual(job["status"], "ready")
            self.assertEqual(job["progress"], 1.0)
            self.assertEqual(job["details"]["output_path"], str(output))
            self.assertEqual(job["details"]["sample_rate"], 32000)
            self.assertIsNone(job["details"]["backend"])

    def test_text_conditioned_and_continuation_requests_route_all_generation_fields(self) -> None:
        cases = [
            ("text", None, "facebook/musicgen-medium"),
            ("conditioned", "/tmp/reference.wav", "facebook/musicgen-melody"),
            ("continuation", "/tmp/source.wav", "facebook/musicgen-medium"),
        ]
        for index, (kind, reference_path, result_model) in enumerate(cases):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as directory:
                output = Path(directory) / f"{kind}.wav"
                request = GenerationRequest(
                    job_id=f"job_route_{index}",
                    kind=kind,
                    prompt=f"isolated {kind} stem",
                    output_path=str(output),
                    duration_seconds=4,
                    reference_audio_path=reference_path,
                    seed=123 + index,
                    backend="mlx",
                    audio_validation_profile="music",
                    audio_content_category="melody",
                )
                callback = self.submit(request)
                result = generation_result(output, model=result_model)
                with patch("genost_worker.api.generate_with_metadata", return_value=result) as generate:
                    callback(request)

                kwargs = generate.call_args.kwargs
                self.assertEqual(kwargs["kind"], kind)
                self.assertEqual(kwargs["prompt"], request.prompt)
                self.assertEqual(kwargs["reference_audio_path"], reference_path)
                self.assertEqual(kwargs["seed"], request.seed)
                self.assertEqual(kwargs["backend"], "mlx")
                self.assertEqual(kwargs["validation_profile"], "music")
                self.assertEqual(kwargs["content_category"], "melody")
                self.assertTrue(callable(kwargs["progress_callback"]))
                job = api.job_status(request.job_id)
                self.assertEqual(job["status"], "ready")
                self.assertEqual(job["details"]["model"], result_model)
                self.assertEqual(job["details"]["validation_metrics"]["peak"], 0.8)

    def test_cancel_before_worker_start_never_calls_generator(self) -> None:
        request = GenerationRequest(
            job_id="job_cancel_queued",
            kind="text",
            prompt="isolated bass",
            output_path="/tmp/genost-canceled-before-start.wav",
            duration_seconds=4,
        )
        callback = self.submit(request)
        cancel_response = api.cancel_job(request.job_id)
        self.assertTrue(cancel_response["cancel_requested"])
        with patch("genost_worker.api.generate_with_metadata") as generate:
            callback(request)
        generate.assert_not_called()
        self.assertEqual(api.job_status(request.job_id)["status"], "canceled")

    def test_active_cancel_interrupts_progress_and_removes_partial_output(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "partial.wav"
            request = GenerationRequest(
                job_id="job_cancel_active",
                kind="text",
                prompt="isolated pad",
                output_path=str(output),
                duration_seconds=4,
            )
            callback = self.submit(request)

            def cancel_during_generation(**kwargs):
                output.write_bytes(b"partial")
                jobs.request_cancel(request.job_id)
                kwargs["progress_callback"](1, 10)
                raise AssertionError("progress callback should interrupt generation")

            with patch("genost_worker.api.generate_with_metadata", side_effect=cancel_during_generation):
                callback(request)

            job = api.job_status(request.job_id)
            self.assertEqual(job["status"], "canceled")
            self.assertFalse(output.exists())

    def test_failure_keeps_structured_error_for_desktop_reconciliation(self) -> None:
        request = GenerationRequest(
            job_id="job_failed_details",
            kind="text",
            prompt="isolated bass",
            output_path="/tmp/unused-genost-test.wav",
            duration_seconds=4,
        )
        callback = self.submit(request)
        with patch("genost_worker.api.generate_with_metadata", side_effect=RuntimeError("model unavailable")):
            callback(request)

        job = api.job_status(request.job_id)
        self.assertEqual(job["status"], "failed")
        self.assertEqual(job["details"]["error_code"], "unsupported_runtime")
        self.assertEqual(job["details"]["error"], "model unavailable")
        self.assertIsNotNone(job["finished_at"])

    def test_unknown_job_lookup_and_cancel_return_404(self) -> None:
        with self.assertRaises(api.HTTPException) as lookup_error:
            api.job_status("missing")
        self.assertEqual(lookup_error.exception.status_code, 404)
        with self.assertRaises(api.HTTPException) as cancel_error:
            api.cancel_job("missing")
        self.assertEqual(cancel_error.exception.status_code, 404)

    def test_dependency_capability_checks_are_cached(self) -> None:
        with patch("builtins.__import__", side_effect=ImportError("missing")) as import_module:
            self.assertFalse(api._module_available("missing_genost_dependency"))
            self.assertFalse(api._module_available("missing_genost_dependency"))
        import_module.assert_called_once_with("missing_genost_dependency")

        with patch("genost_worker.api.find_spec", return_value=None) as find_module:
            self.assertFalse(api._module_installed("missing_genost_package"))
            self.assertFalse(api._module_installed("missing_genost_package"))
        find_module.assert_called_once_with("missing_genost_package")

    def test_desktop_origins_can_reach_worker_api(self) -> None:
        middleware = next(item for item in api.app.user_middleware if item.cls is CORSMiddleware)

        self.assertIn("http://localhost:1420", middleware.kwargs["allow_origins"])
        self.assertIn("http://tauri.localhost", middleware.kwargs["allow_origins"])
        self.assertIn("POST", middleware.kwargs["allow_methods"])
        self.assertIn("Content-Type", middleware.kwargs["allow_headers"])

    def test_separation_and_merge_return_structured_results(self) -> None:
        separation_request = SeparationRequest(bundle_id="bundle", source_stem_path="/tmp/raw.wav", bundle_path="/tmp/bundle")
        separation_result = SeparationResult(
            "htdemucs_6s.yaml",
            "/tmp/raw.wav",
            "/tmp/bundle",
            [SeparatedOutput("bass", "bass.wav", "/tmp/bundle/bass.wav", 1.0, 0.5)],
        )
        with patch("genost_worker.api.separate_stem", return_value=separation_result):
            response = api.separate(separation_request)
        self.assertEqual(response.status, "ready")
        self.assertEqual(response.outputs[0].label, "bass")

        merge_request = SeparationMergeRequest(merge_id="merge", output_paths=["/tmp/bass.wav"], input_gains_db=[-6], destination_path="/tmp/merge.wav")
        with patch("genost_worker.api.merge_separated_outputs", return_value=MergeResult("merge.wav", "/tmp/merge.wav", 1.0, 0.5)) as merge_mock:
            merge_response = api.separation_merge(merge_request)
        self.assertEqual(merge_response.status, "ready")
        self.assertEqual(merge_response.file_path, "/tmp/merge.wav")
        merge_mock.assert_called_once_with(["/tmp/bass.wav"], "/tmp/merge.wav", input_gains_db=[-6.0])

    def test_separation_failure_preserves_error_code(self) -> None:
        request = SeparationRequest(bundle_id="bundle", source_stem_path="/tmp/raw.wav", bundle_path="/tmp/bundle")
        with patch("genost_worker.api.separate_stem", side_effect=SeparationError("separator_outputs_incomplete", "missing piano")):
            response = api.separate(request)
        self.assertEqual(response.status, "failed")
        self.assertEqual(response.error_code, "separator_outputs_incomplete")


if __name__ == "__main__":
    unittest.main()
