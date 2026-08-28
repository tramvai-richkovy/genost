// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const workerMocks = vi.hoisted(() => ({
  runWorkerPreflight: vi.fn(),
  getWorkerHealth: vi.fn().mockResolvedValue(null),
}));

vi.mock("../lib/worker-client/render", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/worker-client/render")>()),
  runWorkerPreflight: workerMocks.runWorkerPreflight,
  getWorkerHealth: workerMocks.getWorkerHealth,
}));

import { preflightAllowsStudio, useSessionStudioStore } from "./sessionStore";
import type { WorkerHealth } from "../lib/worker-client/render";

function preflight(backend: string, available = true): WorkerHealth["preflight"] {
  return {
    ok: available,
    backend,
    device: backend === "mlx" ? "metal" : "cpu",
    cache_paths: [],
    cache_writable: true,
    capabilities: {},
    models: {
      "facebook/musicgen-medium": {
        name: "facebook/musicgen-medium",
        available,
        cache_paths: [],
        error: null,
        download_hint: "",
      },
      "facebook/musicgen-melody": {
        name: "facebook/musicgen-melody",
        available,
        cache_paths: [],
        error: null,
        download_hint: "",
      },
    },
    errors: [],
  };
}

describe("session studio store", () => {
  beforeEach(() => {
    workerMocks.runWorkerPreflight.mockReset();
    useSessionStudioStore.setState({
      workspaceMetadata: {
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        knownTags: [],
        lastSelectedSessionId: null,
        sidebarCollapsed: false,
        modelSettings: { cachePath: "/models/a", hfHome: null, backend: "auto" },
      },
      workerPreflight: null,
      preflightChecking: false,
      error: null,
    });
  });

  it("requires both local MusicGen models", () => {
    const blocked = preflight("mlx");
    blocked.models["facebook/musicgen-melody"].available = false;
    expect(preflightAllowsStudio(blocked)).toBe(false);
    expect(preflightAllowsStudio(preflight("mlx"))).toBe(true);
  });

  it("does not let an older preflight response replace newer settings", async () => {
    let resolveFirst: (value: WorkerHealth["preflight"]) => void = () => undefined;
    let resolveSecond: (value: WorkerHealth["preflight"]) => void = () => undefined;
    workerMocks.runWorkerPreflight
      .mockImplementationOnce(
        () => new Promise<WorkerHealth["preflight"]>((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockImplementationOnce(
        () => new Promise<WorkerHealth["preflight"]>((resolve) => {
          resolveSecond = resolve;
        }),
      );

    const first = useSessionStudioStore.getState().checkPreflight();
    useSessionStudioStore.setState((state) => ({
      workspaceMetadata: state.workspaceMetadata
        ? {
            ...state.workspaceMetadata,
            modelSettings: { cachePath: "/models/b", hfHome: null, backend: "mlx" },
          }
        : null,
    }));
    const second = useSessionStudioStore.getState().checkPreflight();
    resolveSecond(preflight("mlx"));
    await second;
    resolveFirst(preflight("audiocraft"));
    await first;

    expect(useSessionStudioStore.getState().workerPreflight?.backend).toBe("mlx");
    expect(useSessionStudioStore.getState().preflightChecking).toBe(false);
  });
});
