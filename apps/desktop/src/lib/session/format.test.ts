import { describe, expect, it } from "vitest";
import { sessionSchema, workspaceMetadataSchema } from "./schema";
import {
  archivePromptRevision,
  buildStemConstructorPrompt,
  createArtifact,
  createCommandEntry,
  createCommandJournal,
  createEmptySession,
  createWorkspaceMetadata,
  hashSession,
  nextArtifactName,
  nextDefaultSessionName,
  STEM_CONSTRUCTORS,
} from "./format";

describe("session format helpers", () => {
  it("allocates default session names from the first free daily suffix", () => {
    const date = new Date("2026-08-28T08:00:00Z");

    expect(nextDefaultSessionName([], date)).toBe("se-260828-1");
    expect(nextDefaultSessionName(["se-260828-1", "se-260828-3"], date)).toBe("se-260828-2");
  });

  it("creates schema-valid sessions and workspace metadata", () => {
    const workspace = workspaceMetadataSchema.parse(createWorkspaceMetadata({ cachePath: "/Volumes/Models" }));
    const session = sessionSchema.parse(
      createEmptySession({
        type: "free_format",
        name: "se-260828-1",
        bpm: 120,
        bpmPreset: "custom",
        tag: "jungle",
      }),
    );

    expect(workspace.modelSettings.cachePath).toBe("/Volumes/Models");
    expect(session.title).toBe("se-260828-1");
    expect(session.tags).toEqual(["jungle"]);
    expect(session.artifactCount).toBe(0);
    expect(hashSession(session)).toHaveLength(8);
  });

  it("archives prompts without mutating old artifact paths", () => {
    const session = createEmptySession({ type: "midi_generator", name: "se-260828-1", bpm: 170, bpmPreset: "jungle" });
    const activeRevision = session.promptHistory.revisions[0];
    const artifact = createArtifact({
      session,
      kind: "midi_clip",
      fileName: "artifact1.mid",
      filePath: `${activeRevision.artifactFolder}/artifact1.mid`,
      status: "ready",
    });
    const archived = archivePromptRevision({ ...session, artifacts: [artifact], artifactCount: 1 });

    expect(archived.promptHistory.revisions[0].label).toBe("archive-1");
    expect(archived.promptHistory.revisions[0].artifactFolder).toBe("archive-1");
    expect(archived.promptHistory.revisions[0].locked).toBe(true);
    expect(archived.promptHistory.revisions.at(-1)?.artifactFolder).toBe("archive-2");
    expect(archived.artifacts[0].filePath).toBe("archive-1/artifact1.mid");
    const archivedAgain = archivePromptRevision(archived);
    expect(archivedAgain.promptHistory.revisions.map((revision) => revision.artifactFolder)).toEqual([
      "archive-1",
      "archive-2",
      "archive-3",
    ]);
    expect(new Set(archivedAgain.promptHistory.revisions.map((revision) => revision.artifactFolder)).size).toBe(3);
  });

  it("uses artifactN defaults while allowing schema-specific media", () => {
    const session = createEmptySession({ type: "free_format", name: "se-260828-1", bpm: 132, bpmPreset: "techno" });
    const first = createArtifact({ session, kind: "audio_clip", fileName: "artifact1.wav", filePath: "artifacts/artifact1.wav" });
    const secondName = nextArtifactName({ artifacts: [first] });
    const second = createArtifact({
      session: { ...session, artifacts: [first] },
      kind: "midi_clip",
      fileName: "artifact2.mid",
      filePath: "artifacts/artifact2.mid",
    });

    expect(first.name).toBe("artifact1");
    expect(secondName).toBe("artifact2");
    expect(second.mediaType).toBe("audio/midi");
  });

  it("builds concise stem constructor prompts", () => {
    const prompt = buildStemConstructorPrompt({
      bpm: 170,
      constructorId: "pad",
      values: {
        key: "D minor",
        instrument: "lush synthesizer",
        style: "90s intelligent jungle",
        mood: "atmospheric",
        mix: "clean mix",
      },
    });

    expect(prompt).toBe("170 BPM, D minor, atmospheric pad, lush synthesizer, 90s intelligent jungle, clean mix");
  });

  it("provides deterministic four-or-five-field fixtures for every requested constructor", () => {
    expect(STEM_CONSTRUCTORS).toHaveLength(11);
    for (const constructor of STEM_CONSTRUCTORS) {
      expect(constructor.fields.length).toBeGreaterThanOrEqual(4);
      expect(constructor.fields.length).toBeLessThanOrEqual(5);
      const values = Object.fromEntries(
        constructor.fields.map((field) => [field.id, field.values[0]]),
      );
      const prompt = buildStemConstructorPrompt({ bpm: 120, constructorId: constructor.id, values });
      expect(prompt.startsWith("120 BPM, ")).toBe(true);
      expect(buildStemConstructorPrompt({ bpm: 120, constructorId: constructor.id, values })).toBe(prompt);
    }
  });

  it("validates exact artifact provenance in the session schema", () => {
    const session = createEmptySession({ type: "free_format", name: "se-260828-1" });
    const artifact = createArtifact({
      session,
      kind: "audio_clip",
      fileName: "artifact1.wav",
      filePath: "artifacts/artifact1.wav",
      provenance: {
        operation: "musicgen",
        exactPrompt: "120 BPM, clean pad",
        model: "facebook/musicgen-medium",
        backend: "mlx",
        device: "metal",
        seed: 42,
        durationSeconds: 25,
        referenceArtifactId: null,
        referencePath: null,
        sourceSessionId: session.id,
        sourceArtifactIds: [],
        settings: { topK: 250 },
        timings: { generationSeconds: 1.5 },
        createdAt: new Date().toISOString(),
      },
    });
    const parsed = sessionSchema.parse({ ...session, artifacts: [artifact], artifactCount: 1 });
    expect(parsed.artifacts[0].provenance?.seed).toBe(42);
  });

  it("journals command entries as append-only records", () => {
    const command = createCommandEntry({ type: "change_bpm", summary: "Changed BPM", payload: { bpm: 140 } });
    const journal = createCommandJournal("session_1", command);

    expect(journal.commands).toHaveLength(1);
    expect(journal.commands[0].type).toBe("change_bpm");
  });
});
