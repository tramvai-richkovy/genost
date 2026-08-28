import {
  SESSION_COMMANDS_SCHEMA_VERSION,
  SESSION_SCHEMA_VERSION,
  SESSION_WORKSPACE_SCHEMA_VERSION,
  type BpmPreset,
  type CommandEntry,
  type CommandJournal,
  type GenostArtifact,
  type GenostSession,
  type ModelSettings,
  type PromptRevision,
  type SessionType,
  type WorkspaceMetadata,
} from "./schema";

export const SESSION_FILE_NAME = "session.json";
export const COMMANDS_FILE_NAME = "commands.json";
export const WORKSPACE_COMMANDS_FILE_NAME = "workspace-commands.json";
export const WORKSPACE_FILE_NAME = "genost-workspace.json";
export const ACTIVE_ARTIFACTS_DIRECTORY = "artifacts";
export const ARCHIVE_DIRECTORY_PREFIX = "archive";
export const DEFAULT_GENERATION_SECONDS = 25;
export const DEFAULT_TEXT_MODEL = "facebook/musicgen-medium";
export const DEFAULT_MELODY_MODEL = "facebook/musicgen-melody";

export type CommandDraft = {
  type: CommandEntry["type"];
  summary: string;
  payload?: Record<string, unknown>;
  actor?: CommandEntry["actor"];
  source?: CommandEntry["source"];
};

export type BpmPresetDefinition = {
  id: BpmPreset;
  label: string;
  bpm: number;
};

export const BPM_PRESETS: BpmPresetDefinition[] = [
  { id: "rock", label: "Rock", bpm: 128 },
  { id: "downtempo", label: "Downtempo", bpm: 90 },
  { id: "ambient", label: "Ambient", bpm: 70 },
  { id: "dnb", label: "DNB", bpm: 174 },
  { id: "jungle", label: "Jungle", bpm: 170 },
  { id: "techno", label: "Techno", bpm: 132 },
  { id: "house", label: "House", bpm: 124 },
  { id: "custom", label: "Custom", bpm: 120 },
];

export type ConstructorFieldDefinition = {
  id: string;
  label: string;
  values: string[];
};

export type StemConstructorDefinition = {
  id: string;
  title: string;
  fields: ConstructorFieldDefinition[];
};

export const STEM_CONSTRUCTORS: StemConstructorDefinition[] = [
  {
    id: "arpeggio",
    title: "Arpeggio",
    fields: [
      { id: "key", label: "Key", values: ["D minor", "A minor", "F# minor", "C Phrygian"] },
      { id: "instrument", label: "Instrument", values: ["clean analog pluck", "bell FM synth", "muted guitar harmonics"] },
      { id: "style", label: "Style", values: ["90s intelligent jungle", "minimal techno", "darkwave soundtrack"] },
      { id: "motion", label: "Motion", values: ["16th-note rolling", "syncopated gated", "slow evolving"] },
      { id: "mix", label: "Mix", values: ["dry and clean", "wide delay", "tight mono center"] },
    ],
  },
  {
    id: "bass",
    title: "Bass",
    fields: [
      { id: "key", label: "Key", values: ["D minor", "E minor", "A Phrygian", "G minor"] },
      { id: "instrument", label: "Instrument", values: ["reese bass", "sub bass", "round analog bass"] },
      { id: "movement", label: "Movement", values: ["sparse root notes", "rolling syncopation", "rubbery offbeats"] },
      { id: "style", label: "Style", values: ["jungle", "dub techno", "industrial game score"] },
      { id: "mix", label: "Mix", values: ["clean low end", "controlled saturation", "mono club mix"] },
    ],
  },
  {
    id: "drums",
    title: "Drums",
    fields: [
      { id: "kit", label: "Kit", values: ["dry breakbeat kit", "909 kit", "cinematic tom ensemble"] },
      { id: "groove", label: "Groove", values: ["amen-style shuffle", "four-on-floor", "half-time pressure"] },
      { id: "energy", label: "Energy", values: ["restrained", "driving", "combat intense"] },
      { id: "texture", label: "Texture", values: ["clean transients", "tape grit", "metallic room"] },
      { id: "mix", label: "Mix", values: ["tight bus compression", "dry close mics", "wide overheads"] },
    ],
  },
  {
    id: "pad",
    title: "Atmospheric Pad",
    fields: [
      { id: "key", label: "Key", values: ["D minor", "A minor", "C# minor", "F Dorian"] },
      { id: "instrument", label: "Instrument", values: ["lush synthesizer", "granular choir pad", "warm wavetable pad"] },
      { id: "style", label: "Style", values: ["90s intelligent jungle", "ambient techno", "sci-fi game score"] },
      { id: "mood", label: "Mood", values: ["atmospheric", "nocturnal", "melancholic"] },
      { id: "mix", label: "Mix", values: ["clean mix", "wide but dry", "soft tape haze"] },
    ],
  },
  {
    id: "lead",
    title: "Lead",
    fields: [
      { id: "key", label: "Key", values: ["D minor", "G minor", "E Phrygian", "A minor"] },
      { id: "instrument", label: "Instrument", values: ["acid lead", "saw lead", "expressive flute synth"] },
      { id: "phrase", label: "Phrase", values: ["short hook", "call and response", "long legato line"] },
      { id: "style", label: "Style", values: ["dark techno", "retro game battle", "cinematic chase"] },
      { id: "mix", label: "Mix", values: ["front and dry", "delay throws", "clean upper mids"] },
    ],
  },
  {
    id: "keys",
    title: "Keys",
    fields: [
      { id: "key", label: "Key", values: ["D minor", "Bb minor", "F minor", "C Dorian"] },
      { id: "instrument", label: "Instrument", values: ["electric piano", "house organ", "detuned digital keys"] },
      { id: "rhythm", label: "Rhythm", values: ["syncopated stabs", "slow chord pulses", "broken chords"] },
      { id: "style", label: "Style", values: ["deep house", "dub techno", "detective game score"] },
      { id: "mix", label: "Mix", values: ["clean mix", "short room", "filtered highs"] },
    ],
  },
  {
    id: "solo_guitar",
    title: "Solo Guitar",
    fields: [
      { id: "key", label: "Key", values: ["D minor", "E minor", "A minor", "G Dorian"] },
      { id: "tone", label: "Tone", values: ["clean chorus guitar", "muted electric guitar", "saturated lead guitar"] },
      { id: "phrase", label: "Phrase", values: ["sparse melodic motif", "fast tremolo run", "expressive bends"] },
      { id: "style", label: "Style", values: ["neo-noir soundtrack", "boss battle", "post-rock"] },
      { id: "mix", label: "Mix", values: ["dry close amp", "wide stereo delay", "clean mix"] },
    ],
  },
  {
    id: "choir",
    title: "Choir Parts",
    fields: [
      { id: "key", label: "Key", values: ["D minor", "C minor", "F# minor", "A Aeolian"] },
      { id: "voices", label: "Voices", values: ["wordless low choir", "airy female choir", "stacked synthetic choir"] },
      { id: "motion", label: "Motion", values: ["slow sustained chords", "rising cluster", "short ominous swells"] },
      { id: "style", label: "Style", values: ["cathedral horror", "fantasy overworld", "sci-fi ritual"] },
      { id: "mix", label: "Mix", values: ["clean mix", "large hall", "dark filtered reverb"] },
    ],
  },
  {
    id: "scene",
    title: "Game/Movie Scene",
    fields: [
      { id: "scene", label: "Scene", values: ["rainy city investigation", "abandoned space station", "quiet forest shrine"] },
      { id: "mood", label: "Mood", values: ["tense", "wondering", "lonely"] },
      { id: "instrument", label: "Instrument", values: ["textural synth ensemble", "hybrid strings", "soft piano and pad"] },
      { id: "pulse", label: "Pulse", values: ["no drums", "subtle pulse", "distant percussion"] },
      { id: "mix", label: "Mix", values: ["cinematic clean mix", "wide ambience", "dry intimate foreground"] },
    ],
  },
  {
    id: "boss_battle",
    title: "Game Boss Battle Theme",
    fields: [
      { id: "key", label: "Key", values: ["D minor", "E Phrygian", "C# minor", "G minor"] },
      { id: "hook", label: "Hook", values: ["aggressive brass motif", "distorted synth riff", "choir stab hook"] },
      { id: "rhythm", label: "Rhythm", values: ["fast breakbeats", "driving double-time", "heavy half-time"] },
      { id: "palette", label: "Palette", values: ["industrial orchestra", "dark cyberpunk", "retro console metal"] },
      { id: "mix", label: "Mix", values: ["clean punchy mix", "wide battle mix", "tight low end"] },
    ],
  },
  {
    id: "regular_encounter",
    title: "Game Regular Encounter",
    fields: [
      { id: "key", label: "Key", values: ["D minor", "A minor", "F minor", "B Locrian"] },
      { id: "hook", label: "Hook", values: ["short synth motif", "pluck ostinato", "percussive bass riff"] },
      { id: "groove", label: "Groove", values: ["loopable combat groove", "medium breakbeat", "urgent techno pulse"] },
      { id: "palette", label: "Palette", values: ["retro RPG", "urban sci-fi", "dark fantasy"] },
      { id: "mix", label: "Mix", values: ["clear loopable mix", "dry arcade mix", "tight punchy mix"] },
    ],
  },
];

export function nowIso(): string {
  return new Date().toISOString();
}

export function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const tag of tags) {
    const cleaned = tag.trim().replace(/\s+/g, " ");
    const key = cleaned.toLocaleLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    normalized.push(cleaned);
  }

  return normalized;
}

export function mergeTags(existing: string[], incoming: string[]): string[] {
  return normalizeTags([...existing, ...incoming]).sort((left, right) => left.localeCompare(right));
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

export function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function hashSession(session: GenostSession): string {
  return hashString(stableStringify(session));
}

export function createCommandEntry(draft: CommandDraft, beforeHash?: string, afterHash?: string): CommandEntry {
  return {
    id: makeId("cmd"),
    createdAt: nowIso(),
    actor: draft.actor ?? "user",
    source: draft.source ?? "web-ui",
    type: draft.type,
    summary: draft.summary,
    payload: draft.payload ?? {},
    beforeHash,
    afterHash,
  };
}

export function createCommandJournal(sessionId: string, firstCommand?: CommandEntry): CommandJournal {
  const createdAt = nowIso();
  return {
    schemaVersion: SESSION_COMMANDS_SCHEMA_VERSION,
    sessionId,
    createdAt,
    updatedAt: createdAt,
    commands: firstCommand ? [firstCommand] : [],
  };
}

export function appendCommand(journal: CommandJournal, command: CommandEntry): CommandJournal {
  return {
    ...journal,
    updatedAt: command.createdAt,
    commands: [...journal.commands, command],
  };
}

export function createWorkspaceMetadata(settings: Partial<ModelSettings> = {}): WorkspaceMetadata {
  return {
    schemaVersion: SESSION_WORKSPACE_SCHEMA_VERSION,
    updatedAt: nowIso(),
    knownTags: [],
    lastSelectedSessionId: null,
    sidebarCollapsed: false,
    modelSettings: {
      cachePath: settings.cachePath ?? "",
      hfHome: settings.hfHome ?? null,
      backend: settings.backend ?? "auto",
    },
  };
}

function twoDigit(value: number): string {
  return value.toString().padStart(2, "0");
}

export function sessionDateCode(date = new Date()): string {
  return `${twoDigit(date.getFullYear() % 100)}${twoDigit(date.getMonth() + 1)}${twoDigit(date.getDate())}`;
}

export function nextDefaultSessionName(existingNames: string[], date = new Date()): string {
  const prefix = `se-${sessionDateCode(date)}-`;
  const used = new Set<number>();
  for (const name of existingNames) {
    if (!name.startsWith(prefix)) continue;
    const suffix = Number(name.slice(prefix.length));
    if (Number.isInteger(suffix) && suffix > 0) used.add(suffix);
  }

  for (let index = 1; index < 10_000; index += 1) {
    if (!used.has(index)) return `${prefix}${index}`;
  }

  return `${prefix}${Date.now().toString(36)}`;
}

export function sanitizeSessionFolderName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^A-Za-z0-9 _-]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 80);
  return cleaned || nextDefaultSessionName([]);
}

export function sessionTypeLabel(type: SessionType): string {
  if (type === "stem_constructor") return "Stem Constructor";
  if (type === "midi_generator") return "Midi Generator";
  return "Free Format";
}

export function createPromptRevision(args: {
  label?: string;
  prompt?: string;
  artifactFolder?: string;
  locked?: boolean;
} = {}): PromptRevision {
  const createdAt = nowIso();
  return {
    id: makeId("prompt"),
    label: args.label ?? "current",
    prompt: args.prompt ?? "",
    artifactFolder: args.artifactFolder ?? ACTIVE_ARTIFACTS_DIRECTORY,
    locked: args.locked ?? false,
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
  };
}

export function activePromptRevision(session: GenostSession): PromptRevision {
  return (
    session.promptHistory.revisions.find((revision) => revision.id === session.promptHistory.activeRevisionId) ??
    session.promptHistory.revisions[0]
  );
}

export function createEmptySession(args: {
  type: SessionType;
  name: string;
  bpm?: number;
  bpmPreset?: BpmPreset;
  tag?: string;
  exportFolder?: string | null;
  lineage?: Partial<GenostSession["lineage"]>;
}): GenostSession {
  const createdAt = nowIso();
  const promptRevision = createPromptRevision();
  const bpm = args.bpm ?? 120;
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    id: makeId("session"),
    name: args.name.trim(),
    title: args.name.trim(),
    type: args.type,
    bpm,
    bpmPreset: args.bpmPreset ?? "custom",
    createdAt,
    updatedAt: createdAt,
    artifactCount: 0,
    tags: normalizeTags(args.tag ? [args.tag] : []),
    exportFolder: args.exportFolder ?? null,
    promptHistory: {
      activeRevisionId: promptRevision.id,
      revisions: [promptRevision],
    },
    lineage: {
      sourceSessionId: args.lineage?.sourceSessionId ?? null,
      sourceArtifactId: args.lineage?.sourceArtifactId ?? null,
      sourcePromptRevisionId: args.lineage?.sourcePromptRevisionId ?? null,
      action: args.lineage?.action ?? null,
    },
    artifacts: [],
  };
}

export function withSessionUpdatedAt(session: GenostSession): GenostSession {
  return {
    ...session,
    updatedAt: nowIso(),
    artifactCount: session.artifacts.length,
  };
}

export function nextArtifactName(session: Pick<GenostSession, "artifacts">): string {
  const used = new Set(
    session.artifacts
      .map((artifact) => /^artifact(\d+)$/.exec(artifact.name)?.[1])
      .filter((value): value is string => Boolean(value))
      .map((value) => Number(value)),
  );

  for (let index = 1; index < 100_000; index += 1) {
    if (!used.has(index)) return `artifact${index}`;
  }

  return `artifact${Date.now().toString(36)}`;
}

export function inferMediaTypeFromFileName(fileName: string): GenostArtifact["mediaType"] {
  const lower = fileName.toLocaleLowerCase();
  if (lower.endsWith(".mid") || lower.endsWith(".midi")) return "audio/midi";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".flac")) return "audio/flac";
  if (lower.endsWith(".aif") || lower.endsWith(".aiff")) return "audio/aiff";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  return "audio/wav";
}

export function createArtifact(args: {
  session: GenostSession;
  name?: string;
  kind: GenostArtifact["kind"];
  fileName: string;
  filePath: string;
  parentArtifactId?: string | null;
  sourceSessionId?: string | null;
  promptRevisionId?: string | null;
  status?: GenostArtifact["status"];
  modelBackend?: GenostArtifact["modelBackend"];
  conversion?: GenostArtifact["conversion"];
  volumeDb?: number;
}): GenostArtifact {
  const createdAt = nowIso();
  return {
    id: makeId("artifact"),
    name: args.name?.trim() || nextArtifactName(args.session),
    kind: args.kind,
    mediaType: inferMediaTypeFromFileName(args.fileName),
    fileName: args.fileName,
    filePath: args.filePath,
    parentArtifactId: args.parentArtifactId ?? null,
    sourceSessionId: args.sourceSessionId ?? args.session.id,
    promptRevisionId: args.promptRevisionId ?? activePromptRevision(args.session).id,
    modelBackend: args.modelBackend ?? null,
    conversion: args.conversion ?? null,
    status: args.status ?? "queued",
    error: null,
    volumeDb: args.volumeDb ?? 0,
    createdAt,
    updatedAt: createdAt,
    exportStatus: { exportedAt: null, exportPath: null, error: null },
  };
}

export function archivePromptRevision(session: GenostSession): GenostSession {
  const active = activePromptRevision(session);
  const archiveLabel = nextArchiveLabel(session);
  const archivedAt = nowIso();
  const revisions = session.promptHistory.revisions.map((revision) =>
    revision.id === active.id
      ? {
          ...revision,
          label: archiveLabel,
          locked: true,
          archivedAt,
          updatedAt: archivedAt,
        }
      : revision,
  );
  const nextRevision = createPromptRevision({ prompt: active.prompt, artifactFolder: archiveLabel });

  return withSessionUpdatedAt({
    ...session,
    promptHistory: {
      activeRevisionId: nextRevision.id,
      revisions: [...revisions, nextRevision],
    },
  });
}

export function nextArchiveLabel(session: GenostSession): string {
  const used = new Set<number>();
  for (const revision of session.promptHistory.revisions) {
    const match = new RegExp(`^${ARCHIVE_DIRECTORY_PREFIX}-(\\d+)$`).exec(revision.label);
    if (match) used.add(Number(match[1]));
    const folderMatch = new RegExp(`^${ARCHIVE_DIRECTORY_PREFIX}-(\\d+)$`).exec(revision.artifactFolder);
    if (folderMatch) used.add(Number(folderMatch[1]));
  }

  for (let index = 1; index < 10_000; index += 1) {
    if (!used.has(index)) return `${ARCHIVE_DIRECTORY_PREFIX}-${index}`;
  }

  return `${ARCHIVE_DIRECTORY_PREFIX}-${Date.now().toString(36)}`;
}

export function buildStemConstructorPrompt(args: {
  bpm: number;
  constructorId: string;
  values: Record<string, string>;
}): string {
  const constructor = STEM_CONSTRUCTORS.find((item) => item.id === args.constructorId) ?? STEM_CONSTRUCTORS[0];
  const values = constructor.fields
    .map((field) => args.values[field.id]?.trim())
    .filter((value): value is string => Boolean(value));
  const partLabel = constructor.id === "pad" ? "atmospheric pad" : constructor.title.toLocaleLowerCase();
  const parts = [`${args.bpm} BPM`, ...values];
  if (!values.some((value) => value.toLocaleLowerCase().includes(partLabel))) {
    parts.splice(2, 0, partLabel);
  }
  return parts.join(", ");
}
