import {
  COMMANDS_SCHEMA_VERSION,
  PROJECT_SCHEMA_VERSION,
  WORKSPACE_SCHEMA_VERSION,
  type CommandEntry,
  type CommandJournal,
  type GenostBlock,
  type GenostProject,
  type SwingFeel,
  type SwingSettings,
  type TimeSignature,
  type WorkspaceMetadata,
} from "../schema/project";

export const PROJECT_FILE_NAME = "genost.json";
export const COMMANDS_FILE_NAME = "commands.json";
export const WORKSPACE_FILE_NAME = "genost-workspace.json";
export const PROJECT_DIRECTORIES = [
  "STEMS",
  "MIXES",
  "REFERENCES",
  "WAVEFORMS",
  "JOBS",
  "ARCHIVE",
] as const;
export const MUSICGEN_SAFE_RENDER_SECONDS = 29;

export type CommandDraft = {
  type: string;
  summary: string;
  payload?: Record<string, unknown>;
  actor?: CommandEntry["actor"];
  source?: CommandEntry["source"];
};

export const SWING_PRESETS: Array<{
  feel: SwingFeel;
  label: string;
  ratio: number;
  help: string;
}> = [
  {
    feel: "straight",
    label: "Straight time",
    ratio: 1,
    help: "1:1, equal eighth notes, 50% / 50%.",
  },
  {
    feel: "soft",
    label: "Soft swing",
    ratio: 1.35,
    help: "Between straight and triplet; useful at faster tempos.",
  },
  {
    feel: "triplet",
    label: "Triplet swing",
    ratio: 2,
    help: "2:1, first eighth takes two-thirds of the beat, 66.7%.",
  },
  {
    feel: "hard",
    label: "Hard swing",
    ratio: 2.5,
    help: "Above 2:1 and up to 3:1 for a sharp dotted lilt.",
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

export function sanitizeProjectFolderName(title: string): string {
  const cleaned = title
    .trim()
    .replace(/[^A-Za-z0-9 _-]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 80);

  return cleaned.length > 0 ? cleaned : "Untitled GENOST Project";
}

export function barsToSeconds(bars: number, bpm: number, beatsPerBar = 4): number {
  return (bars * beatsPerBar * 60) / bpm;
}

export type RenderDurationIssue = {
  bars: number;
  bpm: number;
  beatsPerBar: number;
  beatValue: number;
  durationSeconds: number;
  maxBars: number;
  maxSeconds: number;
};

export function maxRenderableBars(bpm: number, beatsPerBar = 4, maxSeconds = MUSICGEN_SAFE_RENDER_SECONDS): number {
  return Math.floor((maxSeconds * bpm) / (beatsPerBar * 60));
}

export function getRenderDurationIssue(args: {
  bars: number;
  bpm: number;
  timeSignature: TimeSignature;
  maxSeconds?: number;
}): RenderDurationIssue | null {
  const maxSeconds = args.maxSeconds ?? MUSICGEN_SAFE_RENDER_SECONDS;
  const [beatsPerBar, beatValue] = args.timeSignature;
  const durationSeconds = barsToSeconds(args.bars, args.bpm, beatsPerBar);

  if (durationSeconds <= maxSeconds) {
    return null;
  }

  return {
    bars: args.bars,
    bpm: args.bpm,
    beatsPerBar,
    beatValue,
    durationSeconds,
    maxBars: maxRenderableBars(args.bpm, beatsPerBar, maxSeconds),
    maxSeconds,
  };
}

export function formatRenderDurationWarning(subject: string, issue: RenderDurationIssue): string {
  const currentDuration = issue.durationSeconds.toFixed(1);
  const maxDuration = issue.maxSeconds.toFixed(0);
  const meter = `${issue.beatsPerBar}/${issue.beatValue}`;
  const maxBarsText =
    issue.maxBars > 0
      ? `Shorten it to ${issue.maxBars} bar${issue.maxBars === 1 ? "" : "s"} or less, or split it into shorter blocks.`
      : "At this tempo and meter, even one full bar exceeds the safe single-render window.";

  return `${subject} is ${currentDuration}s (${issue.bars} bar${issue.bars === 1 ? "" : "s"} at ${issue.bpm} BPM, ${meter}). GENOST blocks MusicGen renders above ${maxDuration}s. ${maxBarsText}`;
}

export function formatTimeSignature(timeSignature: TimeSignature): string {
  return `${timeSignature[0]}/${timeSignature[1]}`;
}

export function swingPresetForFeel(feel: SwingFeel): SwingSettings {
  const preset = SWING_PRESETS.find((item) => item.feel === feel) ?? SWING_PRESETS[1];
  return {
    feel: preset.feel,
    ratio: preset.ratio,
  };
}

export function formatSwing(swing: SwingSettings): string {
  const firstShare = (swing.ratio / (swing.ratio + 1)) * 100;
  const secondShare = 100 - firstShare;
  const preset = SWING_PRESETS.find((item) => item.feel === swing.feel);

  return `${preset?.label ?? swing.feel} ${swing.ratio.toFixed(2)}:1 (${firstShare.toFixed(1)}% / ${secondShare.toFixed(1)}%)`;
}

export function parseCommaTags(value: string): string[] {
  return normalizeTags(value.split(","));
}

export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const tag of tags) {
    const cleaned = tag.trim().replace(/\s+/g, " ");
    const key = cleaned.toLocaleLowerCase();

    if (!cleaned || seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(cleaned);
  }

  return normalized;
}

export function createWorkspaceMetadata(genreReferences: string[] = []): WorkspaceMetadata {
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    updatedAt: nowIso(),
    genreReferences: normalizeTags(genreReferences),
  };
}

export function mergeGenreReferences(existing: string[], incoming: string[]): string[] {
  return normalizeTags([...existing, ...incoming]).sort((left, right) => left.localeCompare(right));
}

export function buildCompositionPrompt(song: GenostProject["song"]): string {
  return [
    `${song.bpm} BPM`,
    `${formatTimeSignature(song.timeSignature)} time`,
    `swing: ${formatSwing(song.swing)}`,
    song.key,
    song.genreReferences.length > 0 ? `genre references: ${song.genreReferences.join(", ")}` : "",
    song.mood ? `mood: ${song.mood}` : "",
    song.purpose ? `purpose: ${song.purpose}` : "",
    song.referenceNotes ? `references: ${song.referenceNotes}` : "",
    song.referenceTrackName ? `reference track: ${song.referenceTrackName}` : "",
    song.rhythmFeel ? `rhythm feel: ${song.rhythmFeel}` : "",
    song.sonicPalette ? `sonic palette: ${song.sonicPalette}` : "",
    song.productionNotes ? `production notes: ${song.productionNotes}` : "",
    song.arrangementNotes ? `arrangement: ${song.arrangementNotes}` : "",
    song.avoid ? `avoid: ${song.avoid}` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function withGeneratedCompositionPrompt(song: GenostProject["song"]): GenostProject["song"] {
  const normalizedSong = {
    ...song,
    genreReferences: normalizeTags(song.genreReferences),
  };

  return {
    ...normalizedSong,
    prompt: buildCompositionPrompt(normalizedSong),
  };
}

export function getCompositionPromptIssues(song: GenostProject["song"]): string[] {
  const issues: string[] = [];

  if (!Number.isInteger(song.bpm) || song.bpm < 40 || song.bpm > 260) {
    issues.push("BPM");
  }

  if (
    !Number.isInteger(song.timeSignature[0]) ||
    !Number.isInteger(song.timeSignature[1]) ||
    song.timeSignature[0] < 1 ||
    song.timeSignature[1] < 1
  ) {
    issues.push("time signature");
  }

  if (!song.mood.trim()) {
    issues.push("mood");
  }

  if (!song.swing || !Number.isFinite(song.swing.ratio) || song.swing.ratio < 1 || song.swing.ratio > 3) {
    issues.push("swing");
  }

  if (normalizeTags(song.genreReferences).length === 0) {
    issues.push("genre reference");
  }

  return issues;
}

export function getCompositionFieldIssues(song: GenostProject["song"]): string[] {
  const issues: string[] = [];
  if (!Number.isInteger(song.bpm) || song.bpm < 40 || song.bpm > 260) issues.push("BPM must be 40–260");
  const key = song.key.trim();
  if (!key) {
    issues.push("Key is required");
  } else if (!/^[A-G](?:#|b)?(?:\s+(?:major|minor|ionian|dorian|phrygian|lydian|mixolydian|aeolian|locrian))?$/i.test(key)) {
    issues.push("Key must look like D minor or A Phrygian");
  }
  const cache = song.modelCachePath.trim();
  if (cache && !/^(?:\/|[A-Za-z]:[\\/])/.test(cache)) issues.push("Model cache path must be absolute");
  return issues;
}

export function effectiveBlockTimeSignature(project: GenostProject, block: GenostBlock): TimeSignature {
  return block.timeSignature ?? project.song.timeSignature;
}

function blockPromptText(block: GenostBlock): string {
  return [
    block.name,
    block.role,
    block.melodyDescription,
    block.melodyPrompt,
    block.rhythmFeel,
    block.timbre,
    ...block.instruments,
  ]
    .join(" ")
    .toLocaleLowerCase();
}

function instrumentFocusInstruction(block: GenostBlock): string {
  const instruments = normalizeTags(block.instruments);

  if (instruments.length === 0) {
    return "generate one isolated arrangement stem, not a complete backing track";
  }

  const text = blockPromptText(block);
  const excluded = new Set<string>();
  const addExcluded = (items: string[]) => items.forEach((item) => excluded.add(item));

  if (/\b(bass|sub|reese|low end)\b/.test(text)) {
    addExcluded(["kick drums", "snare", "hi-hats", "percussion loops", "synth pads", "lead melodies"]);
  } else if (/\b(drum|drums|kick|snare|hat|hats|break|percussion|perc|tom|toms)\b/.test(text)) {
    addExcluded(["basslines", "sub bass", "synth pads", "chord progressions", "lead melodies", "choirs"]);
  } else if (/\b(pad|chord|chords|harmony|harmonic|atmosphere|atmospheric|drone)\b/.test(text)) {
    addExcluded(["kick drums", "snare", "hi-hats", "percussion loops", "basslines", "lead riffs"]);
  } else if (/\b(lead|melody|melodic|hook|arp|arpeggio|bell|pluck|guitar)\b/.test(text)) {
    addExcluded(["kick drums", "snare", "hi-hats", "full drum kit", "basslines", "pad washes"]);
  } else if (/\b(choir|voice|vocal)\b/.test(text)) {
    addExcluded(["lyrics", "kick drums", "snare", "basslines", "lead synths"]);
  } else {
    addExcluded(["full drum kit", "basslines", "lead melodies", "extra instruments"]);
  }

  return `isolated stem target: ${instruments.join(", ")} only; keep unrelated arrangement parts out; avoid ${[
    ...excluded,
  ].join(", ")}`;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}

export function hashString(value: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function hashProject(project: GenostProject): string {
  return hashString(stableStringify(project));
}

export function createCommandEntry(
  draft: CommandDraft,
  beforeHash?: string,
  afterHash?: string,
): CommandEntry {
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

export function createCommandJournal(projectId: string, firstCommand?: CommandEntry): CommandJournal {
  const createdAt = nowIso();
  return {
    schemaVersion: COMMANDS_SCHEMA_VERSION,
    projectId,
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

export function createEmptyProject(title: string): GenostProject {
  const createdAt = nowIso();
  const blockId = makeId("block");
  const song = withGeneratedCompositionPrompt({
    prompt: "",
    bpm: 170,
    key: "D minor",
    timeSignature: [4, 3],
    swing: swingPresetForFeel("soft"),
    mood: "nocturnal, focused, tense",
    referenceNotes: "90s intelligent jungle atmosphere, dry club techno pressure",
    purpose: "Build a local-first stem set for a focused DAW-style arrangement",
    avoid: "cheesy EDM drops, vocals, bright festival leads, muddy low end",
    genreReferences: ["techno", "intelligent jungle", "dub techno"],
    rhythmFeel: "rolling, syncopated, controlled swing, machine-tight pulse",
    sonicPalette: "cold graphite synths, tape hiss, sub pressure, restrained metallic percussion",
    productionNotes: "clean low end, spacious but not washed out, strong transient readability",
    arrangementNotes: "16-bar loop sections with evolving filter movement and room for layered stems",
    referenceTrackPath: null,
    referenceTrackName: null,
    sampleRate: 32000,
    defaultTextModel: "facebook/musicgen-medium",
    defaultMelodyModel: "facebook/musicgen-melody",
    modelCachePath: "",
  });

  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: makeId("project"),
    title: title.trim() || "Untitled GENOST Project",
    createdAt,
    updatedAt: createdAt,
    song,
    blocks: [
      {
        id: blockId,
        name: "Seed Atmosphere",
        bars: 16,
        timeSignature: null,
        role: "harmonic atmosphere",
        instruments: ["textured synth pad", "subtle noise bed"],
        separatorTarget: "other",
        validationCategory: "bass_drone",
        soundCharacter: "clean",
        sourceType: "generated",
        importedStemId: null,
        melodyDescription: "Evolving minor atmosphere",
        melodyPrompt: "dark atmospheric techno pad, evolving minor harmony, restrained transient detail",
        rhythmFeel: "slow filter movement over the project pulse",
        timbre: "dusty wavetable pad, light tape saturation, low-pass movement",
        energy: 5,
        density: 4,
        avoid: "busy lead riffs, obvious chord stabs, vocal hooks",
        volumeDb: -6,
        delaySend: 0.15,
        reverbSend: 0.25,
        compressorEnabled: false,
        implementedMelodies: [],
      },
    ],
    arrangement: {
      lanes: [
        {
          id: makeId("lane"),
          name: "Layer 1",
          clips: [
            {
              id: makeId("clip"),
              blockId,
              variation: 1,
              startBar: 0,
              bars: 16,
              inputBlockId: null,
              inputStemId: null,
              stemId: null,
            },
          ],
        },
      ],
    },
    stems: [],
    separationBundles: [],
    mix: {
      masterDelay: 0,
      masterDelayEnabled: true,
      masterDelayTimeMs: 375,
      masterDelayFeedback: 0.28,
      masterDelayFilterHz: 6200,
      masterReverb: 0,
      masterReverbEnabled: true,
      masterReverbDecaySeconds: 4.5,
      masterReverbPreDelayMs: 24,
      masterReverbDampeningHz: 7800,
      masterLimiter: true,
      masterLimiterThresholdDb: -1,
      masterLimiterReleaseMs: 120,
      outputGainDb: 0,
      lastBuildPath: null,
    },
    roadmap: {
      nextPriority: "MIDI and chord progression support",
    },
  };
}

export function composeStemPrompt(project: GenostProject, block: GenostBlock, variation: number): string {
  const timeSignature = effectiveBlockTimeSignature(project, block);

  return [
    `block: ${block.name}`,
    block.role ? `role: ${block.role}` : "",
    instrumentFocusInstruction(block),
    `${project.song.bpm} BPM`,
    `global swing: ${formatSwing(project.song.swing)}`,
    `${formatTimeSignature(timeSignature)} block time`,
    project.song.key,
    `variation ${variation}`,
    `target instruments: ${block.instruments.join(", ")}`,
    `sound character: ${block.soundCharacter}`,
    block.melodyDescription,
    block.melodyPrompt,
    block.rhythmFeel ? `rhythm feel: ${block.rhythmFeel}` : "",
    block.timbre ? `timbre: ${block.timbre}` : "",
    `energy ${block.energy}/10`,
    `density ${block.density}/10`,
    block.avoid ? `avoid in this block: ${block.avoid}` : "",
    project.song.avoid ? `song avoid list: ${project.song.avoid}` : "",
    `project context: ${project.song.prompt}`,
  ]
    .filter(Boolean)
    .join("; ");
}

export function composeVariationStemPrompt(
  project: GenostProject,
  block: GenostBlock,
  variation: number,
): string {
  const requirements = composeStemPrompt(project, block, variation);

  return `recognizable variation of supplied v1; retain melody, harmony, tempo, meter, groove, timing, instrument family, isolation, and exclusions; vary performance, voicing, articulation, and texture; requirements: ${requirements}`;
}

export function stemRequirementHash(args: {
  project: GenostProject;
  block: GenostBlock;
  variation: number;
  inputStemId: string | null;
  seed: number;
}): string {
  return hashString(
    stableStringify({
      promptCompositionVersion: 3,
      projectPrompt: args.project.song.prompt,
      bpm: args.project.song.bpm,
      key: args.project.song.key,
      swing: args.project.song.swing,
      timeSignature: effectiveBlockTimeSignature(args.project, args.block),
      sampleRate: args.project.song.sampleRate,
      referenceTrackPath: args.project.song.referenceTrackPath,
      block: {
        id: args.block.id,
        sourceType: args.block.sourceType,
        importedStemId: args.block.importedStemId,
        bars: args.block.bars,
        timeSignature: args.block.timeSignature,
        role: args.block.role,
        instruments: args.block.instruments,
        soundCharacter: args.block.soundCharacter,
        melodyDescription: args.block.melodyDescription,
        melodyPrompt: args.block.melodyPrompt,
        rhythmFeel: args.block.rhythmFeel,
        timbre: args.block.timbre,
        energy: args.block.energy,
        density: args.block.density,
        avoid: args.block.avoid,
        volumeDb: args.block.volumeDb,
        delaySend: args.block.delaySend,
        reverbSend: args.block.reverbSend,
        compressorEnabled: args.block.compressorEnabled,
      },
      variation: args.variation,
      inputStemId: args.inputStemId,
      seed: args.seed,
    }),
  );
}
