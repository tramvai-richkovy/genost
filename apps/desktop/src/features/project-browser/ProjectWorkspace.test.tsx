// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { useStudioStore } from "../../app/store";
import { createCommandJournal, createEmptyProject } from "../../lib/project/format";
import { ProjectWorkspace } from "./ProjectWorkspace";

const originalState = useStudioStore.getState();

afterEach(() => {
  cleanup();
  useStudioStore.setState(originalState, true);
});

function renderWorkspace() {
  const project = createEmptyProject("Workflow Test");
  useStudioStore.setState({
    ...originalState,
    activeProject: { path: null, project, commands: createCommandJournal(project.id) },
    activeTab: "composition",
    musicAiMode: "online",
    error: null,
    status: null,
    saveState: "saved",
  }, true);
  render(<ProjectWorkspace />);
}

describe("ProjectWorkspace", () => {
  it("navigates every studio surface and edits a block", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    for (const tab of ["Blocks", "Arranger", "Graph", "Premix", "Components", "Player", "Composition"]) {
      await user.click(screen.getByRole("button", { name: tab }));
      expect(useStudioStore.getState().activeTab).toBe(tab.toLowerCase() === "components" ? "components" : tab.toLowerCase());
    }

    await user.click(screen.getByRole("button", { name: "Blocks" }));
    const name = screen.getByLabelText("Block name");
    await user.clear(name);
    await user.type(name, "Edited Pulse");
    expect(useStudioStore.getState().activeProject?.project.blocks[0].name).toBe("Edited Pulse");
  });
});
