// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { useStudioStore } from "../../app/store";
import { createCommandJournal, createEmptyProject } from "../../lib/project/format";
import { collectRequirements, queueComponentRequirement } from "../../lib/project/requirements";
import { RenderQueueTab } from "./RenderQueueTab";

const originalState = useStudioStore.getState();

afterEach(() => {
  cleanup();
  useStudioStore.setState(originalState, true);
});

describe("RenderQueueTab UI operations", () => {
  it("cancels a queued component and journals the action", async () => {
    const base = createEmptyProject("Cancel Queue UI");
    const project = queueComponentRequirement(base, collectRequirements(base)[0]);
    const queued = project.stems.find((stem) => stem.status === "queued");
    if (!queued) throw new Error("Expected queued stem");
    useStudioStore.setState({
      ...originalState,
      activeProject: { path: null, project, commands: createCommandJournal(project.id) },
      musicAiMode: "offline",
      error: null,
      status: null,
    }, true);
    const user = userEvent.setup();
    render(<RenderQueueTab />);

    await user.click(screen.getByTitle("Cancel queued render"));

    expect(useStudioStore.getState().activeProject?.project.stems.find((stem) => stem.id === queued.id)?.status).toBe("canceled");
    expect(useStudioStore.getState().activeProject?.commands.commands.at(-1)?.type).toBe("cancel_component_render");
  });
});
