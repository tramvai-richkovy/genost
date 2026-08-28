import { join } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { copyFile, exists, mkdir, readDir, readTextFile, rename, stat, writeTextFile } from "@tauri-apps/plugin-fs";
import { Store } from "@tauri-apps/plugin-store";
import { isUriAssetPath, resolveProjectAssetPath } from "../audio/paths";
import {
  commandJournalSchema,
  genostProjectSchema,
  workspaceMetadataSchema,
  type CommandJournal,
  type GenostStem,
  type GenostProject,
  type WorkspaceMetadata,
} from "../schema/project";
import {
  appendCommand,
  COMMANDS_FILE_NAME,
  createCommandEntry,
  createCommandJournal,
  createEmptyProject,
  createWorkspaceMetadata,
  hashProject,
  mergeGenreReferences,
  PROJECT_DIRECTORIES,
  PROJECT_FILE_NAME,
  sanitizeProjectFolderName,
  WORKSPACE_FILE_NAME,
  type CommandDraft,
} from "./format";

const SETTINGS_FILE = "settings.json";
const PROJECTS_ROOT_KEY = "projectsRoot";
const PERMISSION_ERROR_PATTERN =
  /(permission|denied|not allowed|forbidden|scope|security-scoped|operation not permitted|os error 13)/i;
const projectSaveQueues = new Map<string, Promise<void>>();
const workspaceMetadataQueues = new Map<string, Promise<void>>();

export type ProjectCard = {
  title: string;
  path: string;
  updatedAt: string;
};

export type ProjectScanIssue = {
  kind: "invalid" | "unreadable";
  name: string;
  path: string;
  message: string;
};

export type ProjectScanResult = {
  projects: ProjectCard[];
  issues: ProjectScanIssue[];
};

export type LoadedProject = {
  path: string | null;
  project: GenostProject;
  commands: CommandJournal;
};

export type ReferenceTrackFile = {
  path: string;
  name: string;
};

export type ImportedStemFile = {
  path: string;
  name: string;
  sourcePath: string;
};

export type ArchivedStemAsset = {
  stemId: string;
  originalFilePath: string | null;
  archivePath: string | null;
  archiveFileName: string | null;
};

export async function archiveSeparationBundle(projectPath: string, bundleId: string): Promise<string> {
  requireTauri();
  const source = await join(projectPath, "STEMS", "SEPARATIONS", bundleId);
  if (!(await exists(source))) throw new Error(`Separation bundle is missing: ${source}`);
  const archiveRoot = await join(projectPath, "ARCHIVE");
  if (!(await exists(archiveRoot))) await mkdir(archiveRoot, { recursive: true });
  const archiveName = `SEPARATION_${bundleId}_${archiveTimestamp()}`;
  const destination = await join(archiveRoot, archiveName);
  if (await exists(destination)) throw new Error(`Separation archive already exists: ${destination}`);
  await rename(source, destination);
  return `ARCHIVE/${archiveName}`;
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isProjectStoragePermissionError(error: unknown): boolean {
  return PERMISSION_ERROR_PATTERN.test(errorMessage(error));
}

export function describeProjectStorageError(error: unknown, action: string, path?: string): string {
  const message = errorMessage(error);

  if (isProjectStoragePermissionError(error)) {
    const pathDetail = path ? ` for ${path}` : "";
    return `${action} failed because GENOST does not have filesystem permission${pathDetail}. Select the projects folder again, or move it under your home, Desktop, Documents, Downloads, or /Volumes. Raw error: ${message}`;
  }

  return `${action} failed: ${message}`;
}

function requireTauri(): void {
  if (!isTauriRuntime()) {
    throw new Error("Filesystem actions require the Tauri desktop runtime. Use npm run tauri:dev.");
  }
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
      if (queues.get(key) === trackedOperation) {
        queues.delete(key);
      }
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
  return parts.length > 0 ? parts[parts.length - 1] : "reference-track.mp3";
}

function splitFileName(fileName: string): { stem: string; extension: string } {
  const dotIndex = fileName.lastIndexOf(".");

  if (dotIndex <= 0) {
    return { stem: fileName, extension: "" };
  }

  return {
    stem: fileName.slice(0, dotIndex),
    extension: fileName.slice(dotIndex),
  };
}

function sidecarPathForFilePath(path: string): string {
  const dotIndex = path.lastIndexOf(".");
  return dotIndex > 0 ? `${path.slice(0, dotIndex)}.json` : `${path}.json`;
}

function safeAssetFileName(fileName: string, fallbackExtension: string): string {
  const { stem, extension } = splitFileName(fileName);
  const safeStem = stem
    .trim()
    .replace(/[^A-Za-z0-9 _-]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 72);

  return `${safeStem || "imported-stem"}${extension || fallbackExtension}`;
}

async function uniqueFilePath(directoryPath: string, preferredName: string): Promise<{ path: string; name: string }> {
  const { stem, extension } = splitFileName(preferredName);
  let name = preferredName;
  let path = await join(directoryPath, name);

  if (!(await exists(path))) {
    return { path, name };
  }

  for (let index = 2; index < 1000; index += 1) {
    name = `${stem}_${index}${extension}`;
    path = await join(directoryPath, name);

    if (!(await exists(path))) {
      return { path, name };
    }
  }

  name = `${stem}_${Date.now().toString(36)}${extension}`;
  return { path: await join(directoryPath, name), name };
}

function archiveTimestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

async function uniqueDetachedArchivePath(
  archiveDirectoryPath: string,
  sourceFilePath: string,
): Promise<{ path: string; name: string; relativePath: string }> {
  const sourceName = fileNameFromPath(sourceFilePath);
  const { stem, extension } = splitFileName(sourceName);
  const safeStem = safeAssetFileName(stem, "").replace(/\.[^.]+$/, "") || "stem";
  const timestamp = archiveTimestamp();
  let name = `DETACHED_${safeStem}_bulk_reset_${timestamp}${extension || ".wav"}`;
  let path = await join(archiveDirectoryPath, name);

  if (!(await exists(path)) && !(await exists(sidecarPathForFilePath(path)))) {
    return { path, name, relativePath: `ARCHIVE/${name}` };
  }

  for (let index = 2; index < 1000; index += 1) {
    name = `DETACHED_${safeStem}_bulk_reset_${timestamp}_${index}${extension || ".wav"}`;
    path = await join(archiveDirectoryPath, name);

    if (!(await exists(path)) && !(await exists(sidecarPathForFilePath(path)))) {
      return { path, name, relativePath: `ARCHIVE/${name}` };
    }
  }

  throw new Error(`Could not allocate a detached archive path for ${sourceName}`);
}

export async function selectProjectsFolder(): Promise<string | null> {
  requireTauri();
  const selected = await open({
    canCreateDirectories: true,
    directory: true,
    fileAccessMode: "scoped",
    multiple: false,
    recursive: true,
    title: "Select GENOST projects folder",
  });

  return typeof selected === "string" ? selected : null;
}

export async function selectReferenceTrackFile(): Promise<ReferenceTrackFile | null> {
  requireTauri();
  const selected = await open({
    directory: false,
    multiple: false,
    title: "Select reference track MP3",
    fileAccessMode: "scoped",
    filters: [
      {
        name: "MP3 reference track",
        extensions: ["mp3"],
      },
    ],
  });

  return typeof selected === "string" ? { path: selected, name: fileNameFromPath(selected) } : null;
}

export async function selectImportedStemFile(): Promise<ReferenceTrackFile | null> {
  requireTauri();
  const selected = await open({
    directory: false,
    multiple: false,
    title: "Import stem as block",
    fileAccessMode: "scoped",
    filters: [
      {
        name: "Audio stem",
        extensions: ["wav", "mp3", "aif", "aiff", "flac", "m4a", "ogg"],
      },
    ],
  });

  return typeof selected === "string" ? { path: selected, name: fileNameFromPath(selected) } : null;
}

export async function rememberProjectsRoot(projectsRoot: string): Promise<void> {
  requireTauri();
  const store = await Store.load(SETTINGS_FILE, { autoSave: true });
  await store.set(PROJECTS_ROOT_KEY, projectsRoot);
  await store.save();
}

export async function getRememberedProjectsRoot(): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  const store = await Store.load(SETTINGS_FILE, { autoSave: true });
  return (await store.get<string>(PROJECTS_ROOT_KEY)) ?? null;
}

export async function loadWorkspaceMetadata(projectsRoot: string): Promise<WorkspaceMetadata> {
  requireTauri();
  const workspaceFilePath = await join(projectsRoot, WORKSPACE_FILE_NAME);

  if (!(await exists(workspaceFilePath))) {
    return createWorkspaceMetadata();
  }

  return readJsonFile(workspaceFilePath, workspaceMetadataSchema);
}

export async function mergeWorkspaceGenreReferences(projectsRoot: string, genreReferences: string[]): Promise<WorkspaceMetadata> {
  return enqueueStorageOperation(workspaceMetadataQueues, projectsRoot, async () => {
    const existing = await loadWorkspaceMetadata(projectsRoot);
    const updated = {
      ...existing,
      updatedAt: new Date().toISOString(),
      genreReferences: mergeGenreReferences(existing.genreReferences, genreReferences),
    };
    const workspaceFilePath = await join(projectsRoot, WORKSPACE_FILE_NAME);

    await writeJsonAtomic(workspaceFilePath, updated);
    return updated;
  });
}

export async function ensureProjectFolders(projectPath: string): Promise<void> {
  for (const directory of PROJECT_DIRECTORIES) {
    const directoryPath = await join(projectPath, directory);
    if (!(await exists(directoryPath))) {
      await mkdir(directoryPath, { recursive: true });
    }
  }
}

export async function copyReferenceTrackToProject(projectPath: string, sourcePath: string): Promise<ReferenceTrackFile> {
  requireTauri();
  const referencesPath = await join(projectPath, "REFERENCES");

  if (!(await exists(referencesPath))) {
    await mkdir(referencesPath, { recursive: true });
  }

  const sourceName = fileNameFromPath(sourcePath);
  const { stem, extension } = splitFileName(sourceName);
  let targetName = sourceName;
  let targetPath = await join(referencesPath, targetName);

  if (await exists(targetPath)) {
    targetName = `${stem}_${Date.now().toString(36)}${extension || ".mp3"}`;
    targetPath = await join(referencesPath, targetName);
  }

  await copyFile(sourcePath, targetPath);
  return { path: targetPath, name: targetName };
}

export async function copyImportedStemToProject(projectPath: string, sourcePath: string): Promise<ImportedStemFile> {
  requireTauri();
  const stemsPath = await join(projectPath, "STEMS");

  if (!(await exists(stemsPath))) {
    await mkdir(stemsPath, { recursive: true });
  }

  const sourceName = fileNameFromPath(sourcePath);
  const safeName = safeAssetFileName(sourceName, ".wav");
  const target = await uniqueFilePath(stemsPath, safeName);

  await copyFile(sourcePath, target.path);
  return { ...target, sourcePath };
}

export async function writeStemSidecar(stemFilePath: string, metadata: unknown): Promise<void> {
  requireTauri();
  await writeJsonAtomic(sidecarPathForFilePath(stemFilePath), metadata);
}

export async function archiveDetachedStemAssets(
  projectPath: string,
  stems: Array<Pick<GenostStem, "id" | "filePath" | "fileName">>,
): Promise<ArchivedStemAsset[]> {
  requireTauri();
  const archivePath = await join(projectPath, "ARCHIVE");

  if (!(await exists(archivePath))) {
    await mkdir(archivePath, { recursive: true });
  }

  const archived: ArchivedStemAsset[] = [];

  for (const stem of stems) {
    const sourcePath = resolveProjectAssetPath(projectPath, stem.filePath);

    if (!sourcePath || isUriAssetPath(sourcePath) || !(await exists(sourcePath))) {
      archived.push({
        stemId: stem.id,
        originalFilePath: stem.filePath,
        archivePath: null,
        archiveFileName: null,
      });
      continue;
    }

    const target = await uniqueDetachedArchivePath(archivePath, sourcePath);
    await rename(sourcePath, target.path);

    const sourceSidecarPath = sidecarPathForFilePath(sourcePath);
    const targetSidecarPath = sidecarPathForFilePath(target.path);

    if (await exists(sourceSidecarPath)) {
      await rename(sourceSidecarPath, targetSidecarPath);
    }

    archived.push({
      stemId: stem.id,
      originalFilePath: stem.filePath,
      archivePath: target.relativePath,
      archiveFileName: target.name,
    });
  }

  return archived;
}

export async function scanProjectsRoot(projectsRoot: string): Promise<ProjectScanResult> {
  requireTauri();
  const entries = await readDir(projectsRoot);
  const cards: ProjectCard[] = [];
  const issues: ProjectScanIssue[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory) {
      continue;
    }

    const projectPath = await join(projectsRoot, entry.name);
    const projectFilePath = await join(projectPath, PROJECT_FILE_NAME);

    try {
      if (!(await exists(projectFilePath))) {
        continue;
      }

      const project = await readJsonFile(projectFilePath, genostProjectSchema);
      const info = await stat(projectFilePath);
      cards.push({
        title: project.title,
        path: projectPath,
        updatedAt: info.mtime?.toISOString() ?? project.updatedAt,
      });
    } catch (error) {
      issues.push({
        kind: isProjectStoragePermissionError(error) ? "unreadable" : "invalid",
        name: entry.name,
        path: projectPath,
        message: errorMessage(error),
      });
    }
  }

  return {
    projects: cards.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    issues,
  };
}

export async function loadProjectAtPath(projectPath: string): Promise<LoadedProject> {
  requireTauri();
  const projectFilePath = await join(projectPath, PROJECT_FILE_NAME);
  const commandsFilePath = await join(projectPath, COMMANDS_FILE_NAME);
  const project = await readJsonFile(projectFilePath, genostProjectSchema);
  const commands = (await exists(commandsFilePath))
    ? await readJsonFile(commandsFilePath, commandJournalSchema)
    : createCommandJournal(project.id);

  return { path: projectPath, project, commands };
}

async function writeLoadedProjectFiles(projectPath: string, loadedProject: LoadedProject): Promise<void> {
  const projectFilePath = await join(projectPath, PROJECT_FILE_NAME);
  const commandsFilePath = await join(projectPath, COMMANDS_FILE_NAME);
  await writeJsonAtomic(projectFilePath, loadedProject.project);
  await writeJsonAtomic(commandsFilePath, loadedProject.commands);
}

export async function saveLoadedProject(loadedProject: LoadedProject): Promise<void> {
  requireTauri();

  if (!loadedProject.path) {
    throw new Error("Cannot save a project without a project path.");
  }

  const projectPath = loadedProject.path;

  await enqueueStorageOperation(projectSaveQueues, projectPath, () => writeLoadedProjectFiles(projectPath, loadedProject));
}

export async function createProjectOnDisk(projectsRoot: string, title: string): Promise<LoadedProject> {
  requireTauri();
  const project = createEmptyProject(title);
  const projectPath = await join(projectsRoot, sanitizeProjectFolderName(project.title));

  if (await exists(projectPath)) {
    throw new Error(`Project folder already exists: ${projectPath}`);
  }

  await mkdir(projectPath, { recursive: true });
  await ensureProjectFolders(projectPath);

  const command = createCommandEntry(
    {
      type: "create_project",
      summary: `Created project ${project.title}`,
      payload: {
        title: project.title,
        projectPath,
        projectFile: PROJECT_FILE_NAME,
        commandJournal: COMMANDS_FILE_NAME,
      },
    },
    undefined,
    hashProject(project),
  );
  const commands = createCommandJournal(project.id, command);
  const loadedProject = { path: projectPath, project, commands };

  await saveLoadedProject(loadedProject);
  return loadedProject;
}

export async function appendProjectCommand(
  loadedProject: LoadedProject,
  draft: CommandDraft,
  project: GenostProject,
): Promise<LoadedProject> {
  const beforeHash = hashProject(loadedProject.project);
  const afterHash = hashProject(project);
  const command = createCommandEntry(draft, beforeHash, afterHash);
  const updated: LoadedProject = {
    ...loadedProject,
    project,
    commands: appendCommand(loadedProject.commands, command),
  };

  if (updated.path) {
    await saveLoadedProject(updated);
  }

  return updated;
}
