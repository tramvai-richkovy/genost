// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptySession } from "./format";

const mocks = vi.hoisted(() => ({
  files: new Map<string, string>(),
  directories: new Set<string>(),
  copied: [] as Array<[string, string]>,
}));

vi.mock("@tauri-apps/api/path", () => ({
  join: (...parts: string[]) => Promise.resolve(parts.join("/").replace(/\/+/g, "/")),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-store", () => ({
  Store: { load: vi.fn() },
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  copyFile: (source: string, destination: string) => {
    mocks.copied.push([source, destination]);
    mocks.files.set(destination, mocks.files.get(source) ?? "audio");
    return Promise.resolve();
  },
  exists: (path: string) => Promise.resolve(mocks.files.has(path) || mocks.directories.has(path)),
  mkdir: (path: string) => {
    mocks.directories.add(path);
    return Promise.resolve();
  },
  readDir: (path: string) =>
    Promise.resolve(
      [...mocks.directories]
        .filter((candidate) => candidate.startsWith(`${path}/`) && !candidate.slice(path.length + 1).includes("/"))
        .map((candidate) => ({ name: candidate.slice(path.length + 1), isDirectory: true })),
    ),
  readTextFile: (path: string) => Promise.resolve(mocks.files.get(path) ?? ""),
  rename: (source: string, destination: string) => {
    const contents = mocks.files.get(source);
    if (contents !== undefined) mocks.files.set(destination, contents);
    mocks.files.delete(source);
    return Promise.resolve();
  },
  stat: () => Promise.resolve({ mtime: new Date("2026-08-29T00:00:00Z") }),
  writeTextFile: (path: string, contents: string) => {
    mocks.files.set(path, contents);
    return Promise.resolve();
  },
}));

import {
  copyReferenceAudioToSession,
  ensureSessionFolders,
  scanSessionsRootDetailed,
  writeSessionJobRecord,
} from "./storage";

describe("session storage integration", () => {
  beforeEach(() => {
    mocks.files.clear();
    mocks.directories.clear();
    mocks.copied.length = 0;
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
  });

  it("keeps valid sessions when a sibling session is malformed", async () => {
    const root = "/workspace";
    mocks.directories.add(root);
    mocks.directories.add(`${root}/valid`);
    mocks.directories.add(`${root}/broken`);
    const session = createEmptySession({ type: "free_format", name: "valid" });
    mocks.files.set(`${root}/valid/session.json`, JSON.stringify(session));
    mocks.files.set(`${root}/broken/session.json`, "{");

    const result = await scanSessionsRootDetailed(root);

    expect(result.sessions.map((card) => card.name)).toEqual(["valid"]);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0].path).toBe(`${root}/broken`);
  });

  it("copies imported reference audio to a collision-safe session path", async () => {
    const sessionPath = "/workspace/session";
    mocks.directories.add(sessionPath);
    mocks.directories.add(`${sessionPath}/artifacts`);
    mocks.files.set("/outside/reference.wav", "audio");
    mocks.files.set(`${sessionPath}/artifacts/reference.wav`, "older audio");

    const copied = await copyReferenceAudioToSession(
      sessionPath,
      "/outside/reference.wav",
      "artifacts",
    );

    expect(copied.relativePath).toBe("artifacts/reference_2.wav");
    expect(mocks.copied).toEqual([
      ["/outside/reference.wav", `${sessionPath}/artifacts/reference_2.wav`],
    ]);
  });

  it("creates the stable session folders and updates a validated job record", async () => {
    const sessionPath = "/workspace/session";
    const session = createEmptySession({ type: "free_format", name: "session" });
    mocks.directories.add(sessionPath);

    await ensureSessionFolders(sessionPath, session);
    await writeSessionJobRecord(sessionPath, {
      jobId: "job:artifact/1",
      operation: "musicgen",
      status: "queued",
      artifactIds: ["artifact-1"],
      request: { seed: 42 },
      result: null,
      error: null,
    });
    const first = JSON.parse(mocks.files.get(`${sessionPath}/jobs/job_artifact_1.json`) ?? "null");
    await writeSessionJobRecord(sessionPath, {
      jobId: "job:artifact/1",
      operation: "musicgen",
      status: "complete",
      artifactIds: ["artifact-1"],
      request: { seed: 42 },
      result: { outputPath: "archive-1/result.wav" },
      error: null,
    });
    const complete = JSON.parse(mocks.files.get(`${sessionPath}/jobs/job_artifact_1.json`) ?? "null");

    expect(mocks.directories.has(`${sessionPath}/artifacts`)).toBe(true);
    expect(mocks.directories.has(`${sessionPath}/archive-1`)).toBe(true);
    expect(mocks.directories.has(`${sessionPath}/jobs`)).toBe(true);
    expect(first.status).toBe("queued");
    expect(complete.status).toBe("complete");
    expect(complete.createdAt).toBe(first.createdAt);
    expect(complete.result.outputPath).toBe("archive-1/result.wav");
  });
});
