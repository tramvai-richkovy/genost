import { describe, expect, it } from "vitest";
import { barsToSeconds, createEmptyProject } from "../../lib/project/format";
import { collectRequirements } from "../../lib/project/requirements";
import type { GenostBlock, GenostProject, GenostStem } from "../../lib/schema/project";
import { detachLiveGeneratedStems, getLiveGeneratedStems } from "./RenderQueueTab";

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

describe("render queue requirement collection", () => {
  it("uses pinned clip input and stem ids before falling back to latest ready stems", () => {
    const baseProject = createEmptyProject("Pinned Stem Test");
    const padBlock: GenostBlock = { ...baseProject.blocks[0], id: "block_pad", name: "Pad", bars: 8 };
    const bassBlock: GenostBlock = {
      ...baseProject.blocks[0],
      id: "block_bass",
      name: "Bass",
      bars: 8,
      role: "sub bass support",
      instruments: ["sine bass"],
    };
    const padV1 = makeStem({
      id: "stem_pad_v1",
      blockId: padBlock.id,
      variation: 1,
      updatedAt: "2026-08-26T00:00:00.000Z",
    });
    const padV2 = makeStem({
      id: "stem_pad_v2",
      blockId: padBlock.id,
      variation: 2,
      updatedAt: "2026-08-26T01:00:00.000Z",
    });
    const bassStem = makeStem({
      id: "stem_bass",
      blockId: bassBlock.id,
      variation: 1,
      inputStemId: padV1.id,
      durationSeconds: 99,
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
                id: "clip_bass",
                blockId: bassBlock.id,
                variation: 1,
                startBar: 0,
                bars: 8,
                inputBlockId: padBlock.id,
                inputStemId: padV1.id,
                stemId: bassStem.id,
              },
            ],
          },
        ],
      },
      stems: [padV1, padV2, bassStem],
    };

    const bassRequirement = collectRequirements(project).find((requirement) => requirement.block.id === bassBlock.id);

    expect(bassRequirement?.inputStemId).toBe(padV1.id);
    expect(bassRequirement?.inputMissing).toBe(false);
    expect(bassRequirement?.existingStem?.id).toBe(bassStem.id);
  });

  it("plans variations 2-16 from the same block's latest ready variation 1 stem", () => {
    const baseProject = createEmptyProject("Variation Anchor Test");
    const block = { ...baseProject.blocks[0], id: "block_atmosphere", name: "Atmosphere", bars: 8 };
    const durationSeconds = barsToSeconds(8, baseProject.song.bpm, baseProject.song.timeSignature[0]);
    const olderV1 = makeStem({
      id: "stem_atmosphere_v1_old",
      blockId: block.id,
      variation: 1,
      durationSeconds,
      updatedAt: "2026-08-26T00:00:00.000Z",
    });
    const latestV1 = makeStem({
      id: "stem_atmosphere_v1_latest",
      blockId: block.id,
      variation: 1,
      durationSeconds,
      updatedAt: "2026-08-26T01:00:00.000Z",
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
                id: "clip_atmosphere_v2",
                blockId: block.id,
                variation: 2,
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
      stems: [olderV1, latestV1],
    };

    const requirement = collectRequirements(project)[0];

    expect(requirement.variationAnchor).toBe(true);
    expect(requirement.variationAnchorStatus).toBe("ready");
    expect(requirement.inputStemId).toBe(latestV1.id);
    expect(requirement.inputMissing).toBe(false);
  });

  it("keeps a later variation blocked until variation 1 is ready", () => {
    const baseProject = createEmptyProject("Missing Variation Anchor Test");
    const block = { ...baseProject.blocks[0], id: "block_atmosphere", name: "Atmosphere", bars: 8 };
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
                id: "clip_atmosphere_v2",
                blockId: block.id,
                variation: 2,
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

    const requirement = collectRequirements(project)[0];

    expect(requirement.variationAnchor).toBe(true);
    expect(requirement.inputStemId).toBeNull();
    expect(requirement.inputMissing).toBe(true);
  });

  it("plans a later variation against a queued variation 1 stem", () => {
    const baseProject = createEmptyProject("Queued Variation Anchor Test");
    const block = { ...baseProject.blocks[0], id: "block_atmosphere", name: "Atmosphere", bars: 8 };
    const durationSeconds = barsToSeconds(8, baseProject.song.bpm, baseProject.song.timeSignature[0]);
    const queuedV1 = makeStem({
      id: "stem_atmosphere_v1_queued",
      blockId: block.id,
      variation: 1,
      durationSeconds,
      status: "queued",
      queueOrder: 1,
      filePath: null,
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
                id: "clip_atmosphere_v2",
                blockId: block.id,
                variation: 2,
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
      stems: [queuedV1],
    };

    const requirement = collectRequirements(project)[0];

    expect(requirement.inputStemId).toBe(queuedV1.id);
    expect(requirement.variationAnchorStatus).toBe("queued");
    expect(requirement.inputMissing).toBe(false);
  });

  it("detaches generated live stems without touching imported stems", () => {
    const baseProject = createEmptyProject("Delete All Test");
    const generatedBlock: GenostBlock = {
      ...baseProject.blocks[0],
      id: "block_generated",
      name: "Pad",
      implementedMelodies: [
        {
          id: "melody_generated",
          stemId: "stem_generated",
          textMetadata: "generated",
          createdAt: "2026-08-26T00:00:00.000Z",
        },
      ],
    };
    const importedBlock: GenostBlock = {
      ...baseProject.blocks[0],
      id: "block_imported",
      name: "Imported",
      sourceType: "imported",
      importedStemId: "stem_imported",
      implementedMelodies: [
        {
          id: "melody_imported",
          stemId: "stem_imported",
          textMetadata: "imported",
          createdAt: "2026-08-26T00:00:00.000Z",
        },
      ],
    };
    const generatedStem = makeStem({ id: "stem_generated", blockId: generatedBlock.id, variation: 1 });
    const importedStem = makeStem({
      id: "stem_imported",
      blockId: importedBlock.id,
      variation: 1,
      model: "imported-audio",
    });
    const project: GenostProject = {
      ...baseProject,
      blocks: [generatedBlock, importedBlock],
      arrangement: {
        lanes: [
          {
            id: "lane_1",
            name: "Layer 1",
            clips: [
              {
                id: "clip_generated",
                blockId: generatedBlock.id,
                variation: 1,
                startBar: 0,
                bars: 8,
                inputBlockId: null,
                inputStemId: generatedStem.id,
                stemId: generatedStem.id,
              },
              {
                id: "clip_imported",
                blockId: importedBlock.id,
                variation: 1,
                startBar: 8,
                bars: 8,
                inputBlockId: null,
                inputStemId: null,
                stemId: importedStem.id,
              },
            ],
          },
        ],
      },
      stems: [generatedStem, importedStem],
      mix: { ...baseProject.mix, lastBuildPath: "MIXES/old.mp3" },
    };

    const updated = detachLiveGeneratedStems(project, [
      {
        stemId: generatedStem.id,
        originalFilePath: generatedStem.filePath,
        archivePath: "ARCHIVE/DETACHED_stem_generated.wav",
        archiveFileName: "DETACHED_stem_generated.wav",
      },
    ]);

    expect(getLiveGeneratedStems(project).map((stem) => stem.id)).toEqual([generatedStem.id]);
    expect(updated.stems.find((stem) => stem.id === generatedStem.id)).toMatchObject({
      status: "detached",
      filePath: null,
      archivePath: "ARCHIVE/DETACHED_stem_generated.wav",
      fileName: "DETACHED_stem_generated.wav",
    });
    expect(updated.stems.find((stem) => stem.id === importedStem.id)).toMatchObject({
      status: "ready",
      filePath: importedStem.filePath,
    });
    expect(updated.blocks.find((block) => block.id === generatedBlock.id)?.implementedMelodies).toEqual([]);
    expect(updated.blocks.find((block) => block.id === importedBlock.id)?.implementedMelodies).toHaveLength(1);
    expect(updated.arrangement.lanes[0].clips[0]).toMatchObject({ inputStemId: null, stemId: null });
    expect(updated.arrangement.lanes[0].clips[1]).toMatchObject({ stemId: importedStem.id });
    expect(updated.mix.lastBuildPath).toBeNull();
  });

});
