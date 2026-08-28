import { join } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { copyFile, exists, mkdir, readDir, readTextFile, rename, stat, writeTextFile } from "@tauri-apps/plugin-fs";
import { Store } from "@tauri-apps/plugin-store";
import { isAbsoluteAssetPath, isUriAssetPath } from "../audio/paths";
import {
  appendCommand,
  ACTIVE_ARTIFACTS_DIRECTORY,
  COMMANDS_FILE_NAME,
  createCommandEntry,
  createCommandJournal,
  createEmptySession,
  createWorkspaceMetadata,
  hashSession,
  mergeTags,
  sanitizeSessionFolderName,
  SESSION_FILE_NAME,
  WORKSPACE_COMMANDS_FILE_NAME,
  WORKSPACE_FILE_NAME,
  type CommandDraft,
} from "./format";
import {
  commandJournalSchema,
  sessionJobRecordSchema,
  sessionSchema,
  workspaceMetadataSchema,
  type CommandJournal,
  type GenostArtifact,
  type GenostSession,
  type ModelSettings,
  type SessionJobRecord,
  type SessionType,
  type WorkspaceMetadata,
} from "./schema";

const SETTINGS_FILE = "settings.json";
export const JOBS_DIRECTORY = "jobs";
const WORKING_DIRECTORY_KEY = "workingDirectory";
const PERMISSION_ERROR_PATTERN =
  /(permission|denied|not allowed|forbidden|scope|security-scoped|operation not permitted|os error 13)/i;
const sessionSaveQueues = new Map<string, Promise<void>>();
const workspaceSaveQueues = new Map<string, Promise<void>>();

export type SessionCard = {
  id: string;
  name: string;
  title: string;
  type: SessionType;
  path: string;
  updatedAt: string;
  artifactCount: number;
  tags: string[];
};

export type SessionScanProblem = {
  path: string;
  message: string;
};

export type SessionScanResult = {
  sessions: SessionCard[];
  problems: SessionScanProblem[];
};

export type LoadedSession = {
  path: string;
  session: GenostSession;
  commands: CommandJournal;
};

export type SelectedFile = {
  path: string;
  name: string;
};

export type CreateSessionDraft = {
  type: SessionType;
  name: string;
  bpm: number;
  bpmPreset: GenostSession["bpmPreset"];
  tag?: string;
  exportFolder?: string | null;
  lineage?: Partial<GenostSession["lineage"]>;
};

export type ExportedArtifact = {
  artifact: GenostArtifact;
  exportPath: string;
  exportName: string;
};

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function requireTauri(): void {
  if (!isTauriRuntime()) {
    throw new Error("Filesystem actions require the Tauri desktop runtime. Use npm run tauri:dev.");
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isSessionStoragePermissionError(error: unknown): boolean {
  return PERMISSION_ERROR_PATTERN.test(errorMessage(error));
}

export function describeSessionStorageError(error: unknown, action: string, path?: string): string {
  const message = errorMessage(error);
  if (isSessionStoragePermissionError(error)) {
    const pathDetail = path ? ` for ${path}` : "";
    return `${action} failed because GENOST does not have filesystem permission${pathDetail}. Select the working directory again, or move it under your home, Desktop, Documents, Downloads, or /Volumes. Raw error: ${message}`;
  }
  return `${action} failed: ${message}`;
}

async function readJsonFile<T>(path: string, parser: { parse: (value: unknown) => T }): Promise<T> {
  const text = await readTextFile(path);
  return parser.parse(JSON.parse(text));
}

function createAtomicJsonTempToken(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

export function createAtomicJsonTempPath(path: string, token = createAtomicJsonTempToken()): string {
  return `${path}.${token}.tmp`;
}

export function enqueueStorageOperation<T>(
  queues: Map<string, Promise<void>>,
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previousOperation = queues.get(key) ?? Promise.resolve();
  const queuedOperation = previousOperation.then(operation);
  let trackedOperation: Promise<void>;
  trackedOperation = queuedOperation
    .then(
      () => undefined,
      () => undefined,
    )
    .then(() => {
      if (queues.get(key) === trackedOperation) queues.delete(key);
    });

  queues.set(key, trackedOperation);
  return queuedOperation;
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const tmpPath = createAtomicJsonTempPath(path);
  await writeTextFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`);
  await rename(tmpPath, path);
}

function fileNameFromPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : "artifact.wav";
}

function splitFileName(fileName: string): { stem: string; extension: string } {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0) return { stem: fileName, extension: "" };
  return { stem: fileName.slice(0, dotIndex), extension: fileName.slice(dotIndex) };
}

function safeFileName(fileName: string, fallbackExtension: string): string {
  const { stem, extension } = splitFileName(fileName);
  const safeStem = stem
    .trim()
    .replace(/[^A-Za-z0-9 _-]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 72);
  return `${safeStem || "artifact"}${extension || fallbackExtension}`;
}

function relativeAssetPath(folder: string, fileName: string): string {
  return `${folder.replace(/^\/+|\/+$/g, "")}/${fileName}`;
}

export function resolveSessionAssetPath(sessionPath: string | null | undefined, assetPath: string | null | undefined): string | null {
  if (!assetPath) return null;
  const cleanedAssetPath = assetPath.trim();
  if (!cleanedAssetPath) return null;
  if (isUriAssetPath(cleanedAssetPath) || isAbsoluteAssetPath(cleanedAssetPath)) return cleanedAssetPath;
  if (!sessionPath?.trim()) return null;
  const cleanedSessionPath = sessionPath.trim().replace(/[\\/]+$/, "");
  const normalizedRelativePath = cleanedAssetPath.replace(/^\.[\\/]/, "").replace(/^[\\/]+/, "");
  const separator = cleanedSessionPath.includes("\\") && !cleanedSessionPath.includes("/") ? "\\" : "/";
  return `${cleanedSessionPath}${separator}${normalizedRelativePath}`;
}

async function uniqueFilePath(directoryPath: string, preferredName: string): Promise<{ path: string; name: string }> {
  const { stem, extension } = splitFileName(preferredName);
  let name = preferredName;
  let path = await join(directoryPath, name);
  if (!(await exists(path))) return { path, name };

  for (let index = 2; index < 1000; index += 1) {
    name = `${stem}_${index}${extension}`;
    path = await join(directoryPath, name);
    if (!(await exists(path))) return { path, name };
  }

  name = `${stem}_${Date.now().toString(36)}${extension}`;
  return { path: await join(directoryPath, name), name };
}

async function uniqueDirectoryPath(rootPath: string, preferredName: string): Promise<{ path: string; name: string }> {
  const safeName = sanitizeSessionFolderName(preferredName);
  let name = safeName;
  let path = await join(rootPath, name);
  if (!(await exists(path))) return { path, name };

  for (let index = 2; index < 1000; index += 1) {
    name = `${safeName}_${index}`;
    path = await join(rootPath, name);
    if (!(await exists(path))) return { path, name };
  }

  name = `${safeName}_${Date.now().toString(36)}`;
  return { path: await join(rootPath, name), name };
}

function sidecarPathForFilePath(path: string): string {
  const dotIndex = path.lastIndexOf(".");
  return dotIndex > 0 ? `${path.slice(0, dotIndex)}.json` : `${path}.json`;
}

export async function selectWorkingDirectory(): Promise<string | null> {
  requireTauri();
  const selected = await open({
    canCreateDirectories: true,
    directory: true,
    fileAccessMode: "scoped",
    multiple: false,
    recursive: true,
    title: "Select GENOST working directory",
  });
  return typeof selected === "string" ? selected : null;
}

export async function selectExportFolder(): Promise<string | null> {
  requireTauri();
  const selected = await open({
    canCreateDirectories: true,
    directory: true,
    fileAccessMode: "scoped",
    multiple: false,
    recursive: true,
    title: "Select session export folder",
  });
  return typeof selected === "string" ? selected : null;
}

export async function selectAudioFile(): Promise<SelectedFile | null> {
  requireTauri();
  const selected = await open({
    directory: false,
    multiple: false,
    title: "Select reference audio",
    fileAccessMode: "scoped",
    filters: [
      {
        name: "Audio",
        extensions: ["wav", "mp3", "aif", "aiff", "flac", "m4a", "ogg"],
      },
    ],
  });
  return typeof selected === "string" ? { path: selected, name: fileNameFromPath(selected) } : null;
}

export async function rememberWorkingDirectory(rootPath: string): Promise<void> {
  requireTauri();
  const store = await Store.load(SETTINGS_FILE, { autoSave: true });
  await store.set(WORKING_DIRECTORY_KEY, rootPath);
  await store.save();
}

export async function getRememberedWorkingDirectory(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  const store = await Store.load(SETTINGS_FILE, { autoSave: true });
  return (await store.get<string>(WORKING_DIRECTORY_KEY)) ?? null;
}

export async function loadWorkspaceMetadata(rootPath: string): Promise<WorkspaceMetadata> {
  requireTauri();
  const workspaceFilePath = await join(rootPath, WORKSPACE_FILE_NAME);
  if (!(await exists(workspaceFilePath))) {
    return createWorkspaceMetadata();
  }
  return readJsonFile(workspaceFilePath, workspaceMetadataSchema);
}

export async function saveWorkspaceMetadata(rootPath: string, metadata: WorkspaceMetadata): Promise<WorkspaceMetadata> {
  requireTauri();
  const updated: WorkspaceMetadata = { ...metadata, updatedAt: new Date().toISOString() };
  await enqueueStorageOperation(workspaceSaveQueues, rootPath, async () => {
    const workspaceFilePath = await join(rootPath, WORKSPACE_FILE_NAME);
    await writeJsonAtomic(workspaceFilePath, updated);
  });
  return updated;
}

export async function updateWorkspaceMetadata(
  rootPath: string,
  mutate: (metadata: WorkspaceMetadata) => WorkspaceMetadata,
): Promise<WorkspaceMetadata> {
  requireTauri();
  return enqueueStorageOperation(workspaceSaveQueues, rootPath, async () => {
    const existing = await loadWorkspaceMetadata(rootPath);
    const updated = { ...mutate(existing), updatedAt: new Date().toISOString() };
    const workspaceFilePath = await join(rootPath, WORKSPACE_FILE_NAME);
    await writeJsonAtomic(workspaceFilePath, updated);
    return updated;
  });
}

export async function ensureSessionFolders(sessionPath: string, session: GenostSession): Promise<void> {
  const folders = new Set(session.promptHistory.revisions.map((revision) => revision.artifactFolder));
  folders.add(ACTIVE_ARTIFACTS_DIRECTORY);
  folders.add(JOBS_DIRECTORY);
  for (const folder of folders) {
    const directoryPath = await join(sessionPath, folder);
    if (!(await exists(directoryPath))) await mkdir(directoryPath, { recursive: true });
  }
}

export async function createSessionOnDisk(rootPath: string, draft: CreateSessionDraft): Promise<LoadedSession> {
  requireTauri();
  const folder = await uniqueDirectoryPath(rootPath, draft.name);
  const session = createEmptySession({ ...draft, name: folder.name });
  const sessionPath = folder.path;

  await mkdir(sessionPath, { recursive: true });
  await ensureSessionFolders(sessionPath, session);

  const command = createCommandEntry(
    {
      type: "create_session",
      summary: `Created ${session.name}`,
      payload: {
        sessionType: session.type,
        name: session.name,
        requestedName: draft.name,
        bpm: session.bpm,
        bpmPreset: session.bpmPreset,
        exportFolder: session.exportFolder,
        tags: session.tags,
      },
    },
    undefined,
    hashSession(session),
  );
  const loadedSession = { path: sessionPath, session, commands: createCommandJournal(session.id, command) };

  await saveLoadedSession(loadedSession);
  await updateWorkspaceMetadata(rootPath, (metadata) => ({
    ...metadata,
    knownTags: mergeTags(metadata.knownTags, session.tags),
    lastSelectedSessionId: session.id,
  }));
  return loadedSession;
}

export async function scanSessionsRootDetailed(rootPath: string): Promise<SessionScanResult> {
  requireTauri();
  const entries = await readDir(rootPath);
  const cards: SessionCard[] = [];
  const problems: SessionScanProblem[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory) continue;
    const sessionPath = await join(rootPath, entry.name);
    try {
      const sessionFilePath = await join(sessionPath, SESSION_FILE_NAME);
      if (!(await exists(sessionFilePath))) continue;
      const session = await readJsonFile(sessionFilePath, sessionSchema);
      const info = await stat(sessionFilePath);
      cards.push({
        id: session.id,
        name: session.name,
        title: session.title,
        type: session.type,
        path: sessionPath,
        updatedAt: info.mtime?.toISOString() ?? session.updatedAt,
        artifactCount: session.artifactCount,
        tags: session.tags,
      });
    } catch (error) {
      problems.push({ path: sessionPath, message: errorMessage(error) });
    }
  }

  return {
    sessions: cards.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    problems,
  };
}

export async function scanSessionsRoot(rootPath: string): Promise<SessionCard[]> {
  return (await scanSessionsRootDetailed(rootPath)).sessions;
}

export async function loadSessionAtPath(sessionPath: string): Promise<LoadedSession> {
  requireTauri();
  const sessionFilePath = await join(sessionPath, SESSION_FILE_NAME);
  const commandsFilePath = await join(sessionPath, COMMANDS_FILE_NAME);
  const session = await readJsonFile(sessionFilePath, sessionSchema);
  const commands = (await exists(commandsFilePath))
    ? await readJsonFile(commandsFilePath, commandJournalSchema)
    : createCommandJournal(session.id);
  return { path: sessionPath, session, commands };
}

async function writeLoadedSessionFiles(sessionPath: string, loadedSession: LoadedSession): Promise<void> {
  const session = sessionSchema.parse(loadedSession.session);
  const commandsPath = await join(sessionPath, COMMANDS_FILE_NAME);
  let commands = commandJournalSchema.parse(loadedSession.commands);
  if (await exists(commandsPath)) {
    const persisted = await readJsonFile(commandsPath, commandJournalSchema);
    const byId = new Map([...persisted.commands, ...commands.commands].map((command) => [command.id, command]));
    const mergedCommands = [...byId.values()].sort(
      (left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    );
    commands = commandJournalSchema.parse({
      ...commands,
      createdAt: persisted.createdAt < commands.createdAt ? persisted.createdAt : commands.createdAt,
      updatedAt: mergedCommands.at(-1)?.createdAt ?? commands.updatedAt,
      commands: mergedCommands,
    });
  }
  await ensureSessionFolders(sessionPath, session);
  await writeJsonAtomic(await join(sessionPath, SESSION_FILE_NAME), session);
  await writeJsonAtomic(commandsPath, commands);
}

export async function saveLoadedSession(loadedSession: LoadedSession): Promise<void> {
  requireTauri();
  await enqueueStorageOperation(sessionSaveQueues, loadedSession.path, () => writeLoadedSessionFiles(loadedSession.path, loadedSession));
}

export async function appendSessionCommand(
  loadedSession: LoadedSession,
  draft: CommandDraft,
  session: GenostSession,
): Promise<LoadedSession> {
  const beforeHash = hashSession(loadedSession.session);
  const afterHash = hashSession(session);
  const updated: LoadedSession = {
    ...loadedSession,
    session,
    commands: appendCommand(loadedSession.commands, createCommandEntry(draft, beforeHash, afterHash)),
  };
  await saveLoadedSession(updated);
  return updated;
}

export async function allocateArtifactFile(
  sessionPath: string,
  artifactFolder: string,
  preferredName: string,
  fallbackExtension = ".wav",
): Promise<{ absolutePath: string; relativePath: string; fileName: string }> {
  requireTauri();
  const directoryPath = await join(sessionPath, artifactFolder);
  if (!(await exists(directoryPath))) await mkdir(directoryPath, { recursive: true });
  const target = await uniqueFilePath(directoryPath, safeFileName(preferredName, fallbackExtension));
  return {
    absolutePath: target.path,
    relativePath: relativeAssetPath(artifactFolder, target.name),
    fileName: target.name,
  };
}

export async function copyReferenceAudioToSession(
  sessionPath: string,
  sourcePath: string,
  artifactFolder: string,
): Promise<{ absolutePath: string; relativePath: string; fileName: string; sourcePath: string }> {
  requireTauri();
  const target = await allocateArtifactFile(sessionPath, artifactFolder, fileNameFromPath(sourcePath), ".wav");
  await copyFile(sourcePath, target.absolutePath);
  return { ...target, sourcePath };
}

export async function writeArtifactSidecar(artifactAbsolutePath: string, metadata: unknown): Promise<void> {
  requireTauri();
  await writeJsonAtomic(sidecarPathForFilePath(artifactAbsolutePath), metadata);
}

export async function writeSessionJobRecord(
  sessionPath: string,
  input: Omit<SessionJobRecord, "schemaVersion" | "createdAt" | "updatedAt">,
): Promise<SessionJobRecord> {
  requireTauri();
  return enqueueStorageOperation(sessionSaveQueues, sessionPath, async () => {
    const jobsPath = await join(sessionPath, JOBS_DIRECTORY);
    if (!(await exists(jobsPath))) await mkdir(jobsPath, { recursive: true });
    const safeJobId = input.jobId.replace(/[^A-Za-z0-9_-]/g, "_");
    const jobPath = await join(jobsPath, `${safeJobId}.json`);
    const now = new Date().toISOString();
    let createdAt = now;
    if (await exists(jobPath)) {
      createdAt = (await readJsonFile(jobPath, sessionJobRecordSchema)).createdAt;
    }
    const record = sessionJobRecordSchema.parse({
      ...input,
      schemaVersion: 1,
      createdAt,
      updatedAt: now,
    });
    await writeJsonAtomic(jobPath, record);
    return record;
  });
}

export async function sessionAssetExists(
  sessionPath: string,
  assetPath: string | null | undefined,
): Promise<boolean> {
  requireTauri();
  const resolved = resolveSessionAssetPath(sessionPath, assetPath);
  return Boolean(resolved && !isUriAssetPath(resolved) && (await exists(resolved)));
}

export async function exportArtifactToFolder(
  sessionPath: string,
  artifact: GenostArtifact,
  exportFolder: string,
): Promise<ExportedArtifact> {
  requireTauri();
  const sourcePath = resolveSessionAssetPath(sessionPath, artifact.filePath);
  if (!sourcePath || isUriAssetPath(sourcePath) || !(await exists(sourcePath))) {
    throw new Error(`Artifact is missing: ${artifact.filePath}`);
  }
  if (!(await exists(exportFolder))) await mkdir(exportFolder, { recursive: true });
  const preferredName = safeFileName(artifact.fileName, ".wav");
  const target = await uniqueFilePath(exportFolder, preferredName);
  await copyFile(sourcePath, target.path);
  return {
    artifact: {
      ...artifact,
      exportStatus: { exportedAt: new Date().toISOString(), exportPath: target.path, error: null },
      updatedAt: new Date().toISOString(),
    },
    exportPath: target.path,
    exportName: target.name,
  };
}

export async function updateWorkspaceModelSettings(rootPath: string, settings: ModelSettings): Promise<WorkspaceMetadata> {
  return updateWorkspaceMetadata(rootPath, (metadata) => ({
    ...metadata,
    modelSettings: settings,
  }));
}

export async function appendWorkspaceCommand(rootPath: string, draft: CommandDraft): Promise<CommandJournal> {
  requireTauri();
  return enqueueStorageOperation(workspaceSaveQueues, `${rootPath}:commands`, async () => {
    const journalPath = await join(rootPath, WORKSPACE_COMMANDS_FILE_NAME);
    const journal = (await exists(journalPath))
      ? await readJsonFile(journalPath, commandJournalSchema)
      : createCommandJournal("workspace");
    const updated = appendCommand(journal, createCommandEntry(draft));
    await writeJsonAtomic(journalPath, updated);
    return updated;
  });
}
