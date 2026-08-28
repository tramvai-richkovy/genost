// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const { archiveBundleMock, mergeOutputsMock, saveLoadedProjectMock } = vi.hoisted(() => ({
  archiveBundleMock: vi.fn(),
  mergeOutputsMock: vi.fn(),
  saveLoadedProjectMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/project/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/project/storage")>()),
  archiveSeparationBundle: archiveBundleMock,
  saveLoadedProject: saveLoadedProjectMock,
}));

vi.mock("../../lib/worker-client/separation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/worker-client/separation")>()),
  mergeSeparationOutputs: mergeOutputsMock,
}));

vi.mock("@tauri-apps/api/path", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/path")>()),
  join: vi.fn(async (...parts: string[]) => parts.join("/").replace(/\/+/g, "/")),
}));
import { useStudioStore } from "../../app/store";
import { SeparationBundleLoopPreview } from "../../lib/audio/separationBundlePreview";
import { createCommandJournal, createEmptyProject } from "../../lib/project/format";
import type { SeparationBundle } from "../../lib/schema/project";
import { PremixTab } from "./PremixTab";

const originalState = useStudioStore.getState();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  archiveBundleMock.mockReset();
  mergeOutputsMock.mockReset();
  saveLoadedProjectMock.mockClear();
  useStudioStore.setState(originalState, true);
});

function readyOutput(label: "bass" | "drums" | "guitar" | "piano" | "vocals" | "other") {
  return {
    id: `output_${label}`,
    label,
    fileName: `${label}.wav`,
    filePath: `/Projects/Premix Test/STEMS/SEPARATIONS/bundle_ready/${label}.wav`,
    status: "ready" as const,
    volumeDb: 0,
    durationSeconds: 8,
    peak: 0.5,
    createdAt: "2026-08-27T00:00:00Z",
  };
}

function readyBundle(outputs = [readyOutput("other")]): SeparationBundle {
  return {
    id: "bundle_ready",
    blockId: "block_fixture",
    sourceStemId: "stem_source",
    rawStemPath: "STEMS/source.wav",
    model: "htdemucs_6s.yaml",
    preferredTarget: "other",
    status: "ready",
    selectedOutputIds: [],
    outputs,
    merges: [],
    previewMetadata: {},
    errorCode: null,
    error: null,
    createdAt: "2026-08-27T00:00:00Z",
    updatedAt: "2026-08-27T00:00:00Z",
  };
}

function renderPremix(bundle = readyBundle(), projectPath: string | null = null) {
  const project = createEmptyProject("Premix Test");
  project.blocks[0] = { ...project.blocks[0], id: "block_fixture", name: "Atmosphere" };
  project.separationBundles = [bundle];
  useStudioStore.setState({
    ...originalState,
    activeProject: { path: projectPath, project, commands: createCommandJournal(project.id) },
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

  it("merges an arbitrary selected subset with its saved levels while retaining sources", async () => {
    mergeOutputsMock.mockResolvedValue({
      merge_id: "ignored-worker-id",
      status: "ready",
      file_name: "merged.wav",
      file_path: "/Projects/Premix Test/STEMS/SEPARATIONS/bundle_ready/MERGES/merged.wav",
      duration_seconds: 8,
      peak: 0.8,
      error_code: null,
      error: null,
    });
    const user = userEvent.setup();
    renderPremix(readyBundle([readyOutput("bass"), readyOutput("drums"), readyOutput("piano")]), "/Projects/Premix Test");

    await user.click(screen.getByLabelText("Select bass for merge"));
    await user.click(screen.getByLabelText("Select piano for merge"));
    const bassVolume = screen.getByLabelText("bass premix volume");
    const pianoVolume = screen.getByLabelText("piano premix volume");
    fireEvent.change(bassVolume, { target: { value: "-6" } });
    fireEvent.pointerUp(bassVolume, { target: { value: "-6" } });
    fireEvent.change(pianoVolume, { target: { value: "3" } });
    fireEvent.pointerUp(pianoVolume, { target: { value: "3" } });
    await user.click(screen.getByRole("button", { name: "Merge Selected" }));

    await waitFor(() => expect(mergeOutputsMock).toHaveBeenCalledOnce());
    expect(mergeOutputsMock).toHaveBeenCalledWith(expect.objectContaining({
      output_paths: [
        "/Projects/Premix Test/STEMS/SEPARATIONS/bundle_ready/bass.wav",
        "/Projects/Premix Test/STEMS/SEPARATIONS/bundle_ready/piano.wav",
      ],
      input_gains_db: [-6, 3],
      destination_path: expect.stringMatching(/\/STEMS\/SEPARATIONS\/bundle_ready\/MERGES\/merge_.+\.wav$/),
    }));

    const bundle = useStudioStore.getState().activeProject?.project.separationBundles[0];
    expect(bundle?.outputs.map((output) => [output.label, output.status])).toEqual([
      ["bass", "ready"], ["drums", "ready"], ["piano", "ready"],
    ]);
    expect(bundle?.merges).toHaveLength(1);
    expect(bundle?.merges[0].outputIds).toEqual(["output_bass", "output_piano"]);
    expect(bundle?.merges[0].outputLevelsDb).toEqual({ output_bass: -6, output_piano: 3 });
    expect(useStudioStore.getState().activeProject?.commands.commands.at(-1)?.type).toBe("merge_separation_outputs_completed");
  });

  it("archives the bundle non-destructively and journals the moved outputs", async () => {
    archiveBundleMock.mockResolvedValue("ARCHIVE/SEPARATION_bundle_ready_20260828T000000Z");
    const user = userEvent.setup();
    renderPremix(readyBundle([readyOutput("bass"), readyOutput("other")]), "/Projects/Premix Test");

    await user.click(screen.getByTitle("Archive bundle without deleting sources"));
    await waitFor(() => expect(archiveBundleMock).toHaveBeenCalledWith("/Projects/Premix Test", "bundle_ready"));

    const bundle = useStudioStore.getState().activeProject?.project.separationBundles[0];
    expect(bundle?.status).toBe("archived");
    expect(bundle?.rawStemPath).toBe("STEMS/source.wav");
    expect(bundle?.outputs.every((output) => output.status === "archived")).toBe(true);
    expect(bundle?.outputs[0].filePath).toBe("/Projects/Premix Test/ARCHIVE/SEPARATION_bundle_ready_20260828T000000Z/bass.wav");
    expect(useStudioStore.getState().activeProject?.commands.commands.at(-1)?.type).toBe("archive_separation_bundle");
  });

  it("keeps project state and journal unchanged when bundle archiving fails", async () => {
    archiveBundleMock.mockRejectedValue(new Error("archive rename failed"));
    const user = userEvent.setup();
    renderPremix(readyBundle(), "/Projects/Premix Test");
    const initialJournalLength = useStudioStore.getState().activeProject?.commands.commands.length;

    await user.click(screen.getByTitle("Archive bundle without deleting sources"));

    await waitFor(() => expect(screen.getByText("archive rename failed")).toBeTruthy());
    expect(useStudioStore.getState().activeProject?.project.separationBundles[0].status).toBe("ready");
    expect(useStudioStore.getState().activeProject?.commands.commands.length).toBe(initialJournalLength);
  });
});
