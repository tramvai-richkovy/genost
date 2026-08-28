// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { useStudioStore } from "../../app/store";
import { createCommandJournal, createEmptyProject, makeId } from "../../lib/project/format";
import { collectRequirements, createQueuedStem } from "../../lib/project/requirements";
import { BlocksTab } from "./BlocksTab";

const originalState = useStudioStore.getState();

afterEach(() => {
  cleanup();
  useStudioStore.setState(originalState, true);
});

function renderReadyMelody() {
  const project = createEmptyProject("Blocks Actions");
  const requirement = collectRequirements(project)[0];
  const queuedStem = createQueuedStem(project, requirement, 1);
  const stem = { ...queuedStem, status: "ready" as const, queueOrder: null, filePath: "STEMS/ready.wav" };
  const clipId = project.arrangement.lanes[0].clips[0].id;
  const readyProject = {
    ...project,
    blocks: project.blocks.map((block) => ({
      ...block,
      implementedMelodies: [{ id: makeId("melody"), stemId: stem.id, textMetadata: "ready", createdAt: stem.createdAt }],
    })),
    arrangement: {
      lanes: project.arrangement.lanes.map((lane) => ({
        ...lane,
        clips: lane.clips.map((clip) => (clip.id === clipId ? { ...clip, stemId: stem.id } : clip)),
      })),
    },
    stems: [stem],
  };
  useStudioStore.setState({
    ...originalState,
    activeProject: { path: "/tmp/blocks-actions", project: readyProject, commands: createCommandJournal(project.id) },
    musicAiMode: "online",
    error: null,
    status: null,
  }, true);
  render(<BlocksTab />);
  return stem;
}

describe("BlocksTab implemented melody actions", () => {
  it("shows render, regenerate, preview, reveal, separation, and archive controls", () => {
    renderReadyMelody();

    for (const title of [
      "Render component",
      "Regenerate component",
      "Preview component",
      "Reveal component",
      "Separate into six retained stems",
      "Archive component",
    ]) {
      expect(screen.getByTitle(title)).toBeTruthy();
    }
  });

  it("regenerates non-destructively through the shared requirement queue", async () => {
    const stem = renderReadyMelody();
    const user = userEvent.setup();

    await user.click(screen.getByTitle("Regenerate component"));

    const activeProject = useStudioStore.getState().activeProject;
    expect(activeProject?.project.stems.find((item) => item.id === stem.id)?.status).toBe("superseded");
    expect(activeProject?.project.stems.some((item) => item.id !== stem.id && item.status === "queued")).toBe(true);
    expect(activeProject?.commands.commands.at(-1)?.type).toBe("regenerate_component");
  });
});
