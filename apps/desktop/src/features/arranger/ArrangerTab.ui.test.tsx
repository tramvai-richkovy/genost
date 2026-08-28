// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { useStudioStore } from "../../app/store";
import { createCommandJournal, createEmptyProject } from "../../lib/project/format";
import { ArrangerTab } from "./ArrangerTab";

const originalState = useStudioStore.getState();

afterEach(() => {
  cleanup();
  useStudioStore.setState(originalState, true);
});

describe("ArrangerTab UI operations", () => {
  it("clones an arranged clip from the keyboard-accessible actions menu", async () => {
    const project = createEmptyProject("Arranger UI");
    useStudioStore.setState({
      ...originalState,
      activeProject: { path: null, project, commands: createCommandJournal(project.id) },
      musicAiMode: "offline",
      error: null,
      status: null,
    }, true);
    const user = userEvent.setup();
    render(<ArrangerTab />);

    await user.click(screen.getByTitle("Clip actions"));
    await user.click(screen.getByRole("button", { name: "Clone" }));

    const clips = useStudioStore.getState().activeProject?.project.arrangement.lanes.flatMap((lane) => lane.clips) ?? [];
    expect(clips).toHaveLength(2);
    expect(clips[1].startBar).toBe(16);
    expect(useStudioStore.getState().activeProject?.commands.commands.at(-1)?.type).toBe("clone_arranger_clip");
  });
});
