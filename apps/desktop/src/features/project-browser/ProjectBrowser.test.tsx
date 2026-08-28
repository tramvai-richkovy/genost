// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStudioStore } from "../../app/store";
import { ProjectBrowser } from "./ProjectBrowser";

const originalState = useStudioStore.getState();

afterEach(() => {
  cleanup();
  useStudioStore.setState(originalState, true);
  vi.restoreAllMocks();
});

function renderBrowser(createProject = vi.fn().mockResolvedValue(undefined)) {
  useStudioStore.setState(
    {
      ...originalState,
      activeProject: null,
      error: null,
      musicAiMode: "online",
      projects: [],
      projectsRoot: "/tmp/genost-projects",
      status: null,
      createProject,
    },
    true,
  );

  render(<ProjectBrowser />);
  return { createProject };
}

describe("ProjectBrowser", () => {
  it("creates a project when the create tile title is clicked", async () => {
    const user = userEvent.setup();
    const { createProject } = renderBrowser();

    await user.click(screen.getByText("Create New Project"));

    expect(createProject).toHaveBeenCalledWith("GENOST Sketch");
  });

  it("creates a project when Enter is pressed in the title field", async () => {
    const user = userEvent.setup();
    const { createProject } = renderBrowser();
    const titleField = screen.getByLabelText("New project title");

    await user.clear(titleField);
    await user.type(titleField, "Broken Chrome Floor{Enter}");

    expect(createProject).toHaveBeenCalledWith("Broken Chrome Floor");
  });
});
