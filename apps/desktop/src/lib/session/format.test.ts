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
    expect(archived.promptHistory.revisions[0].artifactFolder).toBe("artifacts");
    expect(archived.promptHistory.revisions[0].locked).toBe(true);
    expect(archived.promptHistory.revisions.at(-1)?.artifactFolder).toBe("archive-1");
    expect(archived.artifacts[0].filePath).toBe("artifacts/artifact1.mid");
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

    expect(prompt).toBe("170 BPM, D minor, atmospheric pad, lush synthesizer, 90s intelligent jungle, atmospheric, clean mix");
  });

  it("journals command entries as append-only records", () => {
    const command = createCommandEntry({ type: "change_bpm", summary: "Changed BPM", payload: { bpm: 140 } });
    const journal = createCommandJournal("session_1", command);

    expect(journal.commands).toHaveLength(1);
    expect(journal.commands[0].type).toBe("change_bpm");
  });
});
