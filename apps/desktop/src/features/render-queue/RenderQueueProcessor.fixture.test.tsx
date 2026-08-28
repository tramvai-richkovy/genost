// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStudioStore } from "../../app/store";
import { createCommandJournal, createEmptyProject } from "../../lib/project/format";
import { collectRequirements, queueComponentRequirement } from "../../lib/project/requirements";
import { RenderQueueProcessor } from "./RenderQueueProcessor";

const mocks = vi.hoisted(() => ({ renderStem: vi.fn(), writeStemSidecar: vi.fn(), saveLoadedProject: vi.fn() }));

vi.mock("@tauri-apps/api/path", () => ({ join: (...parts: string[]) => Promise.resolve(parts.join("/")) }));
vi.mock("../../lib/project/storage", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/project/storage")>();
  return { ...original, writeStemSidecar: mocks.writeStemSidecar, saveLoadedProject: mocks.saveLoadedProject };
});
vi.mock("../../lib/worker-client/render", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/worker-client/render")>();
  return { ...original, renderStem: mocks.renderStem };
});

const originalState = useStudioStore.getState();

beforeEach(() => {
  mocks.writeStemSidecar.mockResolvedValue(undefined);
  mocks.saveLoadedProject.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  mocks.renderStem.mockReset();
  mocks.writeStemSidecar.mockReset();
  mocks.saveLoadedProject.mockReset();
  useStudioStore.setState(originalState, true);
});

describe("desktop fixture-tone queue", () => {
  it("processes a queued requirement through persistence without invoking a model kind", async () => {
    vi.stubEnv("VITE_GENOST_FIXTURE_TONE", "1");
    const base = createEmptyProject("Fixture Queue");
    const project = queueComponentRequirement(base, collectRequirements(base)[0]);
    const queued = project.stems.find((stem) => stem.status === "queued");
    if (!queued) throw new Error("Expected queued stem");
    mocks.renderStem.mockResolvedValue({
      job_id: queued.id,
      status: "ready",
      output_path: `/tmp/fixture/STEMS/${queued.fileName}`,
      sample_rate: 32000,
      backend: "fixture",
      device: "cpu",
      model: "fixture-tone",
      generation_seconds: 0.01,
      validation_metrics: { duration_seconds: queued.durationSeconds, peak: 0.5 },
      error_code: null,
      error: null,
    });
    useStudioStore.setState({
      ...originalState,
      activeProject: { path: "/tmp/fixture", project, commands: createCommandJournal(project.id) },
      musicAiMode: "online",
      error: null,
      status: null,
    }, true);

    render(<RenderQueueProcessor />);

    await waitFor(() => {
      expect(useStudioStore.getState().activeProject?.project.stems.find((stem) => stem.id === queued.id)?.status).toBe("ready");
    });
    expect(mocks.renderStem).toHaveBeenCalledOnce();
    expect(mocks.renderStem.mock.calls[0][0].kind).toBe("fixture");
    expect(mocks.writeStemSidecar).toHaveBeenCalledOnce();
    expect(useStudioStore.getState().activeProject?.project.blocks[0].implementedMelodies[0]?.stemId).toBe(queued.id);
    expect(useStudioStore.getState().activeProject?.commands.commands.map((command) => command.type)).toEqual([
      "render_component_started",
      "render_component_ready",
    ]);
  });
});
