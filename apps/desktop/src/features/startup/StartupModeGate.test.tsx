// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStudioStore } from "../../app/store";
import type { WorkerHealth } from "../../lib/worker-client/render";
import { isAbsoluteModelCachePath, StartupModeGate } from "./StartupModeGate";

const mocks = vi.hoisted(() => ({ getWorkerHealth: vi.fn(), runWorkerPreflight: vi.fn() }));
vi.mock("../../lib/worker-client/render", () => ({
  getWorkerHealth: mocks.getWorkerHealth,
  runWorkerPreflight: mocks.runWorkerPreflight,
}));

const originalState = useStudioStore.getState();
const models = {
  "facebook/musicgen-medium": { name: "facebook/musicgen-medium", available: true, cache_paths: ["/models"], error: null, download_hint: "" },
  "facebook/musicgen-melody": { name: "facebook/musicgen-melody", available: true, cache_paths: ["/models"], error: null, download_hint: "" },
};

beforeEach(() => {
  window.localStorage.clear();
  mocks.runWorkerPreflight.mockResolvedValue({ ok: true, backend: "mlx", device: "metal", cache_paths: ["/models"], models, errors: [] });
  mocks.getWorkerHealth.mockResolvedValue({
    ok: true,
    python: "3.11",
    torch_available: true,
    mps_available: true,
    audiocraft_available: false,
    torchaudio_available: true,
    ffmpeg_available: true,
    mlx_available: true,
    generation_backend: "mlx",
    device: "metal",
    cache_paths: ["/models"],
    medium_model_available: true,
    melody_model_available: true,
    preflight: { ok: true, backend: "mlx", device: "metal", cache_paths: ["/models"], models, errors: [] },
  } satisfies WorkerHealth);
});

afterEach(() => {
  cleanup();
  useStudioStore.setState(originalState, true);
  vi.clearAllMocks();
});

describe("StartupModeGate", () => {
  it("validates the selected cache/backend and enables rendering only after preflight passes", async () => {
    const user = userEvent.setup();
    render(<StartupModeGate />);

    expect(await screen.findByText("MLX · metal")).toBeTruthy();
    const onlineButton = screen.getByRole("button", { name: /Yes, render enabled/ }) as HTMLButtonElement;
    expect(onlineButton.disabled).toBe(false);

    await user.selectOptions(screen.getByLabelText("Generation Backend"), "audiocraft");
    await waitFor(() => {
      expect(mocks.runWorkerPreflight).toHaveBeenLastCalledWith({
        model_cache_path: null,
        hf_home: null,
        backend: "audiocraft",
      });
    });
    expect(window.localStorage.getItem("genost-default-backend")).toBe("audiocraft");
  });

  it("recognizes empty, POSIX, and Windows cache locations but rejects relative paths", () => {
    expect(isAbsoluteModelCachePath("")).toBe(true);
    expect(isAbsoluteModelCachePath("/Volumes/Models")).toBe(true);
    expect(isAbsoluteModelCachePath("D:\\Models")).toBe(true);
    expect(isAbsoluteModelCachePath("models/musicgen")).toBe(false);
  });
});
