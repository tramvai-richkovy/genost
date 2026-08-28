// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStudioStore } from "../../app/store";
import { SeparationBundleLoopPreview } from "../../lib/audio/separationBundlePreview";
import { createCommandJournal, createEmptyProject } from "../../lib/project/format";
import type { SeparationBundle } from "../../lib/schema/project";
import { PremixTab } from "./PremixTab";

const originalState = useStudioStore.getState();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useStudioStore.setState(originalState, true);
});

function readyBundle(): SeparationBundle {
  return {
    id: "bundle_ready",
    blockId: "block_fixture",
    sourceStemId: "stem_source",
    rawStemPath: "STEMS/source.wav",
    model: "htdemucs_6s.yaml",
    preferredTarget: "other",
    status: "ready",
    selectedOutputIds: [],
    outputs: [{
      id: "output_other",
      label: "other",
      fileName: "other.wav",
      filePath: "/Projects/Premix Test/STEMS/SEPARATIONS/bundle_ready/other.wav",
      status: "ready",
      volumeDb: 0,
      durationSeconds: 8,
      peak: 0.5,
      createdAt: "2026-08-27T00:00:00Z",
    }],
    merges: [],
    previewMetadata: {},
    errorCode: null,
    error: null,
    createdAt: "2026-08-27T00:00:00Z",
    updatedAt: "2026-08-27T00:00:00Z",
  };
}

function renderPremix() {
  const project = createEmptyProject("Premix Test");
  project.blocks[0] = { ...project.blocks[0], id: "block_fixture", name: "Atmosphere" };
  project.separationBundles = [readyBundle()];
  useStudioStore.setState({
    ...originalState,
    activeProject: { path: null, project, commands: createCommandJournal(project.id) },
    activeTab: "premix",
    saveState: "saved",
  }, true);
  render(<PremixTab />);
}

describe("PremixTab", () => {
  it("starts a synchronized looping bundle preview and applies live fader changes", async () => {
    const setVolume = vi.fn();
    const stop = vi.fn();
    const create = vi.spyOn(SeparationBundleLoopPreview, "create").mockResolvedValue({ setVolume, stop } as never);
    const user = userEvent.setup();
    renderPremix();

    await user.click(screen.getByRole("button", { name: "Play Loop" }));
    await waitFor(() => expect(screen.getByText("Looping bundle")).toBeTruthy());
    expect(create).toHaveBeenCalledWith([{
      id: "output_other",
      path: "/Projects/Premix Test/STEMS/SEPARATIONS/bundle_ready/other.wav",
      volumeDb: 0,
    }]);

    const fader = screen.getByLabelText("other premix volume");
    fireEvent.change(fader, { target: { value: "-12" } });
    expect(setVolume).toHaveBeenCalledWith("output_other", -12);
    fireEvent.pointerUp(fader, { target: { value: "-12" } });

    expect(useStudioStore.getState().activeProject?.project.separationBundles[0].outputs[0].volumeDb).toBe(-12);
    expect(useStudioStore.getState().activeProject?.commands.commands.at(-1)?.type).toBe("set_separation_output_volume");
  });
});
