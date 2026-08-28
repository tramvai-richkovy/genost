import { create } from "zustand";
import {
  activePromptRevision,
  appendCommand,
  archivePromptRevision,
  BPM_PRESETS,
  buildStemConstructorPrompt,
  createArtifact,
  createCommandEntry,
  DEFAULT_GENERATION_SECONDS,
  DEFAULT_MELODY_MODEL,
  DEFAULT_TEXT_MODEL,
  hashSession,
  mergeTags,
  nextArtifactName,
  nextDefaultSessionName,
  nowIso,
  withSessionUpdatedAt,
  type CommandDraft,
} from "../lib/session/format";
import {
  allocateArtifactFile,
  appendSessionCommand,
  appendWorkspaceCommand,
  createSessionOnDisk,
  describeSessionStorageError,
  exportArtifactToFolder,
  getRememberedWorkingDirectory,
  loadSessionAtPath,
  loadWorkspaceMetadata,
  rememberWorkingDirectory,
  resolveSessionAssetPath,
  saveLoadedSession,
  saveWorkspaceMetadata,
  scanSessionsRoot,
  selectAudioFile,
  selectExportFolder,
  selectWorkingDirectory,
  updateWorkspaceMetadata,
  updateWorkspaceModelSettings,
  writeArtifactSidecar,
  type LoadedSession,
  type SessionCard,
} from "../lib/session/storage";
import type { BpmPreset, GenostArtifact, GenostSession, ModelSettings, SessionType, WorkspaceMetadata } from "../lib/session/schema";
import {
  convertAudioToMidi,
  generateMidiFromText,
  getWorkerHealth,
  renderMidiGuideWav,
  renderStem,
  runWorkerPreflight,
  type WorkerHealth,
  type WorkerJobStatus,
} from "../lib/worker-client/render";
import { mergeSeparationOutputs, separateStem } from "../lib/worker-client/separation";

export type ThemeMode = "dark" | "light";
export type SaveState = "saved" | "dirty" | "saving" | "error";
export type ReferenceAudioSelection = {
  path: string;
  name: string;
  source: "manual" | "artifact";
  artifactId?: string;
};

type SessionStudioState = {
  theme: ThemeMode;
  workingDirectory: string | null;
  workspaceMetadata: WorkspaceMetadata | null;
  sessions: SessionCard[];
  activeSession: LoadedSession | null;
  selectedReferenceAudio: ReferenceAudioSelection | null;
  status: string | null;
  error: string | null;
  saveState: SaveState;
  workerHealth: WorkerHealth | null;
  workerPreflight: WorkerHealth["preflight"] | null;
  preflightChecking: boolean;
  workerJobs: Record<string, WorkerJobStatus>;
  bootstrap: () => Promise<void>;
  toggleTheme: () => void;
  selectRoot: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  checkPreflight: () => Promise<void>;
  updateModelSettings: (settings: ModelSettings) => Promise<void>;
  setSidebarCollapsed: (collapsed: boolean) => Promise<void>;
  createSession: (draft: { type: SessionType; name?: string; bpm: number; bpmPreset: BpmPreset; tag?: string; exportFolder?: string | null }) => Promise<void>;
  openSession: (path: string) => Promise<void>;
  closeSession: () => void;
  updateSessionBasics: (changes: Partial<Pick<GenostSession, "title" | "bpm" | "bpmPreset" | "tags">>) => Promise<void>;
  setPrompt: (prompt: string) => Promise<void>;
  archivePrompt: () => Promise<void>;
  chooseExportFolderForSession: () => Promise<void>;
  chooseManualReferenceAudio: () => Promise<void>;
  useArtifactAsReference: (artifactId: string) => void;
  useResolvedArtifactAsReference: (reference: ReferenceAudioSelection) => void;
  clearReferenceAudio: () => void;
  generateAudioArtifacts: (args: { prompt: string; quantity: number; referencePath?: string | null }) => Promise<void>;
  generateMidiArtifacts: (args: { prompt: string; quantity: number }) => Promise<void>;
  renameArtifact: (artifactId: string, name: string) => Promise<void>;
  exportArtifact: (artifactId: string) => Promise<void>;
  journalArtifactReveal: (artifactId: string) => Promise<void>;
  convertArtifactToMidi: (artifactId: string, mode: "melodic" | "drum") => Promise<void>;
  splitArtifactIntoStems: (artifactId: string) => Promise<void>;
  updateStemVolume: (artifactId: string, volumeDb: number) => Promise<void>;
  mergeSelectedStems: (artifactIds: string[]) => Promise<void>;
  createDerivedSessionFromArtifact: (artifactId: string, type: Exclude<SessionType, "midi_generator">) => Promise<void>;
  setWorkerJob: (job: WorkerJobStatus) => void;
  clearWorkerJob: (jobId: string) => void;
};

function readTheme(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  return window.localStorage.getItem("genost-theme") === "light" ? "light" : "dark";
}

function applyTheme(theme: ThemeMode): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.cpTheme = theme;
}

const initialTheme = readTheme();
applyTheme(initialTheme);

function localModelSettings(): ModelSettings {
  if (typeof window === "undefined") return { cachePath: "", hfHome: null, backend: "auto" };
  return {
    cachePath: window.localStorage.getItem("genost-default-model-cache") ?? "",
    hfHome: window.localStorage.getItem("genost-default-hf-home") || null,
    backend: (window.localStorage.getItem("genost-default-backend") as ModelSettings["backend"] | null) ?? "auto",
  };
}

function rememberLocalModelSettings(settings: ModelSettings): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("genost-default-model-cache", settings.cachePath.trim());
  if (settings.hfHome?.trim()) window.localStorage.setItem("genost-default-hf-home", settings.hfHome.trim());
  else window.localStorage.removeItem("genost-default-hf-home");
  window.localStorage.setItem("genost-default-backend", settings.backend);
}

function preflightAllowsStudio(preflight: WorkerHealth["preflight"] | null): boolean {
  return Boolean(preflight?.ok && preflight.models[DEFAULT_TEXT_MODEL]?.available && preflight.models[DEFAULT_MELODY_MODEL]?.available);
}

async function saveSessionMutation(
  loadedSession: LoadedSession,
  commandDraft: CommandDraft,
  mutate: (session: GenostSession) => GenostSession,
): Promise<LoadedSession> {
  const beforeHash = hashSession(loadedSession.session);
  const session = withSessionUpdatedAt(mutate(loadedSession.session));
  const command = createCommandEntry(commandDraft, beforeHash, hashSession(session));
  const updated: LoadedSession = {
    ...loadedSession,
    session,
    commands: appendCommand(loadedSession.commands, command),
  };
  await saveLoadedSession(updated);
  return updated;
}

function replaceArtifact(session: GenostSession, artifact: GenostArtifact): GenostSession {
  return {
    ...session,
    artifacts: session.artifacts.map((item) => (item.id === artifact.id ? artifact : item)),
  };
}

function generationPromptForSession(session: GenostSession, prompt: string): string {
  if (session.type !== "stem_constructor") return prompt;
  return prompt;
}

function artifactAbsolutePath(loadedSession: LoadedSession, artifact: GenostArtifact): string | null {
  return resolveSessionAssetPath(loadedSession.path, artifact.filePath);
}

async function addGuideAndAudioForMidi(
  loadedSession: LoadedSession,
  midiArtifact: GenostArtifact,
  targetType: Exclude<SessionType, "midi_generator">,
  settings: ModelSettings,
  setJob: (job: WorkerJobStatus) => void,
): Promise<{ loadedSession: LoadedSession; sourceAudioArtifact: GenostArtifact }> {
  const sessionPath = loadedSession.path;
  const activeRevision = activePromptRevision(loadedSession.session);
  const midiPath = artifactAbsolutePath(loadedSession, midiArtifact);
  if (!midiPath) throw new Error("MIDI artifact path is unavailable.");

  const guideTarget = await allocateArtifactFile(sessionPath, activeRevision.artifactFolder, `${nextArtifactName(loadedSession.session)}-guide.wav`, ".wav");
  const guide = await renderMidiGuideWav({
    midi_path: midiPath,
    output_wav_path: guideTarget.absolutePath,
    sample_rate: 32000,
  });
  if (guide.status !== "ready" || !guide.file_path || !guide.file_name) {
    throw new Error(guide.error || "MIDI guide rendering failed.");
  }

  const guideArtifact = createArtifact({
    session: loadedSession.session,
    kind: "guide_audio",
    fileName: guideTarget.fileName,
    filePath: guideTarget.relativePath,
    parentArtifactId: midiArtifact.id,
    status: "ready",
    conversion: {
      type: "midi_to_guide_wav",
      sourceTool: "pretty_midi+scipy",
      sourcePath: midiArtifact.filePath,
      sourceArtifactIds: [midiArtifact.id],
      guideAudioPath: guideTarget.relativePath,
    },
  });

  let updated = await saveSessionMutation(
    loadedSession,
    {
      type: "artifact_conversion",
      summary: "Rendered MIDI guide audio",
      payload: { sourceArtifactId: midiArtifact.id, guideArtifactId: guideArtifact.id },
    },
    (session) => ({ ...session, artifacts: [...session.artifacts, guideArtifact] }),
  );

  const audioTarget = await allocateArtifactFile(sessionPath, activeRevision.artifactFolder, `${nextArtifactName(updated.session)}.wav`, ".wav");
  const audioArtifact = createArtifact({
    session: updated.session,
    kind: "audio_clip",
    fileName: audioTarget.fileName,
    filePath: audioTarget.relativePath,
    parentArtifactId: guideArtifact.id,
    promptRevisionId: activeRevision.id,
    status: "generating",
  });
  updated = await saveSessionMutation(
    updated,
    {
      type: "generation_request",
      summary: "Requested melody-conditioned guide generation",
      payload: { sourceArtifactId: midiArtifact.id, guideArtifactId: guideArtifact.id, audioArtifactId: audioArtifact.id, targetType },
    },
    (session) => ({ ...session, artifacts: [...session.artifacts, audioArtifact] }),
  );

  try {
    const result = await renderStem(
      {
        job_id: `job_${audioArtifact.id}`,
        kind: "conditioned",
        prompt: generationPromptForSession(updated.session, activeRevision.prompt || `${updated.session.bpm} BPM, clean guide melody`),
        output_path: audioTarget.absolutePath,
        duration_seconds: DEFAULT_GENERATION_SECONDS,
        model_name: DEFAULT_MELODY_MODEL,
        reference_audio_path: guide.file_path,
        seed: Date.now(),
        model_cache_path: settings.cachePath || null,
        backend: settings.backend,
        audio_validation_profile: "music",
        audio_content_category: "melody",
      },
      setJob,
    );
    const readyArtifact: GenostArtifact = {
      ...audioArtifact,
      status: "ready",
      modelBackend: {
        backend: result.backend,
        device: result.device,
        model: result.model,
        generationSeconds: result.generation_seconds,
        validationMetrics: result.validation_metrics,
        cachePath: null,
      },
      error: null,
      updatedAt: nowIso(),
    };
    updated = await saveSessionMutation(updated, {
      type: "generation_request",
      summary: "Completed melody-conditioned guide generation",
      payload: { artifactId: readyArtifact.id, outputPath: readyArtifact.filePath },
    }, (session) => replaceArtifact(session, readyArtifact));
    return { loadedSession: updated, sourceAudioArtifact: readyArtifact };
  } catch (error) {
    const failedArtifact: GenostArtifact = {
      ...audioArtifact,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      updatedAt: nowIso(),
    };
    updated = await saveSessionMutation(updated, {
      type: "generation_request",
      summary: "Failed melody-conditioned guide generation",
      payload: { artifactId: failedArtifact.id, error: failedArtifact.error },
    }, (session) => replaceArtifact(session, failedArtifact));
    throw error;
  }
}

export const useSessionStudioStore = create<SessionStudioState>((set, get) => ({
  theme: initialTheme,
  workingDirectory: null,
  workspaceMetadata: null,
  sessions: [],
  activeSession: null,
  selectedReferenceAudio: null,
  status: null,
  error: null,
  saveState: "saved",
  workerHealth: null,
  workerPreflight: null,
  preflightChecking: false,
  workerJobs: {},

  async bootstrap() {
    applyTheme(get().theme);
    const rememberedRoot = await getRememberedWorkingDirectory().catch(() => null);
    const fallbackSettings = localModelSettings();

    if (rememberedRoot) {
      try {
        const workspaceMetadata = await loadWorkspaceMetadata(rememberedRoot);
        const metadata = await saveWorkspaceMetadata(rememberedRoot, {
          ...workspaceMetadata,
          modelSettings: workspaceMetadata.modelSettings.cachePath ? workspaceMetadata.modelSettings : fallbackSettings,
        });
        set({
          workingDirectory: rememberedRoot,
          workspaceMetadata: metadata,
          status: "Working directory loaded",
          error: null,
        });
        await get().refreshSessions();
      } catch (error) {
        set({ error: describeSessionStorageError(error, "Starting GENOST", rememberedRoot) });
      }
    } else {
      set({
        workspaceMetadata: {
          schemaVersion: 1,
          updatedAt: nowIso(),
          knownTags: [],
          lastSelectedSessionId: null,
          sidebarCollapsed: false,
          modelSettings: fallbackSettings,
        },
      });
    }

  },

  toggleTheme() {
    const theme = get().theme === "dark" ? "light" : "dark";
    window.localStorage.setItem("genost-theme", theme);
    applyTheme(theme);
    set({ theme });
  },

  async selectRoot() {
    try {
      const selectedRoot = await selectWorkingDirectory();
      if (!selectedRoot) return;
      await rememberWorkingDirectory(selectedRoot);
      const workspaceMetadata = await saveWorkspaceMetadata(selectedRoot, await loadWorkspaceMetadata(selectedRoot));
      await appendWorkspaceCommand(selectedRoot, {
        type: "select_workspace",
        summary: "Selected working directory",
        payload: { workingDirectory: selectedRoot },
      });
      set({
        workingDirectory: selectedRoot,
        workspaceMetadata,
        activeSession: null,
        selectedReferenceAudio: null,
        status: "Working directory selected",
        error: null,
      });
      await get().refreshSessions();
      await get().checkPreflight();
    } catch (error) {
      set({ error: describeSessionStorageError(error, "Selecting working directory") });
    }
  },

  async refreshSessions() {
    const root = get().workingDirectory;
    if (!root) {
      set({ sessions: [] });
      return;
    }

    try {
      const sessions = await scanSessionsRoot(root);
      set({ sessions, status: `Found ${sessions.length} session(s)`, error: null });
    } catch (error) {
      set({ error: describeSessionStorageError(error, "Refreshing sessions", root) });
    }
  },

  async checkPreflight() {
    const settings = get().workspaceMetadata?.modelSettings ?? localModelSettings();
    set({ preflightChecking: true, error: null });
    try {
      const preflight = await runWorkerPreflight({
        model_cache_path: settings.cachePath || null,
        hf_home: settings.hfHome || settings.cachePath || null,
        backend: settings.backend,
      });
      const health = await getWorkerHealth().catch(() => null);
      set({
        workerHealth: health,
        workerPreflight: preflight,
        preflightChecking: false,
        status: preflight.ok ? "Model preflight passed" : "Model preflight blocked studio actions",
        error: preflight.ok ? null : preflight.errors[0] ?? "Required MusicGen models are missing.",
      });
    } catch (error) {
      set({
        workerHealth: null,
        workerPreflight: null,
        preflightChecking: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  async updateModelSettings(settings) {
    rememberLocalModelSettings(settings);
    const root = get().workingDirectory;
    if (root) {
      try {
        const workspaceMetadata = await updateWorkspaceModelSettings(root, settings);
        set({ workspaceMetadata, error: null });
      } catch (error) {
        set({ error: describeSessionStorageError(error, "Updating model settings", root) });
      }
    } else {
      set((state) => ({
        workspaceMetadata: {
          ...(state.workspaceMetadata ?? {
            schemaVersion: 1,
            updatedAt: nowIso(),
            knownTags: [],
            lastSelectedSessionId: null,
            sidebarCollapsed: false,
            modelSettings: settings,
          }),
          modelSettings: settings,
        },
      }));
    }
    await get().checkPreflight();
  },

  async setSidebarCollapsed(collapsed) {
    const root = get().workingDirectory;
    set((state) => ({
      workspaceMetadata: state.workspaceMetadata ? { ...state.workspaceMetadata, sidebarCollapsed: collapsed } : state.workspaceMetadata,
    }));
    if (!root) return;
    try {
      const workspaceMetadata = await updateWorkspaceMetadata(root, (metadata) => ({ ...metadata, sidebarCollapsed: collapsed }));
      set({ workspaceMetadata });
    } catch (error) {
      set({ error: describeSessionStorageError(error, "Saving sidebar state", root) });
    }
  },

  async createSession(draft) {
    const root = get().workingDirectory;
    if (!root) {
      set({ error: "Select a working directory before creating a session." });
      return;
    }
    if (!preflightAllowsStudio(get().workerPreflight)) {
      set({ error: "GENOST requires local facebook/musicgen-medium and facebook/musicgen-melody before sessions can be created." });
      return;
    }

    try {
      const name = draft.name?.trim() || nextDefaultSessionName(get().sessions.map((session) => session.name));
      const loadedSession = await createSessionOnDisk(root, { ...draft, name });
      set({ activeSession: loadedSession, selectedReferenceAudio: null, saveState: "saved", status: "Session created", error: null });
      await get().refreshSessions();
    } catch (error) {
      set({ error: describeSessionStorageError(error, "Creating session", root) });
    }
  },

  async openSession(path) {
    if (!preflightAllowsStudio(get().workerPreflight)) {
      set({ error: "GENOST requires local facebook/musicgen-medium and facebook/musicgen-melody before sessions can be opened." });
      return;
    }

    try {
      let loadedSession = await loadSessionAtPath(path);
      loadedSession = await appendSessionCommand(
        loadedSession,
        {
          type: "open_session",
          summary: `Opened ${loadedSession.session.name}`,
          payload: { path },
        },
        loadedSession.session,
      );
      const root = get().workingDirectory;
      if (root) {
        const workspaceMetadata = await updateWorkspaceMetadata(root, (metadata) => ({
          ...metadata,
          knownTags: mergeTags(metadata.knownTags, loadedSession.session.tags),
          lastSelectedSessionId: loadedSession.session.id,
        }));
        set({ workspaceMetadata });
      }
      set({ activeSession: loadedSession, selectedReferenceAudio: null, saveState: "saved", status: "Session opened", error: null });
    } catch (error) {
      set({ error: describeSessionStorageError(error, "Opening session", path) });
    }
  },

  closeSession() {
    set({ activeSession: null, selectedReferenceAudio: null });
  },

  async updateSessionBasics(changes) {
    const loadedSession = get().activeSession;
    if (!loadedSession) return;
    try {
      set({ saveState: "saving" });
      const updated = await saveSessionMutation(
        loadedSession,
        {
          type: changes.bpm ? "change_bpm" : changes.title ? "change_session_title" : "change_tags",
          summary: changes.bpm ? "Changed BPM" : changes.title ? "Changed session title" : "Changed session metadata",
          payload: changes,
        },
        (session) => ({
          ...session,
          ...changes,
          tags: changes.tags ? mergeTags([], changes.tags) : session.tags,
        }),
      );
      set({ activeSession: updated, saveState: "saved", status: "Session metadata saved", error: null });
      const root = get().workingDirectory;
      if (root && changes.tags) {
        const workspaceMetadata = await updateWorkspaceMetadata(root, (metadata) => ({
          ...metadata,
          knownTags: mergeTags(metadata.knownTags, changes.tags ?? []),
        }));
        set({ workspaceMetadata });
      }
      await get().refreshSessions();
    } catch (error) {
      set({ saveState: "error", error: describeSessionStorageError(error, "Saving session metadata", loadedSession.path) });
    }
  },

  async setPrompt(prompt) {
    const loadedSession = get().activeSession;
    if (!loadedSession) return;
    const activeRevision = activePromptRevision(loadedSession.session);
    if (activeRevision.locked) {
      set({ error: "Archive the locked prompt before editing it." });
      return;
    }
    try {
      const updated = await saveSessionMutation(
        loadedSession,
        {
          type: "generation_request",
          summary: "Edited active prompt",
          payload: { promptRevisionId: activeRevision.id },
        },
        (session) => ({
          ...session,
          promptHistory: {
            ...session.promptHistory,
            revisions: session.promptHistory.revisions.map((revision) =>
              revision.id === activeRevision.id ? { ...revision, prompt, updatedAt: nowIso() } : revision,
            ),
          },
        }),
      );
      set({ activeSession: updated, saveState: "saved", status: "Prompt saved", error: null });
    } catch (error) {
      set({ saveState: "error", error: describeSessionStorageError(error, "Saving prompt", loadedSession.path) });
    }
  },

  async archivePrompt() {
    const loadedSession = get().activeSession;
    if (!loadedSession) return;
    try {
      set({ saveState: "saving" });
      const archived = archivePromptRevision(loadedSession.session);
      const updated = await appendSessionCommand(
        { ...loadedSession, session: archived },
        {
          type: "archive_prompt",
          summary: "Archived prompt revision",
          payload: {
            activeRevisionId: archived.promptHistory.activeRevisionId,
            archiveCount: archived.promptHistory.revisions.filter((revision) => revision.archivedAt).length,
          },
        },
        archived,
      );
      set({ activeSession: updated, selectedReferenceAudio: null, saveState: "saved", status: "Prompt archived", error: null });
    } catch (error) {
      set({ saveState: "error", error: describeSessionStorageError(error, "Archiving prompt", loadedSession.path) });
    }
  },

  async chooseExportFolderForSession() {
    const loadedSession = get().activeSession;
    if (!loadedSession) return;
    try {
      const exportFolder = await selectExportFolder();
      if (!exportFolder) return;
      const updated = await saveSessionMutation(
        loadedSession,
        {
          type: "change_export_folder",
          summary: "Changed export folder",
          payload: { exportFolder },
        },
        (session) => ({ ...session, exportFolder }),
      );
      set({ activeSession: updated, status: "Export folder set", error: null });
    } catch (error) {
      set({ error: describeSessionStorageError(error, "Selecting export folder", loadedSession.path) });
    }
  },

  async chooseManualReferenceAudio() {
    try {
      const selected = await selectAudioFile();
      if (!selected) return;
      set({ selectedReferenceAudio: { ...selected, source: "manual" }, status: "Reference audio selected", error: null });
    } catch (error) {
      set({ error: describeSessionStorageError(error, "Selecting reference audio") });
    }
  },

  useArtifactAsReference(artifactId) {
    const loadedSession = get().activeSession;
    const artifact = loadedSession?.session.artifacts.find((item) => item.id === artifactId);
    if (!loadedSession || !artifact) return;
    const path = artifactAbsolutePath(loadedSession, artifact);
    if (!path) {
      set({ error: "Artifact path is unavailable." });
      return;
    }
    set({ selectedReferenceAudio: { path, name: artifact.name, source: "artifact", artifactId }, status: "Artifact linked as reference", error: null });
  },

  useResolvedArtifactAsReference(reference) {
    set({ selectedReferenceAudio: reference, status: "Artifact linked as reference", error: null });
  },

  clearReferenceAudio() {
    set({ selectedReferenceAudio: null });
  },

  async generateAudioArtifacts({ prompt, quantity, referencePath }) {
    const loadedSession = get().activeSession;
    const settings = get().workspaceMetadata?.modelSettings ?? localModelSettings();
    if (!loadedSession) return;
    if (!preflightAllowsStudio(get().workerPreflight)) {
      set({ error: "Generation is blocked until medium and melody models are available locally." });
      return;
    }
    if (!prompt.trim()) {
      set({ error: "Prompt is required before generation." });
      return;
    }

    const activeRevision = activePromptRevision(loadedSession.session);
    const useReference = Boolean(referencePath?.trim());
    const artifacts: Array<{ artifact: GenostArtifact; absolutePath: string }> = [];
    let stagedSession = loadedSession.session;

    try {
      set({ saveState: "saving", status: "Preparing generation", error: null });
      for (let index = 0; index < quantity; index += 1) {
        const target = await allocateArtifactFile(loadedSession.path, activeRevision.artifactFolder, `${nextArtifactName(stagedSession)}.wav`, ".wav");
        const artifact = createArtifact({
          session: stagedSession,
          kind: "audio_clip",
          fileName: target.fileName,
          filePath: target.relativePath,
          promptRevisionId: activeRevision.id,
          status: "generating",
        });
        artifacts.push({ artifact, absolutePath: target.absolutePath });
        stagedSession = withSessionUpdatedAt({ ...stagedSession, artifacts: [...stagedSession.artifacts, artifact] });
      }
      const queuedSession: GenostSession = withSessionUpdatedAt({
        ...stagedSession,
        promptHistory: {
          ...stagedSession.promptHistory,
          revisions: stagedSession.promptHistory.revisions.map((revision) =>
            revision.id === activeRevision.id ? { ...revision, prompt, locked: true, updatedAt: nowIso() } : revision,
          ),
        },
      });
      let updated: LoadedSession = {
        ...loadedSession,
        session: queuedSession,
        commands: appendCommand(
          loadedSession.commands,
          createCommandEntry(
            {
              type: "generation_request",
              summary: useReference ? "Requested melody-conditioned audio generation" : "Requested text audio generation",
              payload: {
                promptRevisionId: activeRevision.id,
                quantity,
                model: useReference ? DEFAULT_MELODY_MODEL : DEFAULT_TEXT_MODEL,
                referencePath: referencePath ?? null,
              },
            },
            hashSession(loadedSession.session),
            hashSession(queuedSession),
          ),
        ),
      };
      await saveLoadedSession(updated);
      set({ activeSession: updated, saveState: "saved", status: "Generation queued" });

      for (const item of artifacts) {
        try {
          const result = await renderStem(
            {
              job_id: `job_${item.artifact.id}`,
              kind: useReference ? "conditioned" : "text",
              prompt,
              output_path: item.absolutePath,
              duration_seconds: DEFAULT_GENERATION_SECONDS,
              model_name: useReference ? DEFAULT_MELODY_MODEL : DEFAULT_TEXT_MODEL,
              reference_audio_path: referencePath ?? null,
              seed: Date.now(),
              model_cache_path: settings.cachePath || null,
              backend: settings.backend,
              audio_validation_profile: "music",
              audio_content_category: loadedSession.session.type === "stem_constructor" ? "melody" : "generic",
            },
            (job) => get().setWorkerJob(job),
          );
          const readyArtifact: GenostArtifact = {
            ...item.artifact,
            status: "ready",
            modelBackend: {
              backend: result.backend,
              device: result.device,
              model: result.model,
              generationSeconds: result.generation_seconds,
              validationMetrics: result.validation_metrics,
              cachePath: settings.cachePath || null,
            },
            error: null,
            updatedAt: nowIso(),
          };
          updated = await saveSessionMutation(
            updated,
            {
              type: "generation_request",
              summary: "Completed audio artifact generation",
              payload: { artifactId: readyArtifact.id, outputPath: readyArtifact.filePath },
            },
            (session) => replaceArtifact(session, readyArtifact),
          );
          await writeArtifactSidecar(item.absolutePath, { schemaVersion: 1, artifact: readyArtifact });
          set({ activeSession: updated, saveState: "saved", status: "Audio artifact ready", error: null });
        } catch (error) {
          const failedArtifact: GenostArtifact = {
            ...item.artifact,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
            updatedAt: nowIso(),
          };
          updated = await saveSessionMutation(
            updated,
            {
              type: "generation_request",
              summary: "Failed audio artifact generation",
              payload: { artifactId: failedArtifact.id, error: failedArtifact.error },
            },
            (session) => replaceArtifact(session, failedArtifact),
          );
          set({ activeSession: updated, saveState: "saved", status: null, error: failedArtifact.error });
        }
      }
      await get().refreshSessions();
    } catch (error) {
      set({ saveState: "error", error: describeSessionStorageError(error, "Preparing generation", loadedSession.path) });
    }
  },

  async generateMidiArtifacts({ prompt, quantity }) {
    const loadedSession = get().activeSession;
    if (!loadedSession) return;
    if (!prompt.trim()) {
      set({ error: "Prompt is required before MIDI generation." });
      return;
    }
    const activeRevision = activePromptRevision(loadedSession.session);
    const outputDirectory = resolveSessionAssetPath(loadedSession.path, activeRevision.artifactFolder);
    if (!outputDirectory) {
      set({ error: "Active artifact folder is unavailable." });
      return;
    }

    try {
      set({ status: "Generating MIDI", error: null });
      const response = await generateMidiFromText({ prompt, output_directory: outputDirectory, quantity });
      if (response.status !== "ready") throw new Error(response.error || "MIDI generation failed.");
      let session = loadedSession.session;
      for (const output of response.outputs) {
        const artifact = createArtifact({
          session,
          kind: "midi_clip",
          fileName: output.file_name,
          filePath: `${activeRevision.artifactFolder}/${output.file_name}`,
          promptRevisionId: activeRevision.id,
          status: "ready",
          modelBackend: { backend: "text2midi", device: null, model: "amaai-lab/text2midi", generationSeconds: null, validationMetrics: null, cachePath: null },
        });
        session = withSessionUpdatedAt({ ...session, artifacts: [...session.artifacts, artifact] });
      }
      session = {
        ...session,
        promptHistory: {
          ...session.promptHistory,
          revisions: session.promptHistory.revisions.map((revision) =>
            revision.id === activeRevision.id ? { ...revision, prompt, locked: true, updatedAt: nowIso() } : revision,
          ),
        },
      };
      const updated = await saveSessionMutation(
        loadedSession,
        {
          type: "generation_request",
          summary: "Generated MIDI artifacts",
          payload: { promptRevisionId: activeRevision.id, quantity, model: "amaai-lab/text2midi" },
        },
        () => session,
      );
      set({ activeSession: updated, status: "MIDI artifacts ready", error: null });
      await get().refreshSessions();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  async renameArtifact(artifactId, name) {
    const loadedSession = get().activeSession;
    if (!loadedSession || !name.trim()) return;
    const artifact = loadedSession.session.artifacts.find((item) => item.id === artifactId);
    if (!artifact) return;
    try {
      const renamed = { ...artifact, name: name.trim(), updatedAt: nowIso() };
      const updated = await saveSessionMutation(
        loadedSession,
        { type: "artifact_rename", summary: "Renamed artifact", payload: { artifactId, name: renamed.name } },
        (session) => replaceArtifact(session, renamed),
      );
      set({ activeSession: updated, status: "Artifact renamed", error: null });
    } catch (error) {
      set({ error: describeSessionStorageError(error, "Renaming artifact", loadedSession.path) });
    }
  },

  async exportArtifact(artifactId) {
    const loadedSession = get().activeSession;
    if (!loadedSession) return;
    const artifact = loadedSession.session.artifacts.find((item) => item.id === artifactId);
    if (!artifact) return;
    if (!loadedSession.session.exportFolder) {
      set({ error: "Set a session export folder before exporting artifacts." });
      return;
    }
    try {
      const exported = await exportArtifactToFolder(loadedSession.path, artifact, loadedSession.session.exportFolder);
      const updated = await saveSessionMutation(
        loadedSession,
        {
          type: "artifact_export",
          summary: "Exported artifact",
          payload: { artifactId, exportPath: exported.exportPath, exportName: exported.exportName },
        },
        (session) => replaceArtifact(session, exported.artifact),
      );
      set({ activeSession: updated, status: "Artifact exported", error: null });
    } catch (error) {
      set({ error: describeSessionStorageError(error, "Exporting artifact", loadedSession.path) });
    }
  },

  async journalArtifactReveal(artifactId) {
    const loadedSession = get().activeSession;
    if (!loadedSession) return;
    try {
      const updated = await saveSessionMutation(
        loadedSession,
        { type: "artifact_reveal", summary: "Revealed artifact location", payload: { artifactId } },
        (session) => session,
      );
      set({ activeSession: updated, status: "Artifact revealed", error: null });
    } catch (error) {
      set({ error: describeSessionStorageError(error, "Journaling artifact reveal", loadedSession.path) });
    }
  },

  async convertArtifactToMidi(artifactId, mode) {
    const loadedSession = get().activeSession;
    if (!loadedSession) return;
    const source = loadedSession.session.artifacts.find((item) => item.id === artifactId);
    if (!source) return;
    const sourcePath = artifactAbsolutePath(loadedSession, source);
    if (!sourcePath) {
      set({ error: "Source artifact path is unavailable." });
      return;
    }

    try {
      const activeRevision = activePromptRevision(loadedSession.session);
      const target = await allocateArtifactFile(loadedSession.path, activeRevision.artifactFolder, `${nextArtifactName(loadedSession.session)}.mid`, ".mid");
      const response = await convertAudioToMidi({ source_audio_path: sourcePath, output_midi_path: target.absolutePath, mode });
      if (response.status !== "ready" || !response.file_name) throw new Error(response.error || "Audio-to-MIDI conversion failed.");
      const artifact = createArtifact({
        session: loadedSession.session,
        kind: "midi_clip",
        fileName: target.fileName,
        filePath: target.relativePath,
        parentArtifactId: source.id,
        status: "ready",
        conversion: {
          type: mode === "melodic" ? "audio_to_melodic_midi" : "audio_to_drum_midi",
          sourceTool: mode === "melodic" ? "basic-pitch" : "omnizart drum",
          sourcePath: source.filePath,
          sourceArtifactIds: [source.id],
          guideAudioPath: null,
        },
      });
      const updated = await saveSessionMutation(
        loadedSession,
        {
          type: "artifact_conversion",
          summary: mode === "melodic" ? "Converted audio to melodic MIDI" : "Converted audio to drum MIDI",
          payload: { sourceArtifactId: source.id, artifactId: artifact.id, mode },
        },
        (session) => ({ ...session, artifacts: [...session.artifacts, artifact] }),
      );
      set({ activeSession: updated, status: "MIDI artifact ready", error: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  async splitArtifactIntoStems(artifactId) {
    const loadedSession = get().activeSession;
    if (!loadedSession) return;
    const source = loadedSession.session.artifacts.find((item) => item.id === artifactId);
    const sourcePath = source ? artifactAbsolutePath(loadedSession, source) : null;
    if (!source || !sourcePath) return;
    try {
      const activeRevision = activePromptRevision(loadedSession.session);
      const bundleName = `${source.name.replace(/[^A-Za-z0-9_-]/g, "_")}_stems_${Date.now().toString(36)}`;
      const bundlePath = resolveSessionAssetPath(loadedSession.path, `${activeRevision.artifactFolder}/${bundleName}`);
      if (!bundlePath) throw new Error("Separation bundle path is unavailable.");
      const response = await separateStem({
        bundle_id: bundleName,
        source_stem_path: sourcePath,
        bundle_path: bundlePath,
      });
      if (response.status !== "ready") throw new Error(response.error || "Separation failed.");
      let session = loadedSession.session;
      for (const output of response.outputs) {
        const artifact = createArtifact({
          session,
          kind: "separated_stem",
          fileName: output.file_name,
          filePath: `${activeRevision.artifactFolder}/${bundleName}/${output.file_name}`,
          parentArtifactId: source.id,
          status: "ready",
          conversion: {
            type: "separation",
            sourceTool: response.model ?? "audio-separator",
            sourcePath: source.filePath,
            sourceArtifactIds: [source.id],
            guideAudioPath: null,
          },
        });
        session = withSessionUpdatedAt({ ...session, artifacts: [...session.artifacts, artifact] });
      }
      const updated = await saveSessionMutation(
        loadedSession,
        {
          type: "artifact_separation",
          summary: "Split audio artifact into stems",
          payload: { sourceArtifactId: source.id, bundleName },
        },
        () => session,
      );
      set({ activeSession: updated, status: "Stems ready", error: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  async updateStemVolume(artifactId, volumeDb) {
    const loadedSession = get().activeSession;
    if (!loadedSession) return;
    const artifact = loadedSession.session.artifacts.find((item) => item.id === artifactId);
    if (!artifact) return;
    const updatedArtifact = { ...artifact, volumeDb, updatedAt: nowIso() };
    const updated = await saveSessionMutation(
      loadedSession,
      { type: "artifact_merge", summary: "Changed stem volume", payload: { artifactId, volumeDb } },
      (session) => replaceArtifact(session, updatedArtifact),
    );
    set({ activeSession: updated, status: "Stem level saved", error: null });
  },

  async mergeSelectedStems(artifactIds) {
    const loadedSession = get().activeSession;
    if (!loadedSession || artifactIds.length === 0) return;
    const sources = loadedSession.session.artifacts.filter((artifact) => artifactIds.includes(artifact.id));
    const paths = sources.map((artifact) => artifactAbsolutePath(loadedSession, artifact)).filter((path): path is string => Boolean(path));
    if (paths.length !== sources.length) {
      set({ error: "Every selected stem must have a readable file path." });
      return;
    }
    try {
      const activeRevision = activePromptRevision(loadedSession.session);
      const target = await allocateArtifactFile(loadedSession.path, activeRevision.artifactFolder, `${nextArtifactName(loadedSession.session)}-premix.wav`, ".wav");
      const response = await mergeSeparationOutputs({
        merge_id: `merge_${Date.now().toString(36)}`,
        output_paths: paths,
        input_gains_db: sources.map((source) => source.volumeDb),
        destination_path: target.absolutePath,
      });
      if (response.status !== "ready") throw new Error(response.error || "Stem merge failed.");
      const artifact = createArtifact({
        session: loadedSession.session,
        kind: "premix_audio",
        fileName: target.fileName,
        filePath: target.relativePath,
        status: "ready",
        conversion: {
          type: "merge",
          sourceTool: "ffmpeg",
          sourcePath: null,
          sourceArtifactIds: sources.map((source) => source.id),
          guideAudioPath: null,
        },
      });
      const updated = await saveSessionMutation(
        loadedSession,
        {
          type: "artifact_merge",
          summary: "Merged selected stems",
          payload: { artifactIds, artifactId: artifact.id },
        },
        (session) => ({ ...session, artifacts: [...session.artifacts, artifact] }),
      );
      set({ activeSession: updated, status: "Premix artifact ready", error: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  async createDerivedSessionFromArtifact(artifactId, type) {
    const root = get().workingDirectory;
    const loadedSession = get().activeSession;
    const settings = get().workspaceMetadata?.modelSettings ?? localModelSettings();
    if (!root || !loadedSession) return;
    const source = loadedSession.session.artifacts.find((item) => item.id === artifactId);
    if (!source) return;
    try {
      let sourceAudioArtifact = source;
      let updatedSession = loadedSession;
      if (source.mediaType === "audio/midi") {
        const result = await addGuideAndAudioForMidi(loadedSession, source, type, settings, (job) => get().setWorkerJob(job));
        updatedSession = result.loadedSession;
        sourceAudioArtifact = result.sourceAudioArtifact;
        set({ activeSession: updatedSession });
      } else {
        await get().convertArtifactToMidi(source.id, "melodic");
        const latestSession = get().activeSession ?? updatedSession;
        const midiArtifact = latestSession.session.artifacts
          .filter((artifact) => artifact.parentArtifactId === source.id && artifact.mediaType === "audio/midi")
          .at(-1);
        if (!midiArtifact) throw new Error("Melodic MIDI conversion did not produce an artifact.");
        const result = await addGuideAndAudioForMidi(latestSession, midiArtifact, type, settings, (job) => get().setWorkerJob(job));
        updatedSession = result.loadedSession;
        sourceAudioArtifact = result.sourceAudioArtifact;
        set({ activeSession: updatedSession });
      }

      const sourceName = `${updatedSession.session.name}-${sourceAudioArtifact.name}-${type}`.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 64);
      const derived = await createSessionOnDisk(root, {
        type,
        name: sourceName || nextDefaultSessionName(get().sessions.map((session) => session.name)),
        bpm: updatedSession.session.bpm,
        bpmPreset: updatedSession.session.bpmPreset,
        tag: updatedSession.session.tags[0],
        exportFolder: updatedSession.session.exportFolder,
        lineage: {
          sourceSessionId: updatedSession.session.id,
          sourceArtifactId: sourceAudioArtifact.id,
          sourcePromptRevisionId: sourceAudioArtifact.promptRevisionId,
          action: source.mediaType === "audio/midi" ? "derived_from_midi" : "start_session_from_this_melody",
        },
      });
      const journaled = await saveSessionMutation(
        updatedSession,
        {
          type: "derived_session_create",
          summary: "Created derived session",
          payload: { sourceArtifactId: source.id, generatedAudioArtifactId: sourceAudioArtifact.id, derivedSessionId: derived.session.id },
        },
        (session) => session,
      );
      set({ activeSession: derived, status: "Derived session created", error: null });
      await saveLoadedSession(journaled);
      await get().refreshSessions();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
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
}));

export function bpmForPreset(preset: BpmPreset): number {
  return BPM_PRESETS.find((item) => item.id === preset)?.bpm ?? 120;
}

export { buildStemConstructorPrompt, preflightAllowsStudio };
