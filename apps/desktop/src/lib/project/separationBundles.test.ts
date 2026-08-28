import { describe, expect, it } from "vitest";
import type { SeparationBundle } from "../schema/project";
import { visibleSeparationBundles } from "./separationBundles";

function bundle(
  id: string,
  sourceStemId: string,
  status: SeparationBundle["status"],
  createdAt: string,
): SeparationBundle {
  return {
    id,
    blockId: "block",
    sourceStemId,
    rawStemPath: `STEMS/${sourceStemId}.wav`,
    model: "htdemucs_6s.yaml",
    preferredTarget: "other",
    status,
    selectedOutputIds: [],
    outputs: [],
    merges: [],
    previewMetadata: {},
    errorCode: status === "failed" ? "separator_output_invalid" : null,
    error: status === "failed" ? "old failure" : null,
    createdAt,
    updatedAt: createdAt,
  };
}

describe("visible separation bundles", () => {
  it("hides failed attempts superseded by a ready bundle for the same source", () => {
    const oldFailure = bundle("failed-old", "stem-a", "failed", "2026-08-27T10:00:00Z");
    const ready = bundle("ready", "stem-a", "ready", "2026-08-27T11:00:00Z");

    expect(visibleSeparationBundles([oldFailure, ready]).map((item) => item.id)).toEqual(["ready"]);
  });

  it("keeps current failures and bundles for other source revisions", () => {
    const oldReady = bundle("ready-old", "stem-a", "ready", "2026-08-27T10:00:00Z");
    const currentFailure = bundle("failed-current", "stem-a", "failed", "2026-08-27T11:00:00Z");
    const otherSourceFailure = bundle("failed-other", "stem-b", "failed", "2026-08-27T09:00:00Z");

    expect(visibleSeparationBundles([oldReady, currentFailure, otherSourceFailure]).map((item) => item.id)).toEqual([
      "ready-old",
      "failed-current",
      "failed-other",
    ]);
  });

  it("hides explicitly archived bundles", () => {
    expect(visibleSeparationBundles([bundle("archived", "stem-a", "archived", "2026-08-27T10:00:00Z")])).toEqual([]);
  });
});
