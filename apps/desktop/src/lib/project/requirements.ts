import {
  barsToSeconds,
  effectiveBlockTimeSignature,
  getRenderDurationIssue,
  makeId,
  stemRequirementHash,
  type RenderDurationIssue,
} from "./format";
import { markStemDependencyChainStale } from "./graph";
import type { ArrangementClip, GenostBlock, GenostProject, GenostStem } from "../schema/project";

export type ComponentRequirement = {
  key: string;
  block: GenostBlock;
  variation: number;
  bars: number;
  durationSeconds: number;
  durationIssue: RenderDurationIssue | null;
  variationAnchor: boolean;
  variationAnchorStatus: GenostStem["status"] | null;
  inputBlockId: string | null;
  inputStemId: string | null;
  inputMissing: boolean;
  clips: ArrangementClip[];
  existingStem: GenostStem | null;
};

export type RequirementRenderState =
  | "missing"
  | "input-missing"
  | "duration-blocked"
  | "graph-cycle-blocked"
  | "validation-failed"
  | GenostStem["status"];

const UNUSABLE_STEM_STATUSES = ["superseded", "archived", "detached"] as const;

function isUsableExistingStem(stem: GenostStem): boolean {
  return !UNUSABLE_STEM_STATUSES.includes(stem.status as (typeof UNUSABLE_STEM_STATUSES)[number]);
}

export function findUsableStemById(
  project: GenostProject,
  stemId: string | null | undefined,
): GenostStem | null {
  if (!stemId) {
    return null;
  }

  const stem = project.stems.find((item) => item.id === stemId);
  return stem && isUsableExistingStem(stem) ? stem : null;
}

function latestReadyStemForBlockVariation(
  project: GenostProject,
  blockId: string,
  variation = 1,
  durationSeconds?: number,
): GenostStem | null {
  return (
    [...project.stems]
      .filter(
        (stem) =>
          stem.blockId === blockId &&
          stem.variation === variation &&
          stem.status === "ready" &&
          (durationSeconds === undefined || Math.abs(stem.durationSeconds - durationSeconds) < 0.15),
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null
  );
}

function latestVariationAnchorStemForBlock(
  project: GenostProject,
  blockId: string,
  durationSeconds: number,
): GenostStem | null {
  const statusPriority: Partial<Record<GenostStem["status"], number>> = {
    rendering: 3,
    queued: 2,
    ready: 1,
  };

  return (
    [...project.stems]
      .filter(
        (stem) =>
          stem.blockId === blockId &&
          stem.variation === 1 &&
          statusPriority[stem.status] !== undefined &&
          Math.abs(stem.durationSeconds - durationSeconds) < 0.15,
      )
      .sort((left, right) => {
        const priorityDifference = (statusPriority[right.status] ?? 0) - (statusPriority[left.status] ?? 0);
        return priorityDifference || right.updatedAt.localeCompare(left.updatedAt);
      })[0] ?? null
  );
}

function findExistingStemForClip(
  project: GenostProject,
  clip: ArrangementClip,
  block: GenostBlock,
  effectiveInputStemId: string | null,
  durationSeconds: number,
): GenostStem | null {
  const pinnedStem = findUsableStemById(project, clip.stemId);

  if (
    pinnedStem?.blockId === block.id &&
    pinnedStem.variation === clip.variation &&
    pinnedStem.inputStemId === effectiveInputStemId &&
    Math.abs(pinnedStem.durationSeconds - durationSeconds) < 0.15
  ) {
    return pinnedStem;
  }

  const stemCandidates = project.stems.filter(
    (stem) =>
      stem.blockId === block.id &&
      stem.variation === clip.variation &&
      stem.inputStemId === effectiveInputStemId &&
      isUsableExistingStem(stem),
  );

  return (
    stemCandidates.find((stem) => Math.abs(stem.durationSeconds - durationSeconds) < 0.15) ??
    stemCandidates.find((stem) => stem.status === "ready") ??
    stemCandidates.find((stem) => stem.status === "stale") ??
    null
  );
}

export function requirementKey(
  blockId: string,
  variation: number,
  bars: number,
  inputBlockId: string | null,
  inputStemId: string | null,
): string {
  return `${blockId}:${variation}:${bars}:${inputBlockId ?? "seed"}:${inputStemId ?? "none"}`;
}

export function collectRequirements(project: GenostProject): ComponentRequirement[] {
  const byKey = new Map<string, ComponentRequirement>();

  for (const clip of project.arrangement.lanes.flatMap((lane) => lane.clips)) {
    const block = project.blocks.find((item) => item.id === clip.blockId);

    if (!block) {
      continue;
    }

    const timeSignature = effectiveBlockTimeSignature(project, block);
    const durationSeconds = barsToSeconds(clip.bars, project.song.bpm, timeSignature[0]);
    const variationAnchor = block.sourceType === "generated" && clip.variation > 1;
    const pinnedInputStem = findUsableStemById(project, clip.inputStemId);
    const sourceStem = variationAnchor
      ? latestVariationAnchorStemForBlock(project, block.id, durationSeconds)
      : pinnedInputStem ?? (clip.inputBlockId ? latestReadyStemForBlockVariation(project, clip.inputBlockId, 1) : null);
    const effectiveInputStemId = variationAnchor
      ? sourceStem?.id ?? null
      : clip.inputStemId ?? (clip.inputBlockId ? sourceStem?.id ?? null : null);
    const durationIssue =
      block.sourceType === "generated"
        ? getRenderDurationIssue({ bars: clip.bars, bpm: project.song.bpm, timeSignature })
        : null;
    const key = requirementKey(block.id, clip.variation, clip.bars, clip.inputBlockId, effectiveInputStemId);
    const existing = byKey.get(key);
    const existingStem = findExistingStemForClip(project, clip, block, effectiveInputStemId, durationSeconds);

    if (existing) {
      existing.clips.push(clip);
      existing.existingStem = existing.existingStem ?? existingStem;
      continue;
    }

    byKey.set(key, {
      key,
      block,
      variation: clip.variation,
      bars: clip.bars,
      durationSeconds,
      durationIssue,
      variationAnchor,
      variationAnchorStatus: variationAnchor ? sourceStem?.status ?? null : null,
      inputBlockId: clip.inputBlockId,
      inputStemId: effectiveInputStemId,
      inputMissing: variationAnchor ? !sourceStem : Boolean((clip.inputBlockId || clip.inputStemId) && !sourceStem),
      clips: [clip],
      existingStem,
    });
  }

  return [...byKey.values()];
}

export function collectRequirementsByClipId(project: GenostProject): Map<string, ComponentRequirement> {
  const byClipId = new Map<string, ComponentRequirement>();

  for (const requirement of collectRequirements(project)) {
    for (const clip of requirement.clips) {
      byClipId.set(clip.id, requirement);
    }
  }

  return byClipId;
}

export function nextQueueOrder(project: GenostProject): number {
  return Math.max(0, ...project.stems.map((stem) => stem.queueOrder ?? 0)) + 1;
}

export function createQueuedStem(
  project: GenostProject,
  requirement: ComponentRequirement,
  queueOrder: number,
): GenostStem {
  const now = new Date().toISOString();
  const seed = Date.now() + queueOrder;
  const promptHash = stemRequirementHash({
    project,
    block: { ...requirement.block, bars: requirement.bars },
    variation: requirement.variation,
    inputStemId: requirement.inputStemId,
    seed,
  });

  return {
    id: makeId("stem"),
    blockId: requirement.block.id,
    variation: requirement.variation,
    inputStemId: requirement.inputStemId,
    model: requirement.inputStemId ? project.song.defaultMelodyModel : project.song.defaultTextModel,
    promptHash,
    seed,
    durationSeconds: requirement.durationSeconds,
    status: "queued",
    queueOrder,
    fileName: `${requirement.block.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_v${String(requirement.variation).padStart(2, "0")}_${promptHash}.wav`,
    filePath: null,
    archivePath: null,
    revisionOfStemId: requirement.existingStem?.id ?? null,
    staleReason: null,
    error: null,
    renderMetadata: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function replaceClipStemIds(
  project: GenostProject,
  clipIds: string[],
  stemId: string,
  inputStemId: string | null,
): GenostProject {
  return {
    ...project,
    arrangement: {
      lanes: project.arrangement.lanes.map((lane) => ({
        ...lane,
        clips: lane.clips.map((clip) => (clipIds.includes(clip.id) ? { ...clip, inputStemId, stemId } : clip)),
      })),
    },
  };
}

function createVariationAnchorRequirement(requirement: ComponentRequirement): ComponentRequirement {
  return {
    ...requirement,
    key: requirementKey(requirement.block.id, 1, requirement.bars, null, null),
    variation: 1,
    variationAnchor: false,
    variationAnchorStatus: null,
    inputBlockId: null,
    inputStemId: null,
    inputMissing: false,
    clips: [],
    existingStem: null,
  };
}

export function queueComponentRequirement(
  project: GenostProject,
  requirement: ComponentRequirement,
  regenerate = false,
): GenostProject {
  if (requirement.block.sourceType === "imported" || requirement.durationIssue) {
    return project;
  }

  const liveRequirements = collectRequirements(project);
  const clipIds = new Set(requirement.clips.map((clip) => clip.id));
  const liveRequirement = liveRequirements.find(
    (item) =>
      item.block.id === requirement.block.id &&
      item.variation === requirement.variation &&
      item.bars === requirement.bars &&
      item.clips.some((clip) => clipIds.has(clip.id)),
  );

  if (!liveRequirement) {
    return project;
  }

  if (liveRequirement.inputMissing && !liveRequirement.variationAnchor) {
    return project;
  }

  if (liveRequirement.durationIssue) {
    return project;
  }

  const queueOrder = nextQueueOrder(project);
  const queuedAnchor = liveRequirement.inputMissing
    ? createQueuedStem(project, createVariationAnchorRequirement(liveRequirement), queueOrder)
    : null;
  const resolvedRequirement = queuedAnchor
    ? {
        ...liveRequirement,
        inputStemId: queuedAnchor.id,
        inputMissing: false,
        variationAnchorStatus: "queued" as const,
        existingStem: null,
      }
    : liveRequirement;
  const queuedStem = createQueuedStem(project, resolvedRequirement, queueOrder + (queuedAnchor ? 1 : 0));
  const supersededStemId = regenerate ? resolvedRequirement.existingStem?.id : null;
  const withUpdatedClips = replaceClipStemIds(
    project,
    resolvedRequirement.clips.map((clip) => clip.id),
    queuedStem.id,
    resolvedRequirement.inputStemId,
  );

  const updated: GenostProject = {
    ...withUpdatedClips,
    stems: [
      ...withUpdatedClips.stems.map((stem) =>
        supersededStemId && stem.id === supersededStemId
          ? { ...stem, status: "superseded" as const, queueOrder: null, updatedAt: new Date().toISOString() }
          : stem,
      ),
      ...(queuedAnchor ? [queuedAnchor] : []),
      queuedStem,
    ],
  };

  return supersededStemId
    ? markStemDependencyChainStale(
        updated,
        [supersededStemId],
        `Input stem ${supersededStemId} was superseded by regeneration.`,
      )
    : updated;
}

export function formatRequirementInput(
  project: GenostProject,
  requirement: ComponentRequirement,
  planningMode: boolean,
): string {
  if (requirement.variationAnchor) {
    if (requirement.inputStemId && requirement.variationAnchorStatus !== "ready") {
      return `${requirement.block.name} v1: ${requirement.variationAnchorStatus ?? "planned"}`;
    }
    return requirement.inputStemId
      ? `${requirement.block.name} v1: ${requirement.inputStemId}`
      : planningMode
        ? `${requirement.block.name} v1: planned`
        : `${requirement.block.name} v1: input missing`;
  }

  if (!requirement.inputBlockId) {
    return "seed";
  }

  const inputBlockName = project.blocks.find((block) => block.id === requirement.inputBlockId)?.name ?? "Detached Block";

  if (requirement.inputStemId) {
    return `${inputBlockName}: ${requirement.inputStemId}`;
  }

  return planningMode ? `${inputBlockName}: planned` : "input missing";
}

export function getRequirementRenderState(args: {
  requirement: ComponentRequirement;
  graphBlocked?: boolean;
}): RequirementRenderState {
  if (args.graphBlocked) {
    return "graph-cycle-blocked";
  }

  if (args.requirement.durationIssue) {
    return "duration-blocked";
  }

  if (args.requirement.inputMissing) {
    return "input-missing";
  }

  const stem = args.requirement.existingStem;

  if (!stem) {
    return "missing";
  }

  if (stem.status === "failed" && /\bvalidation\b/i.test(stem.error ?? "")) {
    return "validation-failed";
  }

  return stem.status;
}

export function formatRequirementRenderState(state: RequirementRenderState): string {
  switch (state) {
    case "duration-blocked":
      return "duration blocked";
    case "graph-cycle-blocked":
      return "graph cycle";
    case "input-missing":
      return "input missing";
    case "validation-failed":
      return "validation failed";
    default:
      return state;
  }
}
