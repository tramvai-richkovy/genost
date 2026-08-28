import { z } from "zod";

export const PROJECT_SCHEMA_VERSION = 1;
export const COMMANDS_SCHEMA_VERSION = 1;
export const WORKSPACE_SCHEMA_VERSION = 1;

export const timeSignatureSchema = z.tuple([
  z.number().int().min(1).max(32),
  z.number().int().min(1).max(32),
]);

export const swingFeelSchema = z.enum(["straight", "soft", "triplet", "hard"]);

export const SOUND_CHARACTER_VALUES = [
  "hi-rez",
  "clean",
  "dreamy",
  "gritty",
  "dirty",
  "fuzzy",
  "distorted",
  "lo-fi",
  "retro",
  "ambient",
  "intimate",
  "gigantic",
] as const;

export const soundCharacterSchema = z.enum(SOUND_CHARACTER_VALUES).default("clean");
export const blockSourceTypeSchema = z.enum(["generated", "imported"]).default("generated");
export const audioContentCategorySchema = z.enum(["generic", "bass_drone", "rhythm", "melody"]);
export const SEPARATOR_TARGET_VALUES = [
  "bass",
  "drums",
  "guitar",
  "piano",
  "vocals",
  "other",
  "instrumental",
] as const;
export const separatorTargetSchema = z.enum(SEPARATOR_TARGET_VALUES);

export const swingSettingsSchema = z
  .object({
    feel: swingFeelSchema.default("soft"),
    ratio: z.number().min(1).max(3).default(1.35),
  })
  .default({ feel: "soft", ratio: 1.35 });

export const stemStatusSchema = z.enum([
  "missing",
  "queued",
  "rendering",
  "ready",
  "stale",
  "failed",
  "canceled",
  "archived",
  "superseded",
  "detached",
]);

export const commandEntrySchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().min(1),
  actor: z.enum(["user", "code-agent", "worker", "system"]),
  source: z.enum(["web-ui", "code-agent", "worker", "system"]),
  type: z.string().min(1),
  summary: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
  beforeHash: z.string().optional(),
  afterHash: z.string().optional(),
});

export const commandJournalSchema = z.object({
  schemaVersion: z.literal(COMMANDS_SCHEMA_VERSION),
  projectId: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  commands: z.array(commandEntrySchema),
});

export const implementedMelodySchema = z.object({
  id: z.string().min(1),
  stemId: z.string().min(1),
  textMetadata: z.string().default(""),
  createdAt: z.string().min(1),
});

export const blockSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  bars: z.number().int().min(1).max(64),
  timeSignature: timeSignatureSchema.nullable().default(null),
  role: z.string().default(""),
  instruments: z.array(z.string()).default([]),
  separatorTarget: separatorTargetSchema,
  validationCategory: audioContentCategorySchema.default("generic"),
  soundCharacter: soundCharacterSchema,
  sourceType: blockSourceTypeSchema,
  importedStemId: z.string().nullable().default(null),
  melodyDescription: z.string().default(""),
  melodyPrompt: z.string().default(""),
  rhythmFeel: z.string().default(""),
  timbre: z.string().default(""),
  energy: z.number().int().min(1).max(10).default(5),
  density: z.number().int().min(1).max(10).default(5),
  avoid: z.string().default(""),
  volumeDb: z.number().min(-60).max(12).default(-6),
  delaySend: z.number().min(0).max(1).default(0),
  reverbSend: z.number().min(0).max(1).default(0),
  compressorEnabled: z.boolean().default(false),
  implementedMelodies: z.array(implementedMelodySchema).default([]),
});

export const clipSchema = z.object({
  id: z.string().min(1),
  blockId: z.string().min(1),
  variation: z.number().int().min(1).max(16),
  startBar: z.number().int().min(0),
  bars: z.number().int().min(1).max(64),
  inputBlockId: z.string().nullable().default(null),
  inputStemId: z.string().nullable(),
  stemId: z.string().nullable(),
});

export const laneSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  clips: z.array(clipSchema).default([]),
});

export const stemSchema = z.object({
  id: z.string().min(1),
  blockId: z.string().min(1),
  variation: z.number().int().min(1).max(16),
  inputStemId: z.string().nullable(),
  model: z.string().min(1),
  promptHash: z.string().min(1),
  seed: z.number().int().nonnegative(),
  durationSeconds: z.number().positive(),
  status: stemStatusSchema,
  queueOrder: z.number().int().positive().nullable().default(null),
  fileName: z.string().min(1),
  filePath: z.string().nullable(),
  archivePath: z.string().nullable().default(null),
  revisionOfStemId: z.string().nullable().default(null),
  staleReason: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
  renderMetadata: z
    .object({
      backend: z.string().nullable(),
      device: z.string().nullable(),
      model: z.string().nullable(),
      generationSeconds: z.number().nonnegative().nullable(),
      validationMetrics: z.record(z.string(), z.number()).nullable(),
      completedAt: z.string().min(1),
    })
    .nullable()
    .optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const separationOutputStatusSchema = z.enum(["ready", "missing", "archived"]);
export const separationOutputSchema = z.object({
  id: z.string().min(1),
  label: z.enum(["bass", "drums", "guitar", "piano", "vocals", "other"]),
  fileName: z.string().min(1),
  filePath: z.string().nullable(),
  status: separationOutputStatusSchema,
  volumeDb: z.number().min(-60).max(6).default(0),
  durationSeconds: z.number().positive().nullable().default(null),
  peak: z.number().nonnegative().nullable().default(null),
  createdAt: z.string().min(1),
});

export const separationMergeSchema = z.object({
  id: z.string().min(1),
  outputIds: z.array(z.string().min(1)).min(1),
  fileName: z.string().min(1),
  filePath: z.string().nullable(),
  status: separationOutputStatusSchema,
  outputLevelsDb: z.record(z.string(), z.number().min(-60).max(6)).default({}),
  archivePath: z.string().nullable().default(null),
  createdAt: z.string().min(1),
});

export const separationBundleSchema = z.object({
  id: z.string().min(1),
  blockId: z.string().min(1),
  sourceStemId: z.string().min(1),
  rawStemPath: z.string().min(1),
  model: z.string().min(1),
  preferredTarget: separatorTargetSchema,
  status: z.enum(["queued", "separating", "ready", "failed", "archived"]),
  selectedOutputIds: z.array(z.string().min(1)).default([]),
  outputs: z.array(separationOutputSchema).default([]),
  merges: z.array(separationMergeSchema).default([]),
  previewMetadata: z.record(z.string(), z.unknown()).default({}),
  errorCode: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const genostProjectSchema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  id: z.string().min(1),
  title: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  song: z.object({
    prompt: z.string().default(""),
    bpm: z.number().int().min(40).max(260),
    key: z.string().default(""),
    timeSignature: timeSignatureSchema,
    swing: swingSettingsSchema,
    mood: z.string().default(""),
    referenceNotes: z.string().default(""),
    purpose: z.string().default(""),
    avoid: z.string().default(""),
    genreReferences: z.array(z.string()).default([]),
    rhythmFeel: z.string().default(""),
    sonicPalette: z.string().default(""),
    productionNotes: z.string().default(""),
    arrangementNotes: z.string().default(""),
    referenceTrackPath: z.string().nullable().default(null),
    referenceTrackName: z.string().nullable().default(null),
    sampleRate: z.number().int().positive(),
    defaultTextModel: z.string().min(1),
    defaultMelodyModel: z.string().min(1),
    modelCachePath: z.string().default(""),
  }),
  blocks: z.array(blockSchema).default([]),
  arrangement: z.object({
    lanes: z.array(laneSchema).default([]),
  }),
  stems: z.array(stemSchema).default([]),
  separationBundles: z.array(separationBundleSchema).default([]),
  mix: z.object({
    masterDelay: z.number().min(0).max(1).default(0),
    masterDelayEnabled: z.boolean().default(true),
    masterDelayTimeMs: z.number().int().min(1).max(2000).default(375),
    masterDelayFeedback: z.number().min(0).max(0.95).default(0.28),
    masterDelayFilterHz: z.number().int().min(200).max(18000).default(6200),
    masterReverb: z.number().min(0).max(1).default(0),
    masterReverbEnabled: z.boolean().default(true),
    masterReverbDecaySeconds: z.number().min(0.1).max(20).default(4.5),
    masterReverbPreDelayMs: z.number().int().min(0).max(500).default(24),
    masterReverbDampeningHz: z.number().int().min(200).max(18000).default(7800),
    masterLimiter: z.boolean().default(true),
    masterLimiterThresholdDb: z.number().min(-24).max(0).default(-1),
    masterLimiterReleaseMs: z.number().int().min(10).max(2000).default(120),
    outputGainDb: z.number().min(-24).max(12).default(0),
    lastBuildPath: z.string().nullable(),
  }),
  roadmap: z.object({
    nextPriority: z.string().default("MIDI and chord progression support"),
  }),
});

export const workspaceMetadataSchema = z.object({
  schemaVersion: z.literal(WORKSPACE_SCHEMA_VERSION),
  updatedAt: z.string().min(1),
  genreReferences: z.array(z.string()).default([]),
});

export type StemStatus = z.infer<typeof stemStatusSchema>;
export type CommandEntry = z.infer<typeof commandEntrySchema>;
export type CommandJournal = z.infer<typeof commandJournalSchema>;
export type GenostProject = z.infer<typeof genostProjectSchema>;
export type GenostBlock = z.infer<typeof blockSchema>;
export type ArrangementClip = z.infer<typeof clipSchema>;
export type ArrangementLane = z.infer<typeof laneSchema>;
export type GenostStem = z.infer<typeof stemSchema>;
export type SeparationBundle = z.infer<typeof separationBundleSchema>;
export type SeparationOutput = z.infer<typeof separationOutputSchema>;
export type SeparationMerge = z.infer<typeof separationMergeSchema>;
export type TimeSignature = z.infer<typeof timeSignatureSchema>;
export type SwingFeel = z.infer<typeof swingFeelSchema>;
export type SwingSettings = z.infer<typeof swingSettingsSchema>;
export type SoundCharacter = z.infer<typeof soundCharacterSchema>;
export type SeparatorTarget = z.infer<typeof separatorTargetSchema>;
export type BlockSourceType = z.infer<typeof blockSourceTypeSchema>;
export type AudioContentCategory = z.infer<typeof audioContentCategorySchema>;
export type WorkspaceMetadata = z.infer<typeof workspaceMetadataSchema>;
