import { describe, expect, it } from "vitest";
import { barsToSeconds, createEmptyProject } from "./format";
import {
  collectRequirements,
  getRequirementRenderState,
  queueComponentRequirement,
} from "./requirements";
import type { GenostBlock, GenostProject, GenostStem } from "../schema/project";

function makeStem(patch: Partial<GenostStem> & Pick<GenostStem, "id" | "blockId" | "variation">): GenostStem {
  return {
    inputStemId: null,
    model: "facebook/musicgen-medium",
    promptHash: "hash",
    seed: 1,
    durationSeconds: 22,
    status: "ready",
    queueOrder: null,
    fileName: `${patch.id}.wav`,
    filePath: `STEMS/${patch.id}.wav`,
    archivePath: null,
    revisionOfStemId: null,
    staleReason: null,
    error: null,
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
    ...patch,
  };
}

describe("shared render requirements", () => {
  it("reuses identical clip requirements while keeping variations distinct", () => {
    const baseProject = createEmptyProject("Requirement Identity");
    const block: GenostBlock = { ...baseProject.blocks[0], id: "block_pad", name: "Pad", bars: 8 };
    const project: GenostProject = {
      ...baseProject,
      blocks: [block],
      arrangement: {
        lanes: [
          {
            id: "lane_1",
            name: "Layer 1",
            clips: [
              {
                id: "clip_v1_a",
                blockId: block.id,
                variation: 1,
                startBar: 0,
                bars: 8,
                inputBlockId: null,
                inputStemId: null,
                stemId: null,
              },
              {
                id: "clip_v1_b",
                blockId: block.id,
                variation: 1,
                startBar: 8,
                bars: 8,
                inputBlockId: null,
                inputStemId: null,
                stemId: null,
              },
              {
                id: "clip_v2",
                blockId: block.id,
                variation: 2,
                startBar: 16,
                bars: 8,
                inputBlockId: null,
                inputStemId: null,
                stemId: null,
              },
            ],
          },
        ],
      },
      stems: [],
    };

    const requirements = collectRequirements(project);
    const v1 = requirements.find((requirement) => requirement.variation === 1);
    const v2 = requirements.find((requirement) => requirement.variation === 2);

    expect(requirements).toHaveLength(2);
    expect(v1?.clips.map((clip) => clip.id)).toEqual(["clip_v1_a", "clip_v1_b"]);
    expect(v2?.clips.map((clip) => clip.id)).toEqual(["clip_v2"]);
    expect(v1?.key).not.toBe(v2?.key);
  });

  it("queues a missing variation 1 anchor before a later variation", () => {
    const baseProject = createEmptyProject("Anchor Queue");
    const block: GenostBlock = { ...baseProject.blocks[0], id: "block_atmosphere", name: "Atmosphere", bars: 8 };
    const project: GenostProject = {
      ...baseProject,
      blocks: [block],
      arrangement: {
        lanes: [
          {
            id: "lane_1",
            name: "Layer 1",
            clips: [
              {
                id: "clip_v3",
                blockId: block.id,
                variation: 3,
                startBar: 0,
                bars: 8,
                inputBlockId: null,
                inputStemId: null,
                stemId: null,
              },
            ],
          },
        ],
      },
      stems: [],
    };

    const queued = queueComponentRequirement(project, collectRequirements(project)[0]);
    const anchor = queued.stems.find((stem) => stem.variation === 1);
    const variation = queued.stems.find((stem) => stem.variation === 3);
    const clip = queued.arrangement.lanes[0].clips[0];

    expect(anchor).toMatchObject({ status: "queued", queueOrder: 1, inputStemId: null });
    expect(variation).toMatchObject({ status: "queued", queueOrder: 2, inputStemId: anchor?.id });
    expect(variation?.model).toBe(queued.song.defaultMelodyModel);
    expect(clip).toMatchObject({ stemId: variation?.id, inputStemId: anchor?.id });
  });

  it("marks regenerated stems superseded and downstream conditioned stems stale", () => {
    const baseProject = createEmptyProject("Regenerate Dependency");
    const padBlock: GenostBlock = { ...baseProject.blocks[0], id: "block_pad", name: "Pad", bars: 8 };
    const bassBlock: GenostBlock = {
      ...baseProject.blocks[0],
      id: "block_bass",
      name: "Bass",
      bars: 8,
      instruments: ["sub bass"],
    };
    const padStem = makeStem({ id: "stem_pad", blockId: padBlock.id, variation: 1 });
    const bassStem = makeStem({
      id: "stem_bass",
      blockId: bassBlock.id,
      variation: 1,
      inputStemId: padStem.id,
    });
    const project: GenostProject = {
      ...baseProject,
      blocks: [padBlock, bassBlock],
      arrangement: {
        lanes: [
          {
            id: "lane_1",
            name: "Layer 1",
            clips: [
              {
                id: "clip_pad",
                blockId: padBlock.id,
                variation: 1,
                startBar: 0,
                bars: 8,
                inputBlockId: null,
                inputStemId: null,
                stemId: padStem.id,
              },
              {
                id: "clip_bass",
                blockId: bassBlock.id,
                variation: 1,
                startBar: 8,
                bars: 8,
                inputBlockId: padBlock.id,
                inputStemId: padStem.id,
                stemId: bassStem.id,
              },
            ],
          },
        ],
      },
      stems: [padStem, bassStem],
    };

    const padRequirement = collectRequirements(project).find((requirement) => requirement.block.id === padBlock.id);
    const updated = queueComponentRequirement(project, padRequirement!, true);

    expect(updated.stems.find((stem) => stem.id === padStem.id)?.status).toBe("superseded");
    expect(updated.stems.find((stem) => stem.id === bassStem.id)).toMatchObject({
      status: "stale",
      queueOrder: null,
    });
  });

  it("exposes validation failures as a dense requirement state", () => {
    const baseProject = createEmptyProject("Validation State");
    const block: GenostBlock = { ...baseProject.blocks[0], id: "block_pad", name: "Pad", bars: 8 };
    const failedStem = makeStem({
      id: "stem_failed",
      blockId: block.id,
      variation: 1,
      durationSeconds: barsToSeconds(8, baseProject.song.bpm, baseProject.song.timeSignature[0]),
      status: "failed",
      filePath: null,
      error: "Generated audio failed music validation: silent output",
    });
    const project: GenostProject = {
      ...baseProject,
      blocks: [block],
      arrangement: {
        lanes: [
          {
            id: "lane_1",
            name: "Layer 1",
            clips: [
              {
                id: "clip_pad",
                blockId: block.id,
                variation: 1,
                startBar: 0,
                bars: 8,
                inputBlockId: null,
                inputStemId: null,
                stemId: failedStem.id,
              },
            ],
          },
        ],
      },
      stems: [failedStem],
    };

    expect(getRequirementRenderState({ requirement: collectRequirements(project)[0] })).toBe("validation-failed");
  });
});
