import { create } from "zustand";
import {
  activePromptRevision,
  ACTIVE_ARTIFACTS_DIRECTORY,
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
  copyReferenceAudioToSession,
  describeSessionStorageError,
  exportArtifactToFolder,
  getRememberedWorkingDirectory,
  loadSessionAtPath,
  loadWorkspaceMetadata,
  rememberWorkingDirectory,
  resolveSessionAssetPath,
  saveLoadedSession,
  saveWorkspaceMetadata,
  sessionAssetExists,
  scanSessionsRootDetailed,
  selectAudioFile,
  selectExportFolder,
  selectWorkingDirectory,
  updateWorkspaceMetadata,
  updateWorkspaceModelSettings,
  writeArtifactSidecar,
  writeSessionJobRecord,
  type LoadedSession,
  type SessionCard,
  type SessionScanProblem,
} from "../lib/session/storage";
import type { BpmPreset, GenostArtifact, GenostSession, ModelSettings, SessionType, WorkspaceMetadata } from "../lib/session/schema";
import {
  convertAudioToMidi,
  cancelWorkerJob,
  generateMidiFromText,
  getWorkerHealth,
  getWorkerJob,
  renderMidiGuideWav,
  renderStem,
  runWorkerPreflight,
  type WorkerHealth,
  type WorkerJobStatus,
  WorkerRenderCanceledError,
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
  sessionScanProblems: SessionScanProblem[];
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
  createSession: (draft: { type: SessionType; name?: string; bpm: number; bpmPreset: BpmPreset; tag?: string; exportFolder?: string | null }) => Promise<boolean>;
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
  cancelArtifactJob: (artifactId: string) => Promise<void>;
  retryAudioArtifact: (artifactId: string) => Promise<void>;
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
let preflightRequestVersion = 0;

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

function capabilityProblem(
  preflight: WorkerHealth["preflight"] | null,
  capability: string,
): string | null {
  const state = preflight?.capabilities[capability];
  if (state?.available) return null;
  return state?.setup_hint || state?.error || `${capability.replace(/_/g, " ")} is unavailable.`;
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

async function persistMusicgenJob(
  loadedSession: LoadedSession,
  artifact: GenostArtifact,
  status: "queued" | "running" | "complete" | "failed" | "canceled",
  result: Record<string, unknown> | null = null,
  error: string | null = null,
): Promise<void> {
  await writeSessionJobRecord(loadedSession.path, {
    jobId: `job_${artifact.id}`,
    operation: "musicgen",
    status,
    artifactIds: [artifact.id],
    request: {
      promptRevisionId: artifact.promptRevisionId,
      exactPrompt: artifact.provenance?.exactPrompt ?? null,
      model: artifact.provenance?.model ?? null,
      backend: artifact.provenance?.backend ?? null,
      seed: artifact.provenance?.seed ?? null,
      durationSeconds: artifact.provenance?.durationSeconds ?? null,
      referenceArtifactId: artifact.provenance?.referenceArtifactId ?? null,
      referencePath: artifact.provenance?.referencePath ?? null,
      outputPath: artifact.filePath,
    },
    result,
    error,
  });
}

async function reconcileInterruptedArtifacts(
  loadedSession: LoadedSession,
  setJob: (job: WorkerJobStatus) => void,
): Promise<LoadedSession> {
  const interrupted = loadedSession.session.artifacts.filter((artifact) =>
    ["queued", "generating"].includes(artifact.status),
  );
  if (interrupted.length === 0) return loadedSession;

  let session = loadedSession.session;
  const reconciled: Array<{ artifactId: string; status: GenostArtifact["status"] }> = [];
  for (const artifact of interrupted) {
    const job = await getWorkerJob(`job_${artifact.id}`).catch(() => null);
    if (job && ["queued", "rendering"].includes(job.status)) {
      setJob(job);
      continue;
    }
    const published = await sessionAssetExists(loadedSession.path, artifact.filePath).catch(() => false);
    const status: GenostArtifact["status"] =
      job?.status === "canceled"
        ? "canceled"
        : job?.status === "failed" || !published
          ? "failed"
          : "ready";
    const updatedArtifact: GenostArtifact = {
      ...artifact,
      status,
      error:
        status === "ready"
          ? null
          : job?.details?.error || job?.message || "Generation was interrupted before publication.",
      modelBackend:
        status === "ready" && job?.details
          ? {
              backend: job.details.backend,
              device: job.details.device,
              model: job.details.model,
              generationSeconds: job.details.generation_seconds,
              validationMetrics: job.details.validation_metrics,
              cachePath: artifact.modelBackend?.cachePath ?? null,
            }
          : artifact.modelBackend,
      updatedAt: nowIso(),
    };
    session = replaceArtifact(session, updatedArtifact);
    reconciled.push({ artifactId: artifact.id, status });
    if (status === "ready") {
      const absolutePath = artifactAbsolutePath(loadedSession, updatedArtifact);
      if (absolutePath) {
        await writeArtifactSidecar(absolutePath, { schemaVersion: 1, artifact: updatedArtifact }).catch(() => undefined);
      }
    }
    await persistMusicgenJob(
      loadedSession,
      updatedArtifact,
      status === "ready" ? "complete" : status === "canceled" ? "canceled" : "failed",
      job?.details ?? null,
      updatedArtifact.error,
    ).catch(() => undefined);
  }
  if (reconciled.length === 0) return loadedSession;
  return saveSessionMutation(
    loadedSession,
    {
      type: "generation_complete",
      summary: "Reconciled interrupted artifact jobs",
      payload: { artifacts: reconciled },
      actor: "system",
      source: "system",
    },
    () => session,
  );
}

async function reconcileMissingArtifacts(loadedSession: LoadedSession): Promise<LoadedSession> {
  let session = loadedSession.session;
  const changes: Array<{ artifactId: string; status: "ready" | "missing" }> = [];
  for (const artifact of loadedSession.session.artifacts) {
    if (!["ready", "missing"].includes(artifact.status)) continue;
    const present = await sessionAssetExists(loadedSession.path, artifact.filePath).catch(() => false);
    const status = present ? "ready" : "missing";
    if (artifact.status === status) continue;
    session = replaceArtifact(session, {
      ...artifact,
      status,
      error: present ? null : `Artifact file is missing: ${artifact.filePath}`,
      updatedAt: nowIso(),
    });
    changes.push({ artifactId: artifact.id, status });
  }
  if (changes.length === 0) return loadedSession;
  return saveSessionMutation(
    loadedSession,
    {
      type: "capability_failure",
      summary: "Reconciled missing artifact files",
      payload: { artifacts: changes },
      actor: "system",
      source: "system",
    },
    () => session,
  );
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
    provenance: {
      operation: "midi_to_guide",
      exactPrompt: null,
      model: null,
      backend: "pretty_midi+scipy",
      device: "cpu",
      seed: null,
      durationSeconds: guide.duration_seconds,
      referenceArtifactId: midiArtifact.id,
      referencePath: midiArtifact.filePath,
      sourceSessionId: loadedSession.session.id,
      sourceArtifactIds: [midiArtifact.id],
      settings: { sampleRate: 32000 },
      timings: {},
      createdAt: nowIso(),
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
  await writeArtifactSidecar(guideTarget.absolutePath, { schemaVersion: 1, artifact: guideArtifact });

  const audioTarget = await allocateArtifactFile(sessionPath, activeRevision.artifactFolder, `${nextArtifactName(updated.session)}.wav`, ".wav");
  const generationPrompt = generationPromptForSession(
    updated.session,
    activeRevision.prompt || `${updated.session.bpm} BPM, clean guide melody`,
  );
  const generationSeed = Date.now();
  const audioArtifact = createArtifact({
    session: updated.session,
    kind: "audio_clip",
    fileName: audioTarget.fileName,
    filePath: audioTarget.relativePath,
    parentArtifactId: guideArtifact.id,
    promptRevisionId: activeRevision.id,
    status: "generating",
    provenance: {
      operation: "musicgen",
      exactPrompt: generationPrompt,
      model: DEFAULT_MELODY_MODEL,
      backend: settings.backend,
      device: null,
      seed: generationSeed,
      durationSeconds: DEFAULT_GENERATION_SECONDS,
      referenceArtifactId: guideArtifact.id,
      referencePath: guideTarget.relativePath,
      sourceSessionId: updated.session.id,
      sourceArtifactIds: [midiArtifact.id, guideArtifact.id],
      settings: { targetType, modelCachePath: settings.cachePath || null },
      timings: {},
      createdAt: nowIso(),
    },
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
  await persistMusicgenJob(updated, audioArtifact, "queued");

  try {
    await persistMusicgenJob(updated, audioArtifact, "running");
    const result = await renderStem(
      {
        job_id: `job_${audioArtifact.id}`,
        kind: "conditioned",
        prompt: generationPrompt,
        output_path: audioTarget.absolutePath,
        duration_seconds: DEFAULT_GENERATION_SECONDS,
        model_name: DEFAULT_MELODY_MODEL,
        reference_audio_path: guide.file_path,
        seed: generationSeed,
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
      type: "generation_complete",
      summary: "Completed melody-conditioned guide generation",
      payload: { artifactId: readyArtifact.id, outputPath: readyArtifact.filePath },
    }, (session) => replaceArtifact(session, readyArtifact));
    await writeArtifactSidecar(audioTarget.absolutePath, { schemaVersion: 1, artifact: readyArtifact });
    await persistMusicgenJob(updated, readyArtifact, "complete", {
      backend: result.backend,
      device: result.device,
      model: result.model,
      generationSeconds: result.generation_seconds,
      validationMetrics: result.validation_metrics,
    });
    return { loadedSession: updated, sourceAudioArtifact: readyArtifact };
  } catch (error) {
    const failedArtifact: GenostArtifact = {
      ...audioArtifact,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      updatedAt: nowIso(),
    };
    updated = await saveSessionMutation(updated, {
      type: "generation_failed",
      summary: "Failed melody-conditioned guide generation",
      payload: { artifactId: failedArtifact.id, error: failedArtifact.error },
    }, (session) => replaceArtifact(session, failedArtifact));
    await persistMusicgenJob(updated, failedArtifact, "failed", null, failedArtifact.error);
    throw error;
  }
}

export const useSessionStudioStore = create<SessionStudioState>((set, get) => ({
  theme: initialTheme,
  workingDirectory: null,
  workspaceMetadata: null,
  sessions: [],
  sessionScanProblems: [],
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
        await get().checkPreflight();
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
      set({ sessions: [], sessionScanProblems: [] });
      return;
    }

    try {
      const result = await scanSessionsRootDetailed(root);
      set({
        sessions: result.sessions,
        sessionScanProblems: result.problems,
        status: result.problems.length
          ? `Found ${result.sessions.length} session(s); skipped ${result.problems.length} invalid folder(s)`
          : `Found ${result.sessions.length} session(s)`,
        error: result.problems.length ? `${result.problems.length} session folder(s) could not be read.` : null,
      });
    } catch (error) {
      set({ error: describeSessionStorageError(error, "Refreshing sessions", root) });
    }
  },

  async checkPreflight() {
    const requestVersion = ++preflightRequestVersion;
    const settings = get().workspaceMetadata?.modelSettings ?? localModelSettings();
    set({ preflightChecking: true, error: null });
    try {
      const preflight = await runWorkerPreflight({
        model_cache_path: settings.cachePath || null,
        hf_home: settings.hfHome || settings.cachePath || null,
        backend: settings.backend,
      });
      const health = await getWorkerHealth().catch(() => null);
      if (requestVersion !== preflightRequestVersion) return;
      set({
        workerHealth: health,
        workerPreflight: preflight,
        preflightChecking: false,
        status: preflight.ok ? "Model preflight passed" : "Model preflight blocked studio actions",
        error: preflight.ok ? null : preflight.errors[0] ?? "Required MusicGen models are missing.",
      });
    } catch (error) {
      if (requestVersion !== preflightRequestVersion) return;
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
      return false;
    }
    if (!preflightAllowsStudio(get().workerPreflight)) {
      set({ error: "GENOST requires local facebook/musicgen-medium and facebook/musicgen-melody before sessions can be created." });
      return false;
    }

    try {
      const name = draft.name?.trim() || nextDefaultSessionName(get().sessions.map((session) => session.name));
      const loadedSession = await createSessionOnDisk(root, { ...draft, name });
      set({ activeSession: loadedSession, selectedReferenceAudio: null, saveState: "saved", status: "Session created", error: null });
      await get().refreshSessions();
      return true;
    } catch (error) {
      set({ error: describeSessionStorageError(error, "Creating session", root) });
      return false;
    }
  },

  async openSession(path) {
    if (!preflightAllowsStudio(get().workerPreflight)) {
      set({ error: "GENOST requires local facebook/musicgen-medium and facebook/musicgen-melody before sessions can be opened." });
      return;
    }

    try {
      let loadedSession = await loadSessionAtPath(path);
      loadedSession = await reconcileMissingArtifacts(loadedSession);
      loadedSession = await reconcileInterruptedArtifacts(loadedSession, (job) => get().setWorkerJob(job));
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
          type: "prompt_edit",
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
    const loadedSession = get().activeSession;
    if (!loadedSession) return;
    try {
      const selected = await selectAudioFile();
      if (!selected) return;
      const copied = await copyReferenceAudioToSession(
        loadedSession.path,
        selected.path,
        ACTIVE_ARTIFACTS_DIRECTORY,
      );
      const artifact = createArtifact({
        session: loadedSession.session,
        kind: "audio_clip",
        fileName: copied.fileName,
        filePath: copied.relativePath,
        status: "ready",
        provenance: {
          operation: "import",
          exactPrompt: null,
          model: null,
          backend: null,
          device: null,
          seed: null,
          durationSeconds: null,
          referenceArtifactId: null,
          referencePath: selected.path,
          sourceSessionId: loadedSession.session.id,
          sourceArtifactIds: [],
          settings: {},
          timings: {},
          createdAt: nowIso(),
        },
      });
      const updated = await saveSessionMutation(
        loadedSession,
        {
          type: "reference_import",
          summary: "Imported reference audio",
          payload: { artifactId: artifact.id, sourcePath: selected.path, filePath: artifact.filePath },
        },
        (session) => ({ ...session, artifacts: [...session.artifacts, artifact] }),
      );
      await writeArtifactSidecar(copied.absolutePath, { schemaVersion: 1, artifact });
      set({
        activeSession: updated,
        selectedReferenceAudio: {
          path: copied.absolutePath,
          name: artifact.name,
          source: "artifact",
          artifactId: artifact.id,
        },
        status: "Reference audio imported",
        error: null,
      });
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
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 16) {
      set({ error: "Generation quantity must be between 1 and 16." });
      return;
    }

    const activeRevision = activePromptRevision(loadedSession.session);
    if (activeRevision.locked) {
      set({ error: "Archive the locked prompt before generating a new batch." });
      return;
    }
    const useReference = Boolean(referencePath?.trim());
    const referenceArtifactId = get().selectedReferenceAudio?.artifactId ?? null;
    const seedBase = Date.now();
    const artifacts: Array<{ artifact: GenostArtifact; absolutePath: string; seed: number }> = [];
    let stagedSession = loadedSession.session;

    try {
      set({ saveState: "saving", status: "Preparing generation", error: null });
      for (let index = 0; index < quantity; index += 1) {
        const seed = seedBase + index;
        const target = await allocateArtifactFile(loadedSession.path, activeRevision.artifactFolder, `${nextArtifactName(stagedSession)}.wav`, ".wav");
        const artifact = createArtifact({
          session: stagedSession,
          kind: "audio_clip",
          fileName: target.fileName,
          filePath: target.relativePath,
          promptRevisionId: activeRevision.id,
          status: "generating",
          provenance: {
            operation: "musicgen",
            exactPrompt: prompt,
            model: useReference ? DEFAULT_MELODY_MODEL : DEFAULT_TEXT_MODEL,
            backend: settings.backend,
            device: null,
            seed,
            durationSeconds: DEFAULT_GENERATION_SECONDS,
            referenceArtifactId,
            referencePath: referencePath ?? null,
            sourceSessionId: loadedSession.session.id,
            sourceArtifactIds: referenceArtifactId ? [referenceArtifactId] : [],
            settings: { quantity, modelCachePath: settings.cachePath || null },
            timings: {},
            createdAt: nowIso(),
          },
        });
        artifacts.push({ artifact, absolutePath: target.absolutePath, seed });
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
                referenceArtifactId,
                seeds: artifacts.map((item) => item.seed),
              },
            },
            hashSession(loadedSession.session),
            hashSession(queuedSession),
          ),
        ),
      };
      await saveLoadedSession(updated);
      await Promise.all(artifacts.map((item) => persistMusicgenJob(updated, item.artifact, "queued")));
      set({ activeSession: updated, saveState: "saved", status: "Generation queued" });

      for (const item of artifacts) {
        try {
          await persistMusicgenJob(updated, item.artifact, "running");
          const result = await renderStem(
            {
              job_id: `job_${item.artifact.id}`,
              kind: useReference ? "conditioned" : "text",
              prompt,
              output_path: item.absolutePath,
              duration_seconds: DEFAULT_GENERATION_SECONDS,
              model_name: useReference ? DEFAULT_MELODY_MODEL : DEFAULT_TEXT_MODEL,
              reference_audio_path: referencePath ?? null,
              seed: item.seed,
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
              type: "generation_complete",
              summary: "Completed audio artifact generation",
              payload: { artifactId: readyArtifact.id, outputPath: readyArtifact.filePath },
            },
            (session) => replaceArtifact(session, readyArtifact),
          );
          await writeArtifactSidecar(item.absolutePath, { schemaVersion: 1, artifact: readyArtifact });
          await persistMusicgenJob(updated, readyArtifact, "complete", {
            backend: result.backend,
            device: result.device,
            model: result.model,
            generationSeconds: result.generation_seconds,
            validationMetrics: result.validation_metrics,
          });
          set({ activeSession: updated, saveState: "saved", status: "Audio artifact ready", error: null });
        } catch (error) {
          const failedArtifact: GenostArtifact = {
            ...item.artifact,
            status: error instanceof WorkerRenderCanceledError ? "canceled" : "failed",
            error: error instanceof Error ? error.message : String(error),
            updatedAt: nowIso(),
          };
          updated = await saveSessionMutation(
            updated,
            {
              type: error instanceof WorkerRenderCanceledError ? "job_cancel" : "generation_failed",
              summary: error instanceof WorkerRenderCanceledError ? "Canceled audio artifact generation" : "Failed audio artifact generation",
              payload: { artifactId: failedArtifact.id, error: failedArtifact.error },
            },
            (session) => replaceArtifact(session, failedArtifact),
          );
          await persistMusicgenJob(
            updated,
            failedArtifact,
            failedArtifact.status === "canceled" ? "canceled" : "failed",
            null,
            failedArtifact.error,
          );
          set({ activeSession: updated, saveState: "saved", status: null, error: failedArtifact.error });
        }
      }
      await get().refreshSessions();
    } catch (error) {
      set({ saveState: "error", error: describeSessionStorageError(error, "Preparing generation", loadedSession.path) });
    }
  },

  async cancelArtifactJob(artifactId) {
    const loadedSession = get().activeSession;
    if (!loadedSession) return;
    const artifact = loadedSession.session.artifacts.find((item) => item.id === artifactId);
    if (!artifact || !["queued", "generating"].includes(artifact.status)) return;
    const jobId = `job_${artifact.id}`;
    try {
      const job = await cancelWorkerJob(jobId);
      if (job) get().setWorkerJob(job);
      const canceledArtifact: GenostArtifact = {
        ...artifact,
        status: "canceled",
        error: "Canceled by user",
        updatedAt: nowIso(),
      };
      const updated = await saveSessionMutation(
        loadedSession,
        {
          type: "job_cancel",
          summary: "Canceled artifact generation",
          payload: { artifactId, jobId },
        },
        (session) => replaceArtifact(session, canceledArtifact),
      );
      await persistMusicgenJob(updated, canceledArtifact, "canceled", null, canceledArtifact.error);
      set({ activeSession: updated, status: "Generation canceled", error: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  async retryAudioArtifact(artifactId) {
    const loadedSession = get().activeSession;
    const settings = get().workspaceMetadata?.modelSettings ?? localModelSettings();
    if (!loadedSession) return;
    const source = loadedSession.session.artifacts.find((item) => item.id === artifactId);
    if (!source || source.provenance?.operation !== "musicgen") {
      set({ error: "Only MusicGen audio artifacts can be retried." });
      return;
    }
    const revision = loadedSession.session.promptHistory.revisions.find(
      (item) => item.id === source.promptRevisionId,
    );
    if (!revision) {
      set({ error: "The source artifact prompt revision is missing." });
      return;
    }
    const prompt = source.provenance.exactPrompt;
    if (!prompt) {
      set({ error: "The source artifact has no recorded prompt." });
      return;
    }
    const referencePath = source.provenance.referencePath
      ? resolveSessionAssetPath(loadedSession.path, source.provenance.referencePath)
      : null;
    const seed = Date.now();
    try {
      const target = await allocateArtifactFile(
        loadedSession.path,
        revision.artifactFolder,
        `${nextArtifactName(loadedSession.session)}.wav`,
        ".wav",
      );
      const retried = createArtifact({
        session: loadedSession.session,
        kind: "audio_clip",
        fileName: target.fileName,
        filePath: target.relativePath,
        parentArtifactId: source.id,
        promptRevisionId: revision.id,
        status: "generating",
        provenance: {
          ...source.provenance,
          seed,
          referencePath,
          settings: { ...source.provenance.settings, retryOf: source.id },
          createdAt: nowIso(),
        },
      });
      let updated = await saveSessionMutation(
        loadedSession,
        {
          type: "job_retry",
          summary: "Retried audio generation as a new artifact",
          payload: { sourceArtifactId: source.id, artifactId: retried.id, seed },
        },
        (session) => ({ ...session, artifacts: [...session.artifacts, retried] }),
      );
      await persistMusicgenJob(updated, retried, "queued");
      set({ activeSession: updated, status: "Retry queued", error: null });
      try {
        await persistMusicgenJob(updated, retried, "running");
        const result = await renderStem(
          {
            job_id: `job_${retried.id}`,
            kind: referencePath ? "conditioned" : "text",
            prompt,
            output_path: target.absolutePath,
            duration_seconds: Math.round(source.provenance.durationSeconds ?? DEFAULT_GENERATION_SECONDS),
            model_name: source.provenance.model ?? (referencePath ? DEFAULT_MELODY_MODEL : DEFAULT_TEXT_MODEL),
            reference_audio_path: referencePath,
            seed,
            model_cache_path: settings.cachePath || null,
            backend: settings.backend,
            audio_validation_profile: "music",
            audio_content_category: loadedSession.session.type === "stem_constructor" ? "melody" : "generic",
          },
          (job) => get().setWorkerJob(job),
        );
        const ready: GenostArtifact = {
          ...retried,
          status: "ready",
          error: null,
          modelBackend: {
            backend: result.backend,
            device: result.device,
            model: result.model,
            generationSeconds: result.generation_seconds,
            validationMetrics: result.validation_metrics,
            cachePath: settings.cachePath || null,
          },
          updatedAt: nowIso(),
        };
        updated = await saveSessionMutation(
          updated,
          {
            type: "generation_complete",
            summary: "Completed retried audio generation",
            payload: { sourceArtifactId: source.id, artifactId: ready.id },
          },
          (session) => replaceArtifact(session, ready),
        );
        await writeArtifactSidecar(target.absolutePath, { schemaVersion: 1, artifact: ready });
        await persistMusicgenJob(updated, ready, "complete", {
          backend: result.backend,
          device: result.device,
          model: result.model,
          generationSeconds: result.generation_seconds,
          validationMetrics: result.validation_metrics,
        });
        set({ activeSession: updated, status: "Retry ready", error: null });
      } catch (error) {
        const failed: GenostArtifact = {
          ...retried,
          status: error instanceof WorkerRenderCanceledError ? "canceled" : "failed",
          error: error instanceof Error ? error.message : String(error),
          updatedAt: nowIso(),
        };
        updated = await saveSessionMutation(
          updated,
          {
            type: failed.status === "canceled" ? "job_cancel" : "generation_failed",
            summary: failed.status === "canceled" ? "Canceled retried generation" : "Failed retried generation",
            payload: { sourceArtifactId: source.id, artifactId: failed.id, error: failed.error },
          },
          (session) => replaceArtifact(session, failed),
        );
        await persistMusicgenJob(
          updated,
          failed,
          failed.status === "canceled" ? "canceled" : "failed",
          null,
          failed.error,
        );
        set({ activeSession: updated, status: null, error: failed.error });
      }
      await get().refreshSessions();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  async generateMidiArtifacts({ prompt, quantity }) {
    const loadedSession = get().activeSession;
    if (!loadedSession) return;
    const text2midiProblem = capabilityProblem(get().workerPreflight, "text2midi");
    if (text2midiProblem) {
      const updated = await saveSessionMutation(
        loadedSession,
        {
          type: "capability_failure",
          summary: "Blocked MIDI generation because Text2midi is unavailable",
          payload: { capability: "text2midi", error: text2midiProblem },
        },
        (session) => session,
      ).catch(() => loadedSession);
      set({ activeSession: updated, error: text2midiProblem });
      return;
    }
    if (!prompt.trim()) {
      set({ error: "Prompt is required before MIDI generation." });
      return;
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 16) {
      set({ error: "MIDI quantity must be between 1 and 16." });
      return;
    }
    const activeRevision = activePromptRevision(loadedSession.session);
    if (activeRevision.locked) {
      set({ error: "Archive the locked prompt before generating a new batch." });
      return;
    }
    const outputDirectory = resolveSessionAssetPath(loadedSession.path, activeRevision.artifactFolder);
    if (!outputDirectory) {
      set({ error: "Active artifact folder is unavailable." });
      return;
    }
    const jobId = `text2midi_${activeRevision.id}_${Date.now()}`;

    try {
      const requested = await saveSessionMutation(
        loadedSession,
        {
          type: "generation_request",
          summary: "Requested MIDI generation",
          payload: {
            promptRevisionId: activeRevision.id,
            quantity,
            model: "amaai-lab/text2midi",
            prompt,
            jobId,
          },
        },
        (session) => ({
          ...session,
          promptHistory: {
            ...session.promptHistory,
            revisions: session.promptHistory.revisions.map((revision) =>
              revision.id === activeRevision.id
                ? { ...revision, prompt, locked: true, updatedAt: nowIso() }
                : revision,
            ),
          },
        }),
      );
      await writeSessionJobRecord(requested.path, {
        jobId,
        operation: "text2midi",
        status: "queued",
        artifactIds: [],
        request: { promptRevisionId: activeRevision.id, prompt, quantity, outputDirectory },
        result: null,
        error: null,
      });
      set({ activeSession: requested, status: "Generating MIDI", error: null });
      await writeSessionJobRecord(requested.path, {
        jobId,
        operation: "text2midi",
        status: "running",
        artifactIds: [],
        request: { promptRevisionId: activeRevision.id, prompt, quantity, outputDirectory },
        result: null,
        error: null,
      });
      const response = await generateMidiFromText({ prompt, output_directory: outputDirectory, quantity });
      if (response.status !== "ready") throw new Error(response.error || "MIDI generation failed.");
      let session = requested.session;
      const createdArtifacts: Array<{ artifact: GenostArtifact; absolutePath: string }> = [];
      for (const output of response.outputs) {
        const artifact = createArtifact({
          session,
          kind: "midi_clip",
          fileName: output.file_name,
          filePath: `${activeRevision.artifactFolder}/${output.file_name}`,
          promptRevisionId: activeRevision.id,
          status: "ready",
          modelBackend: {
            backend: "text2midi",
            device: null,
            model: response.model ?? "amaai-lab/text2midi",
            generationSeconds: response.generation_seconds,
            validationMetrics: null,
            cachePath: null,
          },
          provenance: {
            operation: "text2midi",
            exactPrompt: prompt,
            model: response.model_version
              ? `${response.model ?? "amaai-lab/text2midi"}@${response.model_version}`
              : response.model ?? "amaai-lab/text2midi",
            backend: "local",
            device: null,
            seed: output.seed,
            durationSeconds: null,
            referenceArtifactId: null,
            referencePath: null,
            sourceSessionId: requested.session.id,
            sourceArtifactIds: [],
            settings: { quantity },
            timings: { generationSeconds: response.generation_seconds ?? 0 },
            createdAt: nowIso(),
          },
        });
        createdArtifacts.push({ artifact, absolutePath: output.file_path });
        session = withSessionUpdatedAt({ ...session, artifacts: [...session.artifacts, artifact] });
      }
      const updated = await saveSessionMutation(
        requested,
        {
          type: "generation_complete",
          summary: "Generated MIDI artifacts",
          payload: {
            promptRevisionId: activeRevision.id,
            quantity,
            model: "amaai-lab/text2midi",
            artifactIds: createdArtifacts.map((item) => item.artifact.id),
          },
        },
        () => session,
      );
      await Promise.all(
        createdArtifacts.map((item) =>
          writeArtifactSidecar(item.absolutePath, { schemaVersion: 1, artifact: item.artifact }),
        ),
      );
      await writeSessionJobRecord(updated.path, {
        jobId,
        operation: "text2midi",
        status: "complete",
        artifactIds: createdArtifacts.map((item) => item.artifact.id),
        request: { promptRevisionId: activeRevision.id, prompt, quantity, outputDirectory },
        result: {
          model: response.model ?? null,
          modelVersion: response.model_version ?? null,
          generationSeconds: response.generation_seconds ?? null,
          outputCount: response.outputs.length,
        },
        error: null,
      });
      set({ activeSession: updated, status: "MIDI artifacts ready", error: null });
      await get().refreshSessions();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const current = get().activeSession;
      if (current?.session.id === loadedSession.session.id) {
        const failed = await saveSessionMutation(
          current,
          {
            type: "generation_failed",
            summary: "MIDI generation failed",
            payload: { promptRevisionId: activeRevision.id, error: message },
          },
          (session) => session,
        ).catch(() => current);
        await writeSessionJobRecord(failed.path, {
          jobId,
          operation: "text2midi",
          status: "failed",
          artifactIds: [],
          request: { promptRevisionId: activeRevision.id, prompt, quantity, outputDirectory },
          result: null,
          error: message,
        }).catch(() => undefined);
        set({ activeSession: failed, error: message });
      } else {
        set({ error: message });
      }
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
    const capability = mode === "melodic" ? "basic_pitch" : "omnizart";
    const problem = capabilityProblem(get().workerPreflight, capability);
    if (problem) {
      const updated = await saveSessionMutation(
        loadedSession,
        {
          type: "capability_failure",
          summary: `Blocked ${mode} MIDI conversion`,
          payload: { capability, artifactId, error: problem },
        },
        (session) => session,
      ).catch(() => loadedSession);
      set({ activeSession: updated, error: problem });
      return;
    }
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
        provenance: {
          operation: "audio_to_midi",
          exactPrompt: null,
          model: null,
          backend: mode === "melodic" ? "basic-pitch" : "omnizart",
          device: null,
          seed: null,
          durationSeconds: null,
          referenceArtifactId: source.id,
          referencePath: source.filePath,
          sourceSessionId: loadedSession.session.id,
          sourceArtifactIds: [source.id],
          settings: { mode },
          timings: {},
          createdAt: nowIso(),
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
      await writeArtifactSidecar(target.absolutePath, { schemaVersion: 1, artifact });
      set({ activeSession: updated, status: "MIDI artifact ready", error: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  async splitArtifactIntoStems(artifactId) {
    const loadedSession = get().activeSession;
    if (!loadedSession) return;
    const source = loadedSession.session.artifacts.find((item) => item.id === artifactId);
    const problem = capabilityProblem(get().workerPreflight, "separator");
    if (problem) {
      set({ error: problem });
      return;
    }
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
      const createdArtifacts: Array<{ artifact: GenostArtifact; absolutePath: string }> = [];
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
          provenance: {
            operation: "separation",
            exactPrompt: null,
            model: response.model ?? "audio-separator",
            backend: "local",
            device: null,
            seed: null,
            durationSeconds: output.duration_seconds,
            referenceArtifactId: source.id,
            referencePath: source.filePath,
            sourceSessionId: loadedSession.session.id,
            sourceArtifactIds: [source.id],
            settings: { bundleName, label: output.label },
            timings: {},
            createdAt: nowIso(),
          },
        });
        createdArtifacts.push({ artifact, absolutePath: output.file_path });
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
      await Promise.all(
        createdArtifacts.map((item) =>
          writeArtifactSidecar(item.absolutePath, { schemaVersion: 1, artifact: item.artifact }),
        ),
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
      { type: "artifact_volume_change", summary: "Changed stem volume", payload: { artifactId, volumeDb } },
      (session) => replaceArtifact(session, updatedArtifact),
    );
    set({ activeSession: updated, status: "Stem level saved", error: null });
  },

  async mergeSelectedStems(artifactIds) {
    const loadedSession = get().activeSession;
    if (!loadedSession || artifactIds.length === 0) return;
    const problem = capabilityProblem(get().workerPreflight, "merge");
    if (problem) {
      set({ error: problem });
      return;
    }
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
        provenance: {
          operation: "merge",
          exactPrompt: null,
          model: null,
          backend: "ffmpeg",
          device: null,
          seed: null,
          durationSeconds: response.duration_seconds,
          referenceArtifactId: null,
          referencePath: null,
          sourceSessionId: loadedSession.session.id,
          sourceArtifactIds: sources.map((source) => source.id),
          settings: { inputGainsDb: sources.map((source) => source.volumeDb) },
          timings: {},
          createdAt: nowIso(),
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
      await writeArtifactSidecar(target.absolutePath, { schemaVersion: 1, artifact });
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
    const requiredCapabilities =
      source.mediaType === "audio/midi"
        ? ["midi_guide"]
        : ["separator", "merge", "basic_pitch", "midi_guide"];
    const problem = requiredCapabilities
      .map((capability) => capabilityProblem(get().workerPreflight, capability))
      .find((value): value is string => Boolean(value));
    if (problem) {
      set({ error: problem });
      return;
    }
    try {
      let sourceAudioArtifact = source;
      let updatedSession = loadedSession;
      if (source.mediaType === "audio/midi") {
        const result = await addGuideAndAudioForMidi(loadedSession, source, type, settings, (job) => get().setWorkerJob(job));
        updatedSession = result.loadedSession;
        sourceAudioArtifact = result.sourceAudioArtifact;
        set({ activeSession: updatedSession });
      } else {
        await get().splitArtifactIntoStems(source.id);
        let latestSession = get().activeSession ?? updatedSession;
        const melodicStems = latestSession.session.artifacts.filter(
          (artifact) =>
            artifact.parentArtifactId === source.id &&
            artifact.kind === "separated_stem" &&
            !artifact.fileName.toLocaleLowerCase().includes("drum"),
        );
        if (melodicStems.length === 0) {
          throw new Error("Drum removal did not produce any melodic stems.");
        }
        await get().mergeSelectedStems(melodicStems.map((artifact) => artifact.id));
        latestSession = get().activeSession ?? latestSession;
        const cleanMelodicArtifact = latestSession.session.artifacts
          .filter(
            (artifact) =>
              artifact.kind === "premix_audio" &&
              melodicStems.every((stem) => artifact.conversion?.sourceArtifactIds.includes(stem.id)),
          )
          .at(-1);
        if (!cleanMelodicArtifact) throw new Error("Drum-removed melodic audio was not published.");
        await get().convertArtifactToMidi(cleanMelodicArtifact.id, "melodic");
        latestSession = get().activeSession ?? latestSession;
        const midiArtifact = latestSession.session.artifacts
          .filter((artifact) => artifact.parentArtifactId === cleanMelodicArtifact.id && artifact.mediaType === "audio/midi")
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
      const sourceAudioPath = artifactAbsolutePath(updatedSession, sourceAudioArtifact);
      if (!sourceAudioPath) throw new Error("Generated source audio path is unavailable.");
      const derivedRevision = activePromptRevision(derived.session);
      const copiedSource = await copyReferenceAudioToSession(
        derived.path,
        sourceAudioPath,
        derivedRevision.artifactFolder,
      );
      const materializedSource = createArtifact({
        session: derived.session,
        name: `${sourceAudioArtifact.name} source`,
        kind: "audio_clip",
        fileName: copiedSource.fileName,
        filePath: copiedSource.relativePath,
        sourceSessionId: updatedSession.session.id,
        status: "ready",
        provenance: {
          operation: "derived_session",
          exactPrompt: sourceAudioArtifact.provenance?.exactPrompt ?? null,
          model: sourceAudioArtifact.provenance?.model ?? null,
          backend: sourceAudioArtifact.provenance?.backend ?? null,
          device: sourceAudioArtifact.provenance?.device ?? null,
          seed: sourceAudioArtifact.provenance?.seed ?? null,
          durationSeconds: sourceAudioArtifact.provenance?.durationSeconds ?? null,
          referenceArtifactId: sourceAudioArtifact.id,
          referencePath: sourceAudioArtifact.filePath,
          sourceSessionId: updatedSession.session.id,
          sourceArtifactIds: [source.id, sourceAudioArtifact.id],
          settings: { derivedSessionType: type },
          timings: {},
          createdAt: nowIso(),
        },
      });
      const materializedDerived = await saveSessionMutation(
        derived,
        {
          type: "reference_import",
          summary: "Materialized derived-session source audio",
          payload: {
            sourceSessionId: updatedSession.session.id,
            sourceArtifactId: sourceAudioArtifact.id,
            artifactId: materializedSource.id,
          },
        },
        (session) => ({ ...session, artifacts: [...session.artifacts, materializedSource] }),
      );
      await writeArtifactSidecar(copiedSource.absolutePath, {
        schemaVersion: 1,
        artifact: materializedSource,
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
      set({
        activeSession: materializedDerived,
        selectedReferenceAudio: {
          path: copiedSource.absolutePath,
          name: materializedSource.name,
          source: "artifact",
          artifactId: materializedSource.id,
        },
        status: "Derived session created",
        error: null,
      });
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
