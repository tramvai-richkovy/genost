// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStudioStore } from "../../app/store";
import { createCommandJournal, createEmptyProject } from "../../lib/project/format";
import { PlayerTab } from "./PlayerTab";

const mocks = vi.hoisted(() => ({ buildArrangerMix: vi.fn() }));
vi.mock("../../lib/audio/mixdown", () => ({ buildArrangerMix: mocks.buildArrangerMix }));

const originalState = useStudioStore.getState();

afterEach(() => {
  cleanup();
  useStudioStore.setState(originalState, true);
  mocks.buildArrangerMix.mockReset();
});

describe("PlayerTab", () => {
  it("builds a fixture-tone arrangement mix and persists its path", async () => {
    const project = createEmptyProject("Fixture Mix");
    useStudioStore.setState({
      ...originalState,
      activeProject: { path: "/tmp/fixture-project", project, commands: createCommandJournal(project.id) },
      error: null,
      status: null,
    }, true);
    mocks.buildArrangerMix.mockResolvedValue({
      absolutePath: "/tmp/fixture-project/MIXES/fixture.wav",
      relativePath: "MIXES/fixture.wav",
      durationSeconds: 2,
      peak: 0.8,
      loudnessDb: -14,
      normalizationGainDb: 2,
      skippedClips: [],
    });
    const user = userEvent.setup();
    render(<PlayerTab />);

    await user.click(screen.getByRole("button", { name: "Build Mix" }));

    expect(mocks.buildArrangerMix).toHaveBeenCalledOnce();
    expect(useStudioStore.getState().activeProject?.project.mix.lastBuildPath).toBe("MIXES/fixture.wav");
    expect(await screen.findByText(/all clips rendered/)).toBeTruthy();
  });
});
