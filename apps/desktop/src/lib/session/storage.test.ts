import { describe, expect, it } from "vitest";
import {
  createAtomicJsonTempPath,
  describeSessionStorageError,
  enqueueStorageOperation,
  isSessionStoragePermissionError,
  resolveSessionAssetPath,
} from "./storage";

describe("session storage helpers", () => {
  it("resolves relative artifact paths from the session folder", () => {
    expect(resolveSessionAssetPath("/Users/me/GENOST/se-260828-1", "artifacts/artifact1.wav")).toBe(
      "/Users/me/GENOST/se-260828-1/artifacts/artifact1.wav",
    );
    expect(resolveSessionAssetPath("/Users/me/GENOST/se-260828-1", "/tmp/artifact1.wav")).toBe("/tmp/artifact1.wav");
    expect(resolveSessionAssetPath(null, "artifacts/artifact1.wav")).toBeNull();
  });

  it("turns Tauri scope denials into working-directory guidance", () => {
    const error = new Error("path not allowed on the configured scope: /mnt/music");

    expect(isSessionStoragePermissionError(error)).toBe(true);
    expect(describeSessionStorageError(error, "Creating session", "/mnt/music")).toContain(
      "Creating session failed because GENOST does not have filesystem permission for /mnt/music.",
    );
  });

  it("uses per-write atomic JSON temp paths", () => {
    expect(createAtomicJsonTempPath("/tmp/session.json", "save_a")).toBe("/tmp/session.json.save_a.tmp");
    expect(createAtomicJsonTempPath("/tmp/session.json", "save_b")).toBe("/tmp/session.json.save_b.tmp");
  });

  it("serializes queued storage operations and keeps the queue usable after failure", async () => {
    const queues = new Map<string, Promise<void>>();
    const events: string[] = [];
    let resolveFirstStarted: () => void = () => undefined;
    const firstStarted = new Promise<void>((resolve) => {
      resolveFirstStarted = resolve;
    });
    let releaseFirstOperation: () => void = () => undefined;

    const first = enqueueStorageOperation(queues, "session-a", async () => {
      events.push("first:start");
      resolveFirstStarted();
      await new Promise<void>((release) => {
        releaseFirstOperation = release;
      });
      events.push("first:end");
      throw new Error("first failed");
    });

    const second = enqueueStorageOperation(queues, "session-a", async () => {
      events.push("second:start");
      return "saved";
    });

    await firstStarted;
    expect(events).toEqual(["first:start"]);
    releaseFirstOperation();

    await expect(first).rejects.toThrow("first failed");
    await expect(second).resolves.toBe("saved");
    expect(events).toEqual(["first:start", "first:end", "second:start"]);
    expect(queues.has("session-a")).toBe(false);
  });
});
