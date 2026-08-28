import { describe, expect, it } from "vitest";
import { getComponentStatusLabel, getRenderBlockReason } from "./renderQueueState";

describe("render queue state", () => {
  it("blocks render actions when the session is in offline planning mode", () => {
    expect(getRenderBlockReason({ musicAiMode: "offline", compositionIssues: [], hasGraphCycle: false })).toBe(
      "offline",
    );
  });

  it("keeps unrendered conditioned blocks planned while offline", () => {
    expect(getComponentStatusLabel({ renderBlockReason: "offline", requirementState: "input-missing" })).toBe("planned");
  });

  it("reports missing render inputs in online mode", () => {
    expect(getComponentStatusLabel({ renderBlockReason: null, requirementState: "input-missing" })).toBe("input missing");
  });

  it("reports over-length components before render actions", () => {
    expect(
      getComponentStatusLabel({
        renderBlockReason: null,
        requirementState: "duration-blocked",
      }),
    ).toBe("duration blocked");
  });

  it("reports validation failures distinctly from generic failures", () => {
    expect(getComponentStatusLabel({ renderBlockReason: null, requirementState: "validation-failed" })).toBe(
      "validation failed",
    );
  });
});
