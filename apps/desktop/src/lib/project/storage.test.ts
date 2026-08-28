import { describe, expect, it } from "vitest";
import {
  createAtomicJsonTempPath,
  describeProjectStorageError,
  enqueueStorageOperation,
  isProjectStoragePermissionError,
} from "./storage";

describe("project storage errors", () => {
  it("turns Tauri scope denials into actionable permission messages", () => {
    const error = new Error("path not allowed on the configured scope: /mnt/music");

    expect(isProjectStoragePermissionError(error)).toBe(true);
    expect(describeProjectStorageError(error, "Creating project", "/mnt/music")).toContain(
      "Creating project failed because GENOST does not have filesystem permission for /mnt/music.",
    );
    expect(describeProjectStorageError(error, "Creating project", "/mnt/music")).toContain(
      "Select the projects folder again",
    );
  });

  it("preserves non-permission failures as action-scoped errors", () => {
    expect(describeProjectStorageError(new Error("Project folder already exists"), "Creating project")).toBe(
      "Creating project failed: Project folder already exists",
    );
  });

  it("uses per-write atomic JSON temp paths instead of one shared tmp file", () => {
    expect(createAtomicJsonTempPath("/tmp/genost.json", "save_a")).toBe("/tmp/genost.json.save_a.tmp");
    expect(createAtomicJsonTempPath("/tmp/genost.json", "save_b")).toBe("/tmp/genost.json.save_b.tmp");
    expect(createAtomicJsonTempPath("/tmp/genost.json", "save_a")).not.toBe("/tmp/genost.json.tmp");
  });

  it("serializes queued storage operations and continues after failures", async () => {
    const queues = new Map<string, Promise<void>>();
    const events: string[] = [];
    let resolveFirstStarted: () => void = () => undefined;
    const firstStarted = new Promise<void>((resolve) => {
      resolveFirstStarted = resolve;
    });
    let releaseFirstOperation: () => void = () => undefined;

    const firstOperation = enqueueStorageOperation(queues, "project-a", async () => {
      events.push("first:start");
      resolveFirstStarted();
      await new Promise<void>((resolve) => {
        releaseFirstOperation = resolve;
      });
      events.push("first:end");
      throw new Error("first failed");
    });

    const secondOperation = enqueueStorageOperation(queues, "project-a", async () => {
      events.push("second:start");
      return "second saved";
    });

    await firstStarted;
    expect(events).toEqual(["first:start"]);

    releaseFirstOperation();

    await expect(firstOperation).rejects.toThrow("first failed");
    await expect(secondOperation).resolves.toBe("second saved");
    expect(events).toEqual(["first:start", "first:end", "second:start"]);
    expect(queues.has("project-a")).toBe(false);
  });
});
