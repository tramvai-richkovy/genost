import { z } from "zod";

export const SESSION_SCHEMA_VERSION = 1;
export const SESSION_COMMANDS_SCHEMA_VERSION = 1;
export const SESSION_WORKSPACE_SCHEMA_VERSION = 1;

export const REQUIRED_MUSICGEN_MODELS = ["facebook/musicgen-medium", "facebook/musicgen-melody"] as const;

export const sessionTypeSchema = z.enum(["stem_constructor", "free_format", "midi_generator"]);
export const bpmPresetSchema = z.enum(["rock", "downtempo", "ambient", "dnb", "jungle", "techno", "house", "custom"]);
export const artifactKindSchema = z.enum([
  "audio_clip",
  "separated_stem",
  "midi_clip",
  "guide_audio",
  "premix_audio",
  "conversion_output",
]);
export const artifactMediaTypeSchema = z.enum(["audio/wav", "audio/mpeg", "audio/flac", "audio/aiff", "audio/ogg", "audio/midi"]);
export const artifactStatusSchema = z.enum(["queued", "generating", "ready", "failed", "missing", "archived"]);
export const commandActorSchema = z.enum(["user", "code-agent", "worker", "system"]);
export const commandSourceSchema = z.enum(["web-ui", "code-agent", "worker", "system"]);
export const commandTypeSchema = z.enum([
  "select_workspace",
  "create_session",
  "open_session",
  "change_session_title",
  "change_bpm",
  "change_tags",
  "change_export_folder",
  "archive_prompt",
  "generation_request",
  "artifact_rename",
  "artifact_export",
  "artifact_reveal",
  "artifact_conversion",
  "artifact_separation",
  "artifact_merge",
  "derived_session_create",
]);

export const modelSettingsSchema = z.object({
  cachePath: z.string().default(""),
  hfHome: z.string().nullable().default(null),
  backend: z.enum(["auto", "audiocraft", "mlx"]).default("auto"),
});

export const workspaceMetadataSchema = z.object({
  schemaVersion: z.literal(SESSION_WORKSPACE_SCHEMA_VERSION),
  updatedAt: z.string().min(1),
  knownTags: z.array(z.string()).default([]),
  lastSelectedSessionId: z.string().nullable().default(null),
  sidebarCollapsed: z.boolean().default(false),
  modelSettings: modelSettingsSchema.default({ cachePath: "", hfHome: null, backend: "auto" }),
});

export const promptRevisionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  prompt: z.string().default(""),
  artifactFolder: z.string().min(1),
  locked: z.boolean().default(false),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  archivedAt: z.string().nullable().default(null),
});

export const lineageSchema = z.object({
  sourceSessionId: z.string().nullable().default(null),
  sourceArtifactId: z.string().nullable().default(null),
  sourcePromptRevisionId: z.string().nullable().default(null),
  action: z.string().nullable().default(null),
});

export const modelBackendMetadataSchema = z
  .object({
    backend: z.string().nullable().default(null),
    device: z.string().nullable().default(null),
    model: z.string().nullable().default(null),
    generationSeconds: z.number().nonnegative().nullable().default(null),
    validationMetrics: z.record(z.string(), z.number()).nullable().default(null),
    cachePath: z.string().nullable().default(null),
  })
  .nullable()
  .default(null);

export const conversionMetadataSchema = z
  .object({
    type: z.enum(["audio_to_melodic_midi", "audio_to_drum_midi", "midi_to_guide_wav", "separation", "merge"]).optional(),
    sourceTool: z.string().nullable().default(null),
    guideAudioPath: z.string().nullable().default(null),
    sourcePath: z.string().nullable().default(null),
    sourceArtifactIds: z.array(z.string()).default([]),
  })
  .nullable()
  .default(null);

export const exportStatusSchema = z.object({
  exportedAt: z.string().nullable().default(null),
  exportPath: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
});

export const artifactSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: artifactKindSchema,
  mediaType: artifactMediaTypeSchema,
  fileName: z.string().min(1),
  filePath: z.string().min(1),
  parentArtifactId: z.string().nullable().default(null),
  sourceSessionId: z.string().nullable().default(null),
  promptRevisionId: z.string().nullable().default(null),
  modelBackend: modelBackendMetadataSchema,
  conversion: conversionMetadataSchema,
  status: artifactStatusSchema,
  error: z.string().nullable().default(null),
  volumeDb: z.number().min(-60).max(12).default(0),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  exportStatus: exportStatusSchema.default({ exportedAt: null, exportPath: null, error: null }),
});

export const sessionSchema = z.object({
  schemaVersion: z.literal(SESSION_SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string().min(1),
  title: z.string().min(1),
  type: sessionTypeSchema,
  bpm: z.number().int().min(40).max(260),
  bpmPreset: bpmPresetSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  artifactCount: z.number().int().min(0),
  tags: z.array(z.string()).default([]),
  exportFolder: z.string().nullable().default(null),
  promptHistory: z.object({
    activeRevisionId: z.string().min(1),
    revisions: z.array(promptRevisionSchema).min(1),
  }),
  lineage: lineageSchema.default({
    sourceSessionId: null,
    sourceArtifactId: null,
    sourcePromptRevisionId: null,
    action: null,
  }),
  artifacts: z.array(artifactSchema).default([]),
});

export const commandEntrySchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().min(1),
  actor: commandActorSchema,
  source: commandSourceSchema,
  type: commandTypeSchema,
  summary: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
  beforeHash: z.string().optional(),
  afterHash: z.string().optional(),
});

export const commandJournalSchema = z.object({
  schemaVersion: z.literal(SESSION_COMMANDS_SCHEMA_VERSION),
  sessionId: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  commands: z.array(commandEntrySchema),
});

export type SessionType = z.infer<typeof sessionTypeSchema>;
export type BpmPreset = z.infer<typeof bpmPresetSchema>;
export type ArtifactKind = z.infer<typeof artifactKindSchema>;
export type ArtifactMediaType = z.infer<typeof artifactMediaTypeSchema>;
export type ArtifactStatus = z.infer<typeof artifactStatusSchema>;
export type CommandEntry = z.infer<typeof commandEntrySchema>;
export type CommandJournal = z.infer<typeof commandJournalSchema>;
export type GenostSession = z.infer<typeof sessionSchema>;
export type GenostArtifact = z.infer<typeof artifactSchema>;
export type PromptRevision = z.infer<typeof promptRevisionSchema>;
export type WorkspaceMetadata = z.infer<typeof workspaceMetadataSchema>;
export type ModelSettings = z.infer<typeof modelSettingsSchema>;
