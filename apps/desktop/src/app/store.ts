import { create } from "zustand";
import type { GenostBlock, GenostProject, GenostStem } from "../lib/schema/project";
import type { WorkerJobStatus } from "../lib/worker-client/render";
import {
  appendCommand,
  barsToSeconds,
  createCommandEntry,
  createCommandJournal,
  createEmptyProject,
  hashProject,
  hashString,
  makeId,
  mergeGenreReferences,
  nowIso,
  withGeneratedCompositionPrompt,
  type CommandDraft,
} from "../lib/project/format";
import {
  copyImportedStemToProject,
  copyReferenceTrackToProject,
  createProjectOnDisk,
  describeProjectStorageError,
  getRememberedProjectsRoot,
  loadWorkspaceMetadata,
  loadProjectAtPath,
  mergeWorkspaceGenreReferences,
  rememberProjectsRoot,
  saveLoadedProject,
  scanProjectsRoot,
  selectImportedStemFile,
  selectReferenceTrackFile,
  selectProjectsFolder,
  writeStemSidecar,
  type LoadedProject,
  type ProjectCard,
  type ProjectScanIssue,
} from "../lib/project/storage";

export type StudioTab = "composition" | "blocks" | "arranger" | "graph" | "premix" | "components" | "player";
export type ThemeMode = "dark" | "light";
export type MusicAiMode = "online" | "offline";
export type SaveState = "saved" | "dirty" | "saving" | "error";

type StudioState = {
  theme: ThemeMode;
  musicAiMode: MusicAiMode | null;
  projectsRoot: string | null;
  projects: ProjectCard[];
  projectScanIssues: ProjectScanIssue[];
  workspaceGenreReferences: string[];
  activeProject: LoadedProject | null;
  activeTab: StudioTab;
  status: string | null;
  error: string | null;
  saveState: SaveState;
  workerJobs: Record<string, WorkerJobStatus>;
  bootstrap: () => Promise<void>;
  toggleTheme: () => void;
  selectMusicAiMode: (mode: MusicAiMode) => void;
  selectRoot: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  createProject: (title: string) => Promise<void>;
  openProject: (path: string) => Promise<void>;
  openDemoProject: () => void;
  closeProject: () => void;
  setActiveTab: (tab: StudioTab) => void;
  setWorkerJob: (job: WorkerJobStatus) => void;
  clearWorkerJob: (jobId: string) => void;
  rememberGenreReferences: (genreReferences: string[]) => Promise<void>;
  selectReferenceTrack: () => Promise<void>;
  importStemAsBlock: () => Promise<void>;
  mutateActiveProject: (
    command: CommandDraft,
    mutate: (project: GenostProject) => GenostProject,
  ) => void;
};

function createDemoProject(): LoadedProject {
  const project = createEmptyProject("GENOST Dev Sketch");
  const command = createCommandEntry(
    {
      type: "create_demo_project",
      summary: "Created in-memory demo project",
      payload: { mode: "browser-dev" },
      actor: "system",
      source: "system",
    },
    undefined,
    hashProject(project),
  );

  return {
    path: null,
    project,
    commands: createCommandJournal(project.id, command),
  };
}

function projectWithUpdatedAt(project: GenostProject): GenostProject {
  return {
    ...project,
    updatedAt: nowIso(),
  };
}

function readTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "dark";
  }

  return window.localStorage.getItem("genost-theme") === "light" ? "light" : "dark";
}

function applyTheme(theme: ThemeMode): void {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.cpTheme = theme;
}

const initialTheme = readTheme();
applyTheme(initialTheme);

export const useStudioStore = create<StudioState>((set, get) => ({
  theme: initialTheme,
  musicAiMode: null,
  projectsRoot: null,
  projects: [],
  projectScanIssues: [],
  workspaceGenreReferences: [],
  activeProject: null,
  activeTab: "composition",
  status: null,
  error: null,
  saveState: "saved",
  workerJobs: {},

  async bootstrap() {
    try {
      applyTheme(get().theme);
      const rememberedRoot = await getRememberedProjectsRoot();

      if (!rememberedRoot) {
        set({ activeProject: createDemoProject(), status: "Demo project loaded", error: null });
        return;
      }

      const workspaceMetadata = await loadWorkspaceMetadata(rememberedRoot).catch(() => null);
      set({ projectsRoot: rememberedRoot, workspaceGenreReferences: workspaceMetadata?.genreReferences ?? [] });
      await get().refreshProjects();
    } catch (error) {
      set({
        activeProject: createDemoProject(),
        status: "Demo project loaded",
        error: describeProjectStorageError(error, "Starting GENOST"),
      });
    }
  },

  toggleTheme() {
    const theme = get().theme === "dark" ? "light" : "dark";
    window.localStorage.setItem("genost-theme", theme);
    applyTheme(theme);
    set({ theme });
  },

  selectMusicAiMode(mode) {
    set({
      musicAiMode: mode,
      status: mode === "offline" ? "MusicGen offline planning mode" : "MusicGen online mode",
      error: null,
    });
  },

  async selectRoot() {
    try {
      const selectedRoot = await selectProjectsFolder();

      if (!selectedRoot) {
        return;
      }

      await rememberProjectsRoot(selectedRoot);
      const workspaceMetadata = await loadWorkspaceMetadata(selectedRoot);
      set({
        projectsRoot: selectedRoot,
        projects: [],
        projectScanIssues: [],
        workspaceGenreReferences: workspaceMetadata.genreReferences,
        activeProject: null,
        status: "Projects folder selected",
        error: null,
      });
      await get().refreshProjects();
    } catch (error) {
      set({ error: describeProjectStorageError(error, "Selecting projects folder") });
    }
  },

  async refreshProjects() {
    const root = get().projectsRoot;

    if (!root) {
      set({ error: "Select a projects folder before refreshing projects." });
      return;
    }

    try {
      const result = await scanProjectsRoot(root);
      const issueStatus = result.issues.length > 0 ? ` · skipped ${result.issues.length}` : "";
      set({
        projects: result.projects,
        projectScanIssues: result.issues,
        status: `Found ${result.projects.length} GENOST project(s)${issueStatus}`,
        error: null,
      });
    } catch (error) {
      set({
        projects: [],
        projectScanIssues: [],
        status: null,
        error: describeProjectStorageError(error, "Refreshing projects", root),
      });
    }
  },

  async createProject(title: string) {
    const root = get().projectsRoot;

    if (!root) {
      set({ error: "Select a projects folder before creating a project." });
      return;
    }

    try {
      set({ status: "Creating project", error: null });
      let activeProject = await createProjectOnDisk(root, title);
      const defaultCachePath = typeof window === "undefined" ? "" : window.localStorage.getItem("genost-default-model-cache")?.trim() ?? "";
      const defaultBackend = typeof window === "undefined"
        ? "auto"
        : window.localStorage.getItem("genost-default-backend") === "mlx"
          ? "mlx"
          : window.localStorage.getItem("genost-default-backend") === "audiocraft"
            ? "audiocraft"
            : "auto";
      if (defaultCachePath || defaultBackend !== "auto") {
        const beforeHash = hashProject(activeProject.project);
        const project = projectWithUpdatedAt({
          ...activeProject.project,
          song: withGeneratedCompositionPrompt({
            ...activeProject.project.song,
            modelCachePath: defaultCachePath,
            generationBackend: defaultBackend,
          }),
        });
        const command = createCommandEntry(
          {
            type: "apply_generation_defaults",
            summary: "Applied default generation settings",
            payload: { modelCachePath: defaultCachePath, generationBackend: defaultBackend },
          },
          beforeHash,
          hashProject(project),
        );
        activeProject = { ...activeProject, project, commands: appendCommand(activeProject.commands, command) };
        await saveLoadedProject(activeProject);
      }
      set({ activeProject, activeTab: "composition", status: "Project created", error: null, saveState: "saved" });
      await get().rememberGenreReferences(activeProject.project.song.genreReferences);
      await get().refreshProjects();
    } catch (error) {
      set({ status: null, error: describeProjectStorageError(error, "Creating project", root) });
    }
  },

  async openProject(path: string) {
    try {
      const loadedProject = await loadProjectAtPath(path);
      const command = createCommandEntry(
        {
          type: "open_project",
          summary: `Opened project ${loadedProject.project.title}`,
          payload: { path },
        },
        hashProject(loadedProject.project),
        hashProject(loadedProject.project),
      );
      const activeProject = {
        ...loadedProject,
        commands: appendCommand(loadedProject.commands, command),
      };
      await saveLoadedProject(activeProject);
      set({ activeProject, activeTab: "composition", status: "Project opened", error: null, saveState: "saved" });
      await get().rememberGenreReferences(activeProject.project.song.genreReferences);
    } catch (error) {
      set({ error: describeProjectStorageError(error, "Opening project", path) });
    }
  },

  openDemoProject() {
    set({ activeProject: createDemoProject(), activeTab: "composition", status: "Demo project loaded", error: null });
  },

  closeProject() {
    set({ activeProject: null, activeTab: "composition" });
  },

  setActiveTab(tab) {
    set({ activeTab: tab });
  },

  setWorkerJob(job) {
    set((state) => ({ workerJobs: { ...state.workerJobs, [job.job_id]: job } }));
  },

  clearWorkerJob(jobId) {
    set((state) => {
      const workerJobs = { ...state.workerJobs };
      delete workerJobs[jobId];
      return { workerJobs };
    });
  },

  async rememberGenreReferences(genreReferences) {
    if (genreReferences.length === 0) {
      return;
    }

    const merged = mergeGenreReferences(get().workspaceGenreReferences, genreReferences);
    set({ workspaceGenreReferences: merged });

    const root = get().projectsRoot;

    if (!root) {
      return;
    }

    try {
      const workspaceMetadata = await mergeWorkspaceGenreReferences(root, genreReferences);
      set({ workspaceGenreReferences: workspaceMetadata.genreReferences, error: null });
    } catch (error) {
      set({ error: describeProjectStorageError(error, "Updating workspace genre references", root) });
    }
  },

  async selectReferenceTrack() {
    const activeProject = get().activeProject;

    if (!activeProject) {
      return;
    }

    if (!activeProject.path) {
      set({ error: "Reference tracks can only be imported for projects saved on disk." });
      return;
    }

    try {
      const selected = await selectReferenceTrackFile();

      if (!selected) {
        return;
      }

      const referenceTrack = await copyReferenceTrackToProject(activeProject.path, selected.path);
      const beforeHash = hashProject(activeProject.project);
      const project = projectWithUpdatedAt({
        ...activeProject.project,
        song: withGeneratedCompositionPrompt({
          ...activeProject.project.song,
          referenceTrackPath: referenceTrack.path,
          referenceTrackName: referenceTrack.name,
        }),
        stems: activeProject.project.stems.map((stem) =>
          stem.status === "ready"
            ? {
                ...stem,
                status: "stale",
                staleReason: "Composition reference track changed; archive as prior revision before rerender.",
                updatedAt: new Date().toISOString(),
              }
            : stem,
        ),
      });
      const afterHash = hashProject(project);
      const command = createCommandEntry(
        {
          type: "set_reference_track",
          summary: "Imported reference track",
          payload: {
            sourcePath: selected.path,
            referenceTrackPath: referenceTrack.path,
            referenceTrackName: referenceTrack.name,
          },
        },
        beforeHash,
        afterHash,
      );
      const updatedProject = {
        ...activeProject,
        project,
        commands: appendCommand(activeProject.commands, command),
      };

      set({ activeProject: updatedProject, status: "Reference track imported", error: null });
      await saveLoadedProject(updatedProject);
    } catch (error) {
      set({
        error: describeProjectStorageError(error, "Importing reference track", activeProject.path ?? undefined),
      });
    }
  },

  async importStemAsBlock() {
    const activeProject = get().activeProject;

    if (!activeProject) {
      return;
    }

    if (!activeProject.path) {
      set({ error: "Stem import requires a project saved on disk." });
      return;
    }

    try {
      const selected = await selectImportedStemFile();

      if (!selected) {
        return;
      }

      const imported = await copyImportedStemToProject(activeProject.path, selected.path);
      const now = nowIso();
      const blockId = makeId("block");
      const stemId = makeId("stem");
      const importedName = imported.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Imported Stem";
      const durationSeconds = barsToSeconds(16, activeProject.project.song.bpm, activeProject.project.song.timeSignature[0]);
      const promptHash = hashString(`${activeProject.project.id}:${imported.name}:${imported.path}:${now}`);
      const block: GenostBlock = {
        id: blockId,
        name: importedName,
        bars: 16,
        timeSignature: null,
        role: "imported audio",
        instruments: ["imported stem"],
        separatorTarget: "instrumental",
        validationCategory: "generic",
        soundCharacter: "clean",
        sourceType: "imported",
        importedStemId: stemId,
        melodyDescription: "Imported audio stem",
        melodyPrompt: "",
        rhythmFeel: "",
        timbre: "",
        energy: 5,
        density: 5,
        avoid: "",
        volumeDb: 0,
        delaySend: 0,
        reverbSend: 0,
        compressorEnabled: false,
        implementedMelodies: [
          {
            id: makeId("melody"),
            stemId,
            textMetadata: "Imported audio stem",
            createdAt: now,
          },
        ],
      };
      const stem: GenostStem = {
        id: stemId,
        blockId,
        variation: 1,
        inputStemId: null,
        model: "imported-audio",
        promptHash,
        seed: 0,
        durationSeconds,
        status: "ready",
        queueOrder: null,
        fileName: imported.name,
        filePath: imported.path,
        archivePath: null,
        revisionOfStemId: null,
        staleReason: null,
        error: null,
        renderMetadata: null,
        createdAt: now,
        updatedAt: now,
      };

      await writeStemSidecar(imported.path, {
        schemaVersion: 1,
        type: "imported_stem",
        projectId: activeProject.project.id,
        blockId,
        stemId,
        sourcePath: imported.sourcePath,
        fileName: imported.name,
        importedAt: now,
        bars: block.bars,
        durationSeconds,
      });

      const beforeHash = hashProject(activeProject.project);
      const project = projectWithUpdatedAt({
        ...activeProject.project,
        blocks: [...activeProject.project.blocks, block],
        stems: [...activeProject.project.stems, stem],
      });
      const afterHash = hashProject(project);
      const command = createCommandEntry(
        {
          type: "import_stem_as_block",
          summary: "Imported stem as block",
          payload: {
            blockId,
            stemId,
            sourcePath: selected.path,
            projectStemPath: imported.path,
            fileName: imported.name,
            bars: block.bars,
          },
        },
        beforeHash,
        afterHash,
      );
      const updatedProject = {
        ...activeProject,
        project,
        commands: appendCommand(activeProject.commands, command),
      };

      set({ activeProject: updatedProject, status: "Imported stem as block", error: null });
      await saveLoadedProject(updatedProject);
    } catch (error) {
      set({
        error: describeProjectStorageError(error, "Importing stem as block", activeProject.path ?? undefined),
      });
    }
  },

  mutateActiveProject(commandDraft, mutate) {
    const activeProject = get().activeProject;

    if (!activeProject) {
      return;
    }

    const beforeHash = hashProject(activeProject.project);
    const project = projectWithUpdatedAt(mutate(activeProject.project));
    const afterHash = hashProject(project);
    const command = createCommandEntry(commandDraft, beforeHash, afterHash);
    const updatedProject = {
      ...activeProject,
      project,
      commands: appendCommand(activeProject.commands, command),
    };

    set({ activeProject: updatedProject, status: commandDraft.summary, error: null, saveState: updatedProject.path ? "dirty" : "saved" });

    if (updatedProject.path) {
      set({ saveState: "saving" });
      void saveLoadedProject(updatedProject)
        .then(() => {
          if (get().activeProject?.project.updatedAt === updatedProject.project.updatedAt) set({ saveState: "saved" });
        })
        .catch((error: unknown) => {
          set({
            saveState: "error",
            error: describeProjectStorageError(error, "Saving project", updatedProject.path ?? undefined),
          });
        });
    }
  },
}));

export function createUiPayloadId(): string {
  return makeId("ui");
}
