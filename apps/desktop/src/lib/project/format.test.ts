import { describe, expect, it } from "vitest";
import { genostProjectSchema } from "../schema/project";
import {
  appendCommand,
  barsToSeconds,
  buildCompositionPrompt,
  composeStemPrompt,
  composeVariationStemPrompt,
  createCommandEntry,
  createCommandJournal,
  createEmptyProject,
  effectiveBlockTimeSignature,
  formatRenderDurationWarning,
  getCompositionFieldIssues,
  getCompositionPromptIssues,
  getRenderDurationIssue,
  hashProject,
  maxRenderableBars,
  stemRequirementHash,
} from "./format";

describe("project format helpers", () => {
  it("converts bars to seconds from BPM", () => {
    expect(barsToSeconds(16, 120, 4)).toBe(32);
    expect(barsToSeconds(16, 80, 4)).toBe(48);
    expect(maxRenderableBars(80, 4)).toBe(9);
  });

  it("flags MusicGen render requirements above the safe single-render duration", () => {
    const issue = getRenderDurationIssue({ bars: 16, bpm: 80, timeSignature: [4, 4] });

    expect(issue?.durationSeconds).toBe(48);
    expect(issue?.maxSeconds).toBe(29);
    expect(issue?.maxBars).toBe(9);
    expect(formatRenderDurationWarning("Pad v1", issue!)).toContain("GENOST blocks MusicGen renders above 29s");
    expect(getRenderDurationIssue({ bars: 9, bpm: 80, timeSignature: [4, 4] })).toBeNull();
  });

  it("builds and validates structured composition prompts", () => {
    const project = createEmptyProject("Prompt Test");

    expect(project.song.timeSignature).toEqual([4, 3]);
    expect(project.song.swing).toEqual({ feel: "soft", ratio: 1.35 });
    expect(project.song.prompt).toContain("170 BPM");
    expect(project.song.prompt).toContain("swing: Soft swing 1.35:1");
    expect(project.song.prompt).toContain("genre references: techno, intelligent jungle, dub techno");
    expect(getCompositionPromptIssues(project.song)).toEqual([]);
    expect(
      getCompositionPromptIssues({
        ...project.song,
        mood: "",
        genreReferences: [],
        prompt: buildCompositionPrompt({ ...project.song, mood: "", genreReferences: [] }),
      }),
    ).toEqual(["mood", "genre reference"]);
  });

  it("validates BPM, key notation, and absolute cache paths", () => {
    const project = createEmptyProject("Validation Test");
    expect(getCompositionFieldIssues(project.song)).toEqual([]);
    expect(getCompositionFieldIssues({ ...project.song, key: "Tokyo minor", modelCachePath: "models" })).toEqual([
      "Key must look like D minor or A Phrygian",
      "Model cache path must be absolute",
    ]);
  });

  it("defaults premix levels when loading separation data from older projects", () => {
    const raw = structuredClone(createEmptyProject("Legacy Separation")) as Record<string, unknown>;
    raw.separationBundles = [{
      id: "bundle",
      blockId: "block",
      sourceStemId: "stem",
      rawStemPath: "STEMS/stem.wav",
      model: "htdemucs_6s.yaml",
      preferredTarget: "other",
      status: "ready",
      selectedOutputIds: ["output"],
      outputs: [{
        id: "output",
        label: "other",
        fileName: "other.wav",
        filePath: "STEMS/SEPARATIONS/bundle/other.wav",
        status: "ready",
        durationSeconds: 8,
        peak: 0.5,
        createdAt: "2026-08-27T00:00:00Z",
      }],
      merges: [{
        id: "merge",
        outputIds: ["output"],
        fileName: "merge.wav",
        filePath: "STEMS/SEPARATIONS/bundle/MERGES/merge.wav",
        status: "ready",
        createdAt: "2026-08-27T00:00:00Z",
      }],
      previewMetadata: {},
      errorCode: null,
      error: null,
      createdAt: "2026-08-27T00:00:00Z",
      updatedAt: "2026-08-27T00:00:00Z",
    }];

    const parsed = genostProjectSchema.parse(raw);

    expect(parsed.separationBundles[0].outputs[0].volumeDb).toBe(0);
    expect(parsed.separationBundles[0].merges[0].outputLevelsDb).toEqual({});
  });

  it("uses block time signature overrides when present", () => {
    const project = createEmptyProject("Meter Test");
    const block = project.blocks[0];

    expect(block.soundCharacter).toBe("clean");
    expect(block.separatorTarget).toBe("other");
    expect(block.sourceType).toBe("generated");
    expect(block.importedStemId).toBeNull();
    expect(effectiveBlockTimeSignature(project, block)).toEqual(project.song.timeSignature);
    expect(effectiveBlockTimeSignature(project, { ...block, timeSignature: [3, 4] })).toEqual([3, 4]);
    expect(composeStemPrompt(project, block, 1)).toContain("global swing: Soft swing 1.35:1");
    expect(composeStemPrompt(project, block, 1)).toContain("isolated stem target: textured synth pad, subtle noise bed only");
    expect(composeStemPrompt(project, block, 1)).toContain("avoid kick drums, snare, hi-hats");
    expect(composeStemPrompt(project, { ...block, soundCharacter: "gritty" }, 1)).toContain(
      "sound character: gritty",
    );
  });

  it("keeps the full stem requirements inside melody-conditioned variation prompts", () => {
    const project = createEmptyProject("Variation Prompt Test");
    const block = project.blocks[0];
    const prompt = composeVariationStemPrompt(project, block, 2);

    expect(prompt).toContain("recognizable variation of supplied v1");
    expect(prompt).toContain("retain melody, harmony, tempo, meter, groove");
    expect(prompt).toContain("170 BPM");
    expect(prompt).toContain("global swing: Soft swing 1.35:1");
    expect(prompt).toContain("isolated stem target: textured synth pad, subtle noise bed only");
    expect(prompt).toContain("avoid kick drums, snare, hi-hats");
    expect(prompt).toContain("variation 2");
  });

  it("defaults legacy blocks to clean sound character", () => {
    const legacyProject = JSON.parse(JSON.stringify(createEmptyProject("Legacy Character Test"))) as Record<
      string,
      unknown
    >;
    delete ((legacyProject.blocks as Array<Record<string, unknown>>)[0]).soundCharacter;
    delete ((legacyProject.blocks as Array<Record<string, unknown>>)[0]).sourceType;
    delete ((legacyProject.blocks as Array<Record<string, unknown>>)[0]).importedStemId;

    const parsedBlock = genostProjectSchema.parse(legacyProject).blocks[0];

    expect(parsedBlock.soundCharacter).toBe("clean");
    expect(parsedBlock.sourceType).toBe("generated");
    expect(parsedBlock.importedStemId).toBeNull();
  });

  it("requires every block to declare an audio-separator target", () => {
    const invalidProject = JSON.parse(JSON.stringify(createEmptyProject("Missing Separator Target"))) as Record<
      string,
      unknown
    >;
    delete ((invalidProject.blocks as Array<Record<string, unknown>>)[0]).separatorTarget;

    expect(() => genostProjectSchema.parse(invalidProject)).toThrow();
  });

  it("appends command entries without mutating the existing journal", () => {
    const project = createEmptyProject("Journal Test");
    const journal = createCommandJournal(project.id);
    const command = createCommandEntry({
      type: "set_bpm",
      summary: "Updated BPM",
      payload: { bpm: 145 },
    });

    const updated = appendCommand(journal, command);

    expect(journal.commands).toHaveLength(0);
    expect(updated.commands).toHaveLength(1);
    expect(updated.commands[0].payload).toEqual({ bpm: 145 });
  });

  it("changes stem requirement hashes across variations", () => {
    const project = createEmptyProject("Hash Test");
    const block = project.blocks[0];
    const firstHash = stemRequirementHash({
      project,
      block,
      variation: 1,
      inputStemId: null,
      seed: 100,
    });
    const secondHash = stemRequirementHash({
      project,
      block,
      variation: 2,
      inputStemId: null,
      seed: 100,
    });
    const swingHash = stemRequirementHash({
      project: { ...project, song: { ...project.song, swing: { feel: "triplet", ratio: 2 } } },
      block,
      variation: 1,
      inputStemId: null,
      seed: 100,
    });
    const characterHash = stemRequirementHash({
      project,
      block: { ...block, soundCharacter: "lo-fi" },
      variation: 1,
      inputStemId: null,
      seed: 100,
    });

    expect(firstHash).not.toEqual(secondHash);
    expect(firstHash).not.toEqual(swingHash);
    expect(firstHash).not.toEqual(characterHash);
    expect(hashProject(project)).toHaveLength(8);
  });
});
