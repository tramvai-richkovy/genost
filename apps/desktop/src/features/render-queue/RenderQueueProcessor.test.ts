import { describe, expect, it } from "vitest";
import { createEmptyProject } from "../../lib/project/format";
import type { WorkerJobStatus, WorkerRenderResponse } from "../../lib/worker-client/render";
import { audioContentCategoryForBlock, generationKindForRequest, getInterruptedRenderRecovery } from "./RenderQueueProcessor";

function makeWorkerJob(patch: Partial<WorkerJobStatus> & Pick<WorkerJobStatus, "status">): WorkerJobStatus {
  const { status, ...rest } = patch;
  return {
    job_id: "stem_1",
    status,
    message: "worker message",
    details: null,
    progress: 0,
    cancel_requested: false,
    started_at: null,
    finished_at: null,
    created_at: "2026-08-26T00:00:00.000Z",
    updated_at: "2026-08-26T00:00:00.000Z",
    ...rest,
  };
}

function makeWorkerResponse(patch: Partial<WorkerRenderResponse> = {}): WorkerRenderResponse {
  return {
    job_id: "stem_1",
    status: "ready",
    output_path: "/tmp/stem.wav",
    sample_rate: 32000,
    backend: "fixture",
    device: "cpu",
    model: "fixture-tone",
    generation_seconds: 1,
    validation_metrics: { peak: 0.5 },
    error_code: null,
    error: null,
    ...patch,
  };
}

describe("render queue processor", () => {
  it("routes a complete desktop queue request through fixture-tone mode without MusicGen", () => {
    expect(generationKindForRequest(false, true)).toBe("fixture");
    expect(generationKindForRequest(true, true)).toBe("fixture");
    expect(generationKindForRequest(true, false)).toBe("conditioned");
  });
  it("routes atmospheric drones through bass/drone validation", () => {
    const block = {
      ...createEmptyProject("Test").blocks[0],
      name: "Atmosphere",
      role: "harmonic atmosphere",
      instruments: ["granular desert wind pad", "low analog drone"],
    };

    expect(audioContentCategoryForBlock(block)).toBe("bass_drone");
  });

  it("routes percussion through rhythm validation", () => {
    const block = {
      ...createEmptyProject("Test").blocks[0],
      name: "Beat",
      role: "rhythm",
      instruments: ["kick", "metal percussion"],
      validationCategory: "generic" as const,
    };

    expect(audioContentCategoryForBlock(block)).toBe("rhythm");
  });

  it("uses a reviewed validation category instead of re-inferring it from prompt text", () => {
    const block = {
      ...createEmptyProject("Test").blocks[0],
      name: "Low warning drone",
      role: "bass atmosphere",
      instruments: ["sub drone"],
      validationCategory: "melody" as const,
    };

    expect(audioContentCategoryForBlock(block)).toBe("melody");
  });
});

describe("interrupted render reconciliation", () => {
  it("persists completed worker jobs", () => {
    expect(
      getInterruptedRenderRecovery(makeWorkerJob({ status: "ready", details: makeWorkerResponse() })),
    ).toEqual({ action: "persist-ready" });
  });

  it("requeues rendering stems when the worker has no matching job after restart", () => {
    expect(getInterruptedRenderRecovery(null)).toEqual({ action: "requeue" });
  });

  it("keeps waiting while the worker still owns the job", () => {
    expect(getInterruptedRenderRecovery(makeWorkerJob({ status: "rendering", progress: 0.4 }))).toEqual({
      action: "wait",
    });
  });

  it("preserves structured failure details", () => {
    expect(
      getInterruptedRenderRecovery(
        makeWorkerJob({
          status: "failed",
          details: makeWorkerResponse({
            status: "failed",
            output_path: null,
            error_code: "audio_validation_failed",
            error: "Generated audio failed music validation.",
          }),
        }),
      ),
    ).toEqual({
      action: "mark-failed",
      errorCode: "audio_validation_failed",
      message: "Generated audio failed music validation.",
    });
  });
});
