// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { useStudioStore } from "../../app/store";
import { createCommandJournal, createEmptyProject, withGeneratedCompositionPrompt } from "../../lib/project/format";
import { CompositionTab } from "./CompositionTab";

const originalState = useStudioStore.getState();

afterEach(() => {
  cleanup();
  useStudioStore.setState(originalState, true);
});

function renderCompositionWithEmptyGenres() {
  const project = createEmptyProject("Genre Draft Test");
  const projectWithoutGenres = {
    ...project,
    song: withGeneratedCompositionPrompt({
      ...project.song,
      genreReferences: [],
    }),
  };

  useStudioStore.setState(
    {
      ...originalState,
      activeProject: {
        path: null,
        project: projectWithoutGenres,
        commands: createCommandJournal(projectWithoutGenres.id),
      },
      error: null,
      projectsRoot: null,
      status: null,
      workspaceGenreReferences: [],
    },
    true,
  );

  render(<CompositionTab />);
}

describe("CompositionTab", () => {
  it("keeps a trailing comma in the genre references input while committing tags", async () => {
    const user = userEvent.setup();
    renderCompositionWithEmptyGenres();
    const genreReferencesField = screen.getByLabelText(/Genre References/i) as HTMLInputElement;

    await user.type(genreReferencesField, "breakcore, ");

    expect(genreReferencesField.value).toBe("breakcore, ");
    expect(screen.getByText("breakcore")).toBeTruthy();

    await user.type(genreReferencesField, "jungle");

    expect(genreReferencesField.value).toBe("breakcore, jungle");
    expect(useStudioStore.getState().activeProject?.project.song.genreReferences).toEqual(["breakcore", "jungle"]);

    await user.tab();

    expect(genreReferencesField.value).toBe("breakcore, jungle");
  });
});
