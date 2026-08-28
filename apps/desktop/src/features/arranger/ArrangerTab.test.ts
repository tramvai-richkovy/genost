import { describe, expect, it } from "vitest";
import { createEmptyProject } from "../../lib/project/format";
import {
  getClonePlacement,
  getNextUnassignedVariation,
  getNextTimelineBarWidth,
  getResizedClipGeometry,
  getSnappedStartBarFromLocalX,
  getSplitPlan,
} from "./ArrangerTab";

describe("arranger drag snapping", () => {
  it("preserves the grab offset when moving an existing clip", () => {
    expect(getSnappedStartBarFromLocalX(44 * 8, 0)).toBe(8);
    expect(getSnappedStartBarFromLocalX(44 * 8, 2.5)).toBe(6);
  });

  it("clamps drops before the timeline start", () => {
    expect(getSnappedStartBarFromLocalX(10, 4)).toBe(0);
  });

  it("supports alternate timeline zoom widths while snapping", () => {
    expect(getSnappedStartBarFromLocalX(96 * 5, 0, 96)).toBe(5);
  });
});

describe("arranger clip resizing", () => {
  it("resizes the right edge in whole bars", () => {
    expect(getResizedClipGeometry({ edge: "right", originalStartBar: 4, originalBars: 4, deltaBars: 1 })).toEqual({
      startBar: 4,
      bars: 5,
    });
  });

  it("resizes the left edge without crossing the clip end", () => {
    expect(getResizedClipGeometry({ edge: "left", originalStartBar: 8, originalBars: 4, deltaBars: 2 })).toEqual({
      startBar: 10,
      bars: 2,
    });
    expect(getResizedClipGeometry({ edge: "left", originalStartBar: 8, originalBars: 4, deltaBars: 10 })).toEqual({
      startBar: 11,
      bars: 1,
    });
  });

  it("prevents left-edge resizing before bar zero", () => {
    expect(getResizedClipGeometry({ edge: "left", originalStartBar: 2, originalBars: 4, deltaBars: -10 })).toEqual({
      startBar: 0,
      bars: 6,
    });
  });
});

describe("arranger clip actions", () => {
  it("places a clone directly after a clip when the lane has space", () => {
    const project = createEmptyProject("Clone Placement Test");
    const lane = project.arrangement.lanes[0];
    const clip = lane.clips[0];

    expect(getClonePlacement(project, lane.id, clip.id)).toEqual({ laneId: lane.id, startBar: 16 });
  });

  it("moves a clone to a new lane when the direct slot is occupied", () => {
    const project = createEmptyProject("Clone New Lane Test");
    const lane = project.arrangement.lanes[0];
    const clip = lane.clips[0];
    const occupiedProject = {
      ...project,
      arrangement: {
        lanes: [
          {
            ...lane,
            clips: [
              clip,
              {
                ...clip,
                id: "clip_occupied",
                startBar: 16,
              },
            ],
          },
        ],
      },
    };

    expect(getClonePlacement(occupiedProject, lane.id, clip.id)).toEqual({ laneId: null, startBar: 16 });
  });

  it("uses the next unassigned variation for uneven splits", () => {
    expect(getNextUnassignedVariation([1, 2, 4], 1)).toBe(3);
    expect(getSplitPlan({ bars: 9, currentVariation: 1, usedVariations: [1] })).toEqual({
      firstBars: 4,
      secondBars: 5,
      secondVariation: 2,
    });
  });

  it("keeps the current variation for even splits", () => {
    expect(getSplitPlan({ bars: 8, currentVariation: 3, usedVariations: [1, 2, 3] })).toEqual({
      firstBars: 4,
      secondBars: 4,
      secondVariation: 3,
    });
  });

  it("does not split one-bar clips or uneven clips without a free variation", () => {
    expect(getSplitPlan({ bars: 1, currentVariation: 1, usedVariations: [1] })).toBeNull();
    expect(
      getSplitPlan({
        bars: 9,
        currentVariation: 1,
        usedVariations: Array.from({ length: 16 }, (_, index) => index + 1),
      }),
    ).toBeNull();
  });
});

describe("arranger timeline zoom", () => {
  it("steps and clamps timeline bar width", () => {
    expect(getNextTimelineBarWidth(44, "in")).toBe(60);
    expect(getNextTimelineBarWidth(44, "out")).toBe(32);
    expect(getNextTimelineBarWidth(240, "in")).toBe(240);
    expect(getNextTimelineBarWidth(32, "out")).toBe(32);
  });
});
