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
      projectScanIssues: [],
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

  it("shows the empty-folder state without presenting it as an error", () => {
    renderBrowser();

    expect(screen.getByText("This folder has no GENOST projects yet.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows an actionable permission state and suppresses project creation", () => {
    renderBrowser();
    useStudioStore.setState({
      error: "Refreshing projects failed because GENOST does not have filesystem permission for /tmp/genost-projects.",
    });
    cleanup();
    render(<ProjectBrowser />);

    expect(screen.getByText("Folder permission required")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Select Again" })).toBeTruthy();
    expect(screen.queryByRole("form", { name: "Create new project" })).toBeNull();
  });

  it("reports invalid projects while keeping valid project actions available", () => {
    renderBrowser();
    useStudioStore.setState({
      projectScanIssues: [
        { kind: "invalid", name: "Broken Sketch", path: "/tmp/genost-projects/Broken Sketch", message: "Invalid genost.json" },
      ],
    });
    cleanup();
    render(<ProjectBrowser />);

    expect(screen.getByText("Skipped 1 invalid or unreadable project")).toBeTruthy();
    expect(screen.getByText("Broken Sketch")).toBeTruthy();
    expect(screen.getByRole("form", { name: "Create new project" })).toBeTruthy();
  });
});
