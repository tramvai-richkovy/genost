import type {
  CSSProperties,
  DragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from "react";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Copy, EllipsisVertical, FastForward, Layers, LoaderCircle, Pause, Play, Rewind, Scissors, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { useStudioStore } from "../../app/store";
import {
  barsToSeconds,
  effectiveBlockTimeSignature,
  formatRenderDurationWarning,
  formatTimeSignature,
  getRenderDurationIssue,
  makeId,
} from "../../lib/project/format";
import { collectDownstreamBlockIds, findBlockGraphCycle, latestReadyStemForBlock, markBlocksStale } from "../../lib/project/graph";
import {
  collectRequirementsByClipId,
  formatRequirementRenderState,
  getRequirementRenderState,
  type RequirementRenderState,
} from "../../lib/project/requirements";
import type { ArrangementClip, GenostBlock, GenostProject } from "../../lib/schema/project";
import { ArrangerRealtimePreview } from "../../lib/audio/realtimePreview";
import { WaveformPreview } from "../../lib/audio/WaveformPreview";
import { resolveProjectAssetPath } from "../../lib/audio/paths";

const BAR_WIDTH = 44;
const MIN_BAR_WIDTH = 32;
const MAX_BAR_WIDTH = 240;
const BAR_WIDTH_STEP = 16;
const DRAG_MIME = "application/genost-arranger";
const NEW_LAYER_DROP_ID = "__new_layer__";
const VARIATION_COUNT = 16;
const BLOCK_KIND_COLORS = {
  bass: "#38bdf8",
  drums: "#facc15",
  fx: "#2dd4bf",
  harmony: "var(--color-genost-violet)",
  imported: "var(--color-genost-muted)",
  melodic: "#f472b6",
  texture: "var(--color-genost-acid)",
  default: "var(--color-genost-cyan)",
} as const;

type DragPayload =
  | {
      kind: "block";
      blockId: string;
      grabOffsetBars: number;
    }
  | {
      kind: "clip";
      clipId: string;
      sourceLaneId: string;
      grabOffsetBars: number;
    };

type DragPreview = {
  laneId: string;
  startBar: number;
  bars: number;
};

type ResizeEdge = "left" | "right";

type ResizeState = {
  clipId: string;
  blockId: string;
  variation: number;
  edge: ResizeEdge;
  startClientX: number;
  originalStartBar: number;
  originalBars: number;
};

type ResizeGeometry = {
  startBar: number;
  bars: number;
};

type ResizePreview = ResizeGeometry & {
  clipId: string;
  blockId: string;
  variation: number;
};

type ClipPlacement = {
  laneId: string | null;
  startBar: number;
};

type SplitPlan = {
  firstBars: number;
  secondBars: number;
  secondVariation: number;
};

type BlockKind = keyof typeof BLOCK_KIND_COLORS;

type BlockAccentStyle = CSSProperties & {
  "--bar-width"?: string;
  "--block-color"?: string;
};

function serializeDragPayload(payload: DragPayload): string {
  return JSON.stringify(payload);
}

function parseDragPayload(event: DragEvent): DragPayload | null {
  try {
    const raw = event.dataTransfer.getData(DRAG_MIME);
    return raw ? (JSON.parse(raw) as DragPayload) : null;
  } catch {
    return null;
  }
}

export function getSnappedStartBarFromLocalX(
  localX: number,
  grabOffsetBars: number,
  barWidth = BAR_WIDTH,
): number {
  return Math.max(0, Math.round(localX / barWidth - grabOffsetBars));
}

export function getNextTimelineBarWidth(current: number, direction: "in" | "out"): number {
  const delta = direction === "in" ? BAR_WIDTH_STEP : -BAR_WIDTH_STEP;
  return Math.min(MAX_BAR_WIDTH, Math.max(MIN_BAR_WIDTH, current + delta));
}

function blockKind(block: GenostBlock): BlockKind {
  if (block.sourceType === "imported") {
    return "imported";
  }

  const text = [block.name, block.role, block.rhythmFeel, block.melodyDescription, ...block.instruments]
    .join(" ")
    .toLocaleLowerCase();

  if (/\b(bass|sub|reese|low end)\b/.test(text)) {
    return "bass";
  }

  if (/\b(drum|drums|kick|snare|hat|hats|break|percussion|perc)\b/.test(text)) {
    return "drums";
  }

  if (/\b(pad|chord|chords|harmony|harmonic|atmosphere|atmospheric)\b/.test(text)) {
    return "harmony";
  }

  if (/\b(lead|melody|melodic|hook|arp|arpeggio)\b/.test(text)) {
    return "melodic";
  }

  if (/\b(texture|noise|field|bed|drone)\b/.test(text)) {
    return "texture";
  }

  if (/\b(fx|effect|riser|impact|sweep)\b/.test(text)) {
    return "fx";
  }

  return "default";
}

function blockAccentStyle(block: GenostBlock | null | undefined): BlockAccentStyle {
  return {
    "--block-color": block ? BLOCK_KIND_COLORS[blockKind(block)] : BLOCK_KIND_COLORS.default,
  };
}

function clipStatusClass(state: RequirementRenderState): string {
  if (state === "ready") {
    return "ready";
  }

  return [
    "duration-blocked",
    "graph-cycle-blocked",
    "input-missing",
    "validation-failed",
    "failed",
    "stale",
  ].includes(state)
    ? "warning"
    : "";
}

export function getResizedClipGeometry(args: {
  edge: ResizeEdge;
  originalStartBar: number;
  originalBars: number;
  deltaBars: number;
  minBars?: number;
  maxBars?: number;
}): ResizeGeometry {
  const minBars = args.minBars ?? 1;
  const maxBars = args.maxBars ?? 64;

  if (args.edge === "right") {
    return {
      startBar: args.originalStartBar,
      bars: Math.min(maxBars, Math.max(minBars, args.originalBars + args.deltaBars)),
    };
  }

  const minDelta = Math.max(-args.originalStartBar, args.originalBars - maxBars);
  const maxDelta = args.originalBars - minBars;
  const deltaBars = Math.min(maxDelta, Math.max(minDelta, args.deltaBars));

  return {
    startBar: args.originalStartBar + deltaBars,
    bars: args.originalBars - deltaBars,
  };
}

function getTrackElement(event: DragEvent<HTMLElement>): HTMLElement {
  return event.currentTarget.querySelector<HTMLElement>(".timeline-track") ?? event.currentTarget;
}

function getSnappedStartBar(event: DragEvent<HTMLElement>, payload: DragPayload, barWidth = BAR_WIDTH): number {
  const trackElement = getTrackElement(event);
  const rect = trackElement.getBoundingClientRect();
  const scrollLeft = trackElement.scrollLeft;
  const localX = event.clientX - rect.left + scrollLeft;
  return getSnappedStartBarFromLocalX(localX, payload.grabOffsetBars, barWidth);
}

function sortClips(clips: ArrangementClip[]): ArrangementClip[] {
  return [...clips].sort((left, right) => left.startBar - right.startBar || left.id.localeCompare(right.id));
}

function clipRangesOverlap(
  left: Pick<ArrangementClip, "startBar" | "bars">,
  right: Pick<ArrangementClip, "startBar" | "bars">,
): boolean {
  return left.startBar < right.startBar + right.bars && right.startBar < left.startBar + left.bars;
}

function laneHasSpaceForClip(
  lane: { clips: ArrangementClip[] },
  startBar: number,
  bars: number,
  ignoredClipId?: string,
): boolean {
  const candidate = { startBar, bars };

  return !lane.clips.some((clip) => clip.id !== ignoredClipId && clipRangesOverlap(candidate, clip));
}

export function getClonePlacement(project: GenostProject, sourceLaneId: string, clipId: string): ClipPlacement | null {
  const sourceLane = project.arrangement.lanes.find((lane) => lane.id === sourceLaneId);
  const sourceClip = sourceLane?.clips.find((clip) => clip.id === clipId);

  if (!sourceLane || !sourceClip) {
    return null;
  }

  const startBar = sourceClip.startBar + sourceClip.bars;

  return laneHasSpaceForClip(sourceLane, startBar, sourceClip.bars)
    ? { laneId: sourceLane.id, startBar }
    : { laneId: null, startBar };
}

function getUsedVariationsForBlock(project: GenostProject, blockId: string): Set<number> {
  return new Set(
    project.arrangement.lanes
      .flatMap((lane) => lane.clips)
      .filter((clip) => clip.blockId === blockId)
      .map((clip) => clip.variation),
  );
}

export function getNextUnassignedVariation(usedVariations: Iterable<number>, currentVariation: number): number | null {
  const used = new Set(usedVariations);
  const candidates = [
    ...Array.from({ length: VARIATION_COUNT - currentVariation }, (_, index) => currentVariation + index + 1),
    ...Array.from({ length: currentVariation - 1 }, (_, index) => index + 1),
  ];

  return candidates.find((variation) => !used.has(variation)) ?? null;
}

export function getSplitPlan(args: {
  bars: number;
  currentVariation: number;
  usedVariations: Iterable<number>;
}): SplitPlan | null {
  const firstBars = Math.floor(args.bars / 2);

  if (firstBars < 1) {
    return null;
  }

  const secondBars = args.bars - firstBars;

  if (firstBars === secondBars) {
    return {
      firstBars,
      secondBars,
      secondVariation: args.currentVariation,
    };
  }

  const secondVariation = getNextUnassignedVariation(args.usedVariations, args.currentVariation);

  return secondVariation
    ? {
        firstBars,
        secondBars,
        secondVariation,
      }
    : null;
}

function getVariationBars(
  project: GenostProject,
  blockId: string,
  variation: number,
  fallback: number,
): number {
  return (
    project.arrangement.lanes.flatMap((lane) => lane.clips).find((clip) => clip.blockId === blockId && clip.variation === variation)
      ?.bars ?? fallback
  );
}

function withResizedVariation(
  project: GenostProject,
  resize: ResizeState,
  geometry: ResizeGeometry,
): GenostProject {
  const now = new Date().toISOString();
  const updated: GenostProject = {
    ...project,
    arrangement: {
      lanes: project.arrangement.lanes.map((lane) => ({
        ...lane,
        clips: sortClips(
          lane.clips.map((clip) => {
            if (clip.blockId !== resize.blockId || clip.variation !== resize.variation) {
              return clip;
            }

            return {
              ...clip,
              bars: geometry.bars,
              startBar: clip.id === resize.clipId ? geometry.startBar : clip.startBar,
              stemId: null,
            };
          }),
        ),
      })),
    },
    stems: project.stems.map((stem) =>
      stem.blockId === resize.blockId && stem.variation === resize.variation && ["queued", "rendering", "ready"].includes(stem.status)
        ? {
            ...stem,
            status: "stale" as const,
            queueOrder: null,
            staleReason: "Variation length changed; archive as prior revision before rerender.",
            updatedAt: now,
          }
        : stem,
    ),
  };
  const downstreamBlockIds = collectDownstreamBlockIds(updated, [resize.blockId]).filter((blockId) => blockId !== resize.blockId);

  return downstreamBlockIds.length > 0
    ? markBlocksStale(updated, downstreamBlockIds, "Input variation length changed.")
    : updated;
}

function withClonedClip(
  project: GenostProject,
  sourceLaneId: string,
  clipId: string,
  clonedClipId: string,
  newLaneId: string,
): GenostProject {
  const placement = getClonePlacement(project, sourceLaneId, clipId);
  const sourceClip = project.arrangement.lanes
    .find((lane) => lane.id === sourceLaneId)
    ?.clips.find((clip) => clip.id === clipId);

  if (!placement || !sourceClip) {
    return project;
  }

  const clonedClip: ArrangementClip = {
    ...sourceClip,
    id: clonedClipId,
    startBar: placement.startBar,
  };

  if (!placement.laneId) {
    return {
      ...project,
      arrangement: {
        lanes: [
          ...project.arrangement.lanes,
          {
            id: newLaneId,
            name: `Layer ${project.arrangement.lanes.length + 1}`,
            clips: [clonedClip],
          },
        ],
      },
    };
  }

  return {
    ...project,
    arrangement: {
      lanes: project.arrangement.lanes.map((lane) =>
        lane.id === placement.laneId ? { ...lane, clips: sortClips([...lane.clips, clonedClip]) } : lane,
      ),
    },
  };
}

function withDeletedClip(project: GenostProject, clipId: string): GenostProject {
  return {
    ...project,
    arrangement: {
      lanes: project.arrangement.lanes.map((lane) => ({
        ...lane,
        clips: lane.clips.filter((clip) => clip.id !== clipId),
      })),
    },
  };
}

function withSplitVariation(
  project: GenostProject,
  blockId: string,
  variation: number,
  splitPlan: SplitPlan,
): GenostProject {
  const now = new Date().toISOString();
  const affectedVariations = new Set([variation, splitPlan.secondVariation]);
  const updated: GenostProject = {
    ...project,
    arrangement: {
      lanes: project.arrangement.lanes.map((lane) => ({
        ...lane,
        clips: sortClips(
          lane.clips.flatMap((clip) => {
            if (clip.blockId !== blockId || clip.variation !== variation) {
              return [clip];
            }

            return [
              {
                ...clip,
                bars: splitPlan.firstBars,
                stemId: null,
              },
              {
                ...clip,
                id: makeId("clip"),
                startBar: clip.startBar + splitPlan.firstBars,
                bars: splitPlan.secondBars,
                variation: splitPlan.secondVariation,
                stemId: null,
              },
            ];
          }),
        ),
      })),
    },
    stems: project.stems.map((stem) =>
      stem.blockId === blockId && affectedVariations.has(stem.variation) && ["queued", "rendering", "ready"].includes(stem.status)
        ? {
            ...stem,
            status: "stale" as const,
            queueOrder: null,
            staleReason: "Variation was split; archive as prior revision before rerender.",
            updatedAt: now,
          }
        : stem,
    ),
  };
  const downstreamBlockIds = collectDownstreamBlockIds(updated, [blockId]).filter((downstreamBlockId) => downstreamBlockId !== blockId);

  return downstreamBlockIds.length > 0
    ? markBlocksStale(updated, downstreamBlockIds, "Input variation was split.")
    : updated;
}

export function ArrangerTab() {
  const activeProject = useStudioStore((state) => state.activeProject);
  const mutateActiveProject = useStudioStore((state) => state.mutateActiveProject);
  const [draggingPayload, setDraggingPayload] = useState<DragPayload | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);
  const [resizePreview, setResizePreview] = useState<ResizePreview | null>(null);
  const [openActionsClipId, setOpenActionsClipId] = useState<string | null>(null);
  const [timelineBarWidth, setTimelineBarWidth] = useState(BAR_WIDTH);
  const previewRef = useRef<ArrangerRealtimePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewPosition, setPreviewPosition] = useState(0);
  const [previewDuration, setPreviewDuration] = useState(0);
  const [previewPlayableCount, setPreviewPlayableCount] = useState<number | null>(null);
  const [previewSkippedClips, setPreviewSkippedClips] = useState<Array<{ clipId: string; blockId: string; reason: string }>>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (previewPlaying && previewRef.current) {
        setPreviewPosition(Math.min(previewRef.current.durationSeconds, previewRef.current.positionSeconds));
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [previewPlaying]);

  useEffect(() => {
    previewRef.current?.dispose();
    previewRef.current = null;
    setPreviewLoading(false);
    setPreviewPlaying(false);
    setPreviewPosition(0);
    setPreviewDuration(0);
    setPreviewPlayableCount(null);
    setPreviewSkippedClips([]);
    setPreviewError(null);

    return () => {
      previewRef.current?.dispose();
      previewRef.current = null;
    };
  }, [activeProject?.project.id, activeProject?.project.updatedAt]);

  useEffect(() => {
    if (!resizeState || !activeProject) {
      return undefined;
    }

    const activeResize = resizeState;

    function geometryFromClientX(clientX: number): ResizeGeometry {
      return getResizedClipGeometry({
        edge: activeResize.edge,
        originalStartBar: activeResize.originalStartBar,
        originalBars: activeResize.originalBars,
        deltaBars: Math.round((clientX - activeResize.startClientX) / timelineBarWidth),
      });
    }

    function handlePointerMove(event: PointerEvent) {
      event.preventDefault();
      const geometry = geometryFromClientX(event.clientX);
      setResizePreview({
        ...geometry,
        clipId: activeResize.clipId,
        blockId: activeResize.blockId,
        variation: activeResize.variation,
      });
    }

    function handlePointerUp(event: PointerEvent) {
      const geometry = geometryFromClientX(event.clientX);
      setResizeState(null);
      setResizePreview(null);

      if (geometry.bars === activeResize.originalBars && geometry.startBar === activeResize.originalStartBar) {
        return;
      }

      mutateActiveProject(
        {
          type: "resize_block_variation",
          summary: "Resized block variation",
          payload: {
            blockId: activeResize.blockId,
            variation: activeResize.variation,
            clipId: activeResize.clipId,
            edge: activeResize.edge,
            startBar: geometry.startBar,
            bars: geometry.bars,
          },
        },
        (current) => withResizedVariation(current, activeResize, geometry),
      );
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    window.addEventListener("pointercancel", handlePointerUp, { once: true });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [activeProject, mutateActiveProject, resizeState, timelineBarWidth]);

  if (!activeProject) {
    return null;
  }

  const { project, path: projectPath } = activeProject;
  const requirementsByClipId = collectRequirementsByClipId(project);
  const hasGraphCycle = Boolean(findBlockGraphCycle(project));
  const timelineBars = Math.max(
    64,
    ...project.blocks.map((block) => block.bars + 4),
    ...project.arrangement.lanes.flatMap((lane) => lane.clips.map((clip) => clip.startBar + clip.bars + 4)),
    resizePreview ? resizePreview.startBar + resizePreview.bars + 4 : 0,
  );
  const timelineWidth = 120 + timelineBars * timelineBarWidth;
  const previewBarPosition =
    previewDuration > 0 && project.song.bpm > 0
      ? previewPosition / barsToSeconds(1, project.song.bpm, project.song.timeSignature[0])
      : 0;

  async function ensurePreview(): Promise<ArrangerRealtimePreview | null> {
    if (previewRef.current) return previewRef.current;
    if (!projectPath) {
      setPreviewError("Realtime preview requires a project saved on disk.");
      return null;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const preview = await ArrangerRealtimePreview.create(projectPath, project, () => {
        setPreviewPlaying(false);
        setPreviewPosition(0);
      });
      previewRef.current = preview;
      setPreviewDuration(preview.durationSeconds);
      setPreviewPlayableCount(preview.playableClipCount);
      setPreviewSkippedClips(preview.skippedClips);
      return preview;
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setPreviewLoading(false);
    }
  }

  async function playPreview() {
    const preview = await ensurePreview();
    if (!preview) return;
    if (preview.playableClipCount === 0) {
      setPreviewError(preview.skippedClips.length > 0 ? "No ready stems are available for arranger preview." : "No clips are arranged for preview.");
      return;
    }
    const started = preview.play(previewPosition);
    setPreviewPlaying(started);
    if (!started) {
      setPreviewPosition(0);
    }
  }

  function pausePreview() {
    if (!previewRef.current) return;
    setPreviewPosition(previewRef.current.pause());
    setPreviewPlaying(false);
  }

  function seekPreview(delta: number) {
    if (!previewRef.current) {
      setPreviewPosition(Math.max(0, previewPosition + delta));
      return;
    }
    setPreviewPosition(previewRef.current.seek(previewPosition + delta, previewPlaying));
  }

  function startBlockDrag(event: DragEvent, block: GenostBlock) {
    const payload: DragPayload = { kind: "block", blockId: block.id, grabOffsetBars: 0 };
    setDraggingPayload(payload);
    event.dataTransfer.setData(DRAG_MIME, serializeDragPayload(payload));
    event.dataTransfer.effectAllowed = "copy";
  }

  function startClipDrag(event: DragEvent<HTMLElement>, clipId: string, sourceLaneId: string) {
    const rect = event.currentTarget.getBoundingClientRect();
    const grabOffsetBars = Math.max(0, (event.clientX - rect.left) / timelineBarWidth);
    const payload: DragPayload = { kind: "clip", clipId, sourceLaneId, grabOffsetBars };
    setDraggingPayload(payload);
    event.dataTransfer.setData(DRAG_MIME, serializeDragPayload(payload));
    event.dataTransfer.effectAllowed = "move";
  }

  function clearDragState() {
    setDraggingPayload(null);
    setDragPreview(null);
  }

  function startClipResize(event: ReactPointerEvent<HTMLElement>, clip: ArrangementClip, edge: ResizeEdge) {
    event.preventDefault();
    event.stopPropagation();
    setDraggingPayload(null);
    setDragPreview(null);
    setResizeState({
      clipId: clip.id,
      blockId: clip.blockId,
      variation: clip.variation,
      edge,
      startClientX: event.clientX,
      originalStartBar: clip.startBar,
      originalBars: clip.bars,
    });
    setResizePreview({
      clipId: clip.id,
      blockId: clip.blockId,
      variation: clip.variation,
      startBar: clip.startBar,
      bars: clip.bars,
    });
  }

  function setClipVariation(clip: ArrangementClip, variation: number) {
    if (variation === clip.variation) {
      return;
    }

    const bars = getVariationBars(project, clip.blockId, variation, clip.bars);

    mutateActiveProject(
      {
        type: "set_clip_variation",
        summary: "Updated clip variation",
        payload: { clipId: clip.id, variation, bars },
      },
      (current) => ({
        ...current,
        arrangement: {
          lanes: current.arrangement.lanes.map((currentLane) => ({
            ...currentLane,
            clips: currentLane.clips.map((currentClip) =>
              currentClip.id === clip.id
                ? {
                    ...currentClip,
                    variation,
                    bars: getVariationBars(current, currentClip.blockId, variation, currentClip.bars),
                    stemId: null,
                  }
                : currentClip,
            ),
          })),
        },
      }),
    );
  }

  function cloneClip(sourceLaneId: string, clip: ArrangementClip) {
    const placement = getClonePlacement(project, sourceLaneId, clip.id);
    const clonedClipId = makeId("clip");
    const newLaneId = makeId("lane");

    setOpenActionsClipId(null);

    mutateActiveProject(
      {
        type: "clone_arranger_clip",
        summary: "Cloned arranger clip",
        payload: {
          clipId: clip.id,
          clonedClipId,
          blockId: clip.blockId,
          variation: clip.variation,
          bars: clip.bars,
          startBar: placement?.startBar ?? clip.startBar + clip.bars,
          targetLaneId: placement?.laneId ?? newLaneId,
        },
      },
      (current) => withClonedClip(current, sourceLaneId, clip.id, clonedClipId, newLaneId),
    );
  }

  function splitClipVariation(clip: ArrangementClip, splitPlan: SplitPlan) {
    setOpenActionsClipId(null);

    mutateActiveProject(
      {
        type: "split_block_variation",
        summary: "Split block variation",
        payload: {
          sourceClipId: clip.id,
          blockId: clip.blockId,
          variation: clip.variation,
          firstBars: splitPlan.firstBars,
          secondBars: splitPlan.secondBars,
          secondVariation: splitPlan.secondVariation,
        },
      },
      (current) => {
        const liveClip = current.arrangement.lanes.flatMap((lane) => lane.clips).find((item) => item.id === clip.id);

        if (!liveClip) {
          return current;
        }

        const livePlan = getSplitPlan({
          bars: liveClip.bars,
          currentVariation: liveClip.variation,
          usedVariations: getUsedVariationsForBlock(current, liveClip.blockId),
        });

        return livePlan ? withSplitVariation(current, liveClip.blockId, liveClip.variation, livePlan) : current;
      },
    );
  }

  function deleteClip(clip: ArrangementClip) {
    setOpenActionsClipId(null);

    mutateActiveProject(
      {
        type: "remove_arranger_clip",
        summary: "Removed arranger clip",
        payload: { clipId: clip.id },
      },
      (current) => withDeletedClip(current, clip.id),
    );
  }

  function zoomTimeline(direction: "in" | "out") {
    setTimelineBarWidth((current) => getNextTimelineBarWidth(current, direction));
  }

  function handleTimelineWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }

    event.preventDefault();
    zoomTimeline(event.deltaY < 0 ? "in" : "out");
  }

  function handleTimelineKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "PageUp" && event.key !== "PageDown") {
      return;
    }

    event.preventDefault();
    zoomTimeline(event.key === "PageUp" ? "in" : "out");
  }

  function payloadFromEvent(event: DragEvent): DragPayload | null {
    return draggingPayload ?? parseDragPayload(event);
  }

  function getPayloadBars(payload: DragPayload): number | null {
    if (payload.kind === "block") {
      const block = project.blocks.find((item) => item.id === payload.blockId);
      return block ? getVariationBars(project, block.id, 1, block.bars) : null;
    }

    return (
      project.arrangement.lanes
        .flatMap((lane) => lane.clips)
        .find((clip) => clip.id === payload.clipId)?.bars ?? null
    );
  }

  function updateDragPreview(event: DragEvent<HTMLElement>, laneId: string) {
    const payload = payloadFromEvent(event);

    if (!payload) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = payload.kind === "block" ? "copy" : "move";

    const bars = getPayloadBars(payload);

    if (!bars) {
      return;
    }

    const nextPreview = {
      laneId,
      startBar: getSnappedStartBar(event, payload, timelineBarWidth),
      bars,
    };

    setDragPreview((current) =>
      current?.laneId === nextPreview.laneId &&
      current.startBar === nextPreview.startBar &&
      current.bars === nextPreview.bars
        ? current
        : nextPreview,
    );
  }

  function clearLanePreview(event: DragEvent<HTMLElement>, laneId: string) {
    const nextTarget = event.relatedTarget;

    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }

    setDragPreview((current) => (current?.laneId === laneId ? null : current));
  }

  function handleDrop(event: DragEvent<HTMLElement>, laneId: string | null) {
    event.preventDefault();
    const payload = payloadFromEvent(event);

    if (!payload) {
      return;
    }

    const startBar = getSnappedStartBar(event, payload, timelineBarWidth);
    const isNewLayer = laneId === null;

    if (payload.kind === "block") {
      const block = project.blocks.find((item) => item.id === payload.blockId);

      if (!block) {
        clearDragState();
        return;
      }

      const bars = getVariationBars(project, block.id, 1, block.bars);

      mutateActiveProject(
        {
          type: "add_arranger_clip",
          summary: "Added arranger clip",
          payload: { blockId: block.id, laneId: laneId ?? "new", startBar, bars, variation: 1 },
        },
        (current) => {
          const liveBlock = current.blocks.find((item) => item.id === block.id);

          if (!liveBlock) {
            return current;
          }

          const liveBars = getVariationBars(current, liveBlock.id, 1, liveBlock.bars);
          const clip: ArrangementClip = {
            id: makeId("clip"),
            blockId: liveBlock.id,
            variation: 1,
            startBar,
            bars: liveBars,
            inputBlockId: null,
            inputStemId: null,
            stemId: liveBlock.sourceType === "imported" ? liveBlock.importedStemId : null,
          };

          if (isNewLayer) {
            return {
              ...current,
              arrangement: {
                lanes: [
                  ...current.arrangement.lanes,
                  {
                    id: makeId("lane"),
                    name: `Layer ${current.arrangement.lanes.length + 1}`,
                    clips: [clip],
                  },
                ],
              },
            };
          }

          return {
            ...current,
            arrangement: {
              lanes: current.arrangement.lanes.map((lane) =>
                lane.id === laneId
                  ? {
                      ...lane,
                      clips: sortClips([...lane.clips, clip]),
                    }
                  : lane,
              ),
            },
          };
        },
      );
      clearDragState();
      return;
    }

    mutateActiveProject(
      {
        type: "move_arranger_clip",
        summary: "Moved arranger clip",
        payload: { clipId: payload.clipId, sourceLaneId: payload.sourceLaneId, targetLaneId: laneId ?? "new", startBar },
      },
      (current) => {
        const movedClip = current.arrangement.lanes
          .flatMap((lane) => lane.clips)
          .find((clip) => clip.id === payload.clipId);

        if (!movedClip) {
          return current;
        }

        return {
          ...current,
          arrangement: {
            lanes: [
              ...current.arrangement.lanes.map((lane) => {
                const clipsWithoutMoved = lane.clips.filter((clip) => clip.id !== payload.clipId);

                if (lane.id !== laneId) {
                  return { ...lane, clips: clipsWithoutMoved };
                }

                return {
                  ...lane,
                  clips: sortClips([...clipsWithoutMoved, { ...movedClip, startBar }]),
                };
              }),
              ...(isNewLayer
                ? [
                    {
                      id: makeId("lane"),
                      name: `Layer ${current.arrangement.lanes.length + 1}`,
                      clips: [{ ...movedClip, startBar }],
                    },
                  ]
                : []),
            ],
          },
        };
      },
    );
    clearDragState();
  }

  return (
    <div className="space-y-4">
      <div className="work-panel arranger-transport">
        <button className="icon-button" disabled={previewLoading} onClick={() => seekPreview(-10)} title="Rewind preview 10 seconds" type="button">
          <Rewind size={17} />
        </button>
        <button
          className={`icon-button ${previewPlaying ? "active" : ""}`}
          disabled={previewLoading || previewPlaying || previewPlayableCount === 0}
          onClick={() => void playPreview()}
          title="Preview arrangement"
          type="button"
        >
          {previewLoading ? <LoaderCircle className="animate-spin" size={17} /> : <Play size={17} />}
        </button>
        <button className="icon-button" disabled={!previewPlaying} onClick={pausePreview} title="Pause arrangement preview" type="button">
          <Pause size={17} />
        </button>
        <button className="icon-button" disabled={previewLoading} onClick={() => seekPreview(10)} title="Advance preview 10 seconds" type="button">
          <FastForward size={17} />
        </button>
        <div className="transport-progress" aria-label="Arrangement preview position">
          <i style={{ width: `${previewDuration > 0 ? Math.min(100, previewPosition / previewDuration * 100) : 0}%` }} />
        </div>
        <span className="status-pill">{Math.floor(previewPosition / 60)}:{String(Math.floor(previewPosition % 60)).padStart(2, "0")} / {previewDuration > 0 ? `${Math.floor(previewDuration / 60)}:${String(Math.floor(previewDuration % 60)).padStart(2, "0")}` : "--:--"}</span>
        <span className={`status-pill ${previewPlayableCount === 0 ? "warning" : previewPlayableCount ? "ready" : ""}`}>
          {previewPlayableCount === null ? "preview idle" : `${previewPlayableCount} playable`}
        </span>
      </div>
      {previewError ? <div className="graph-warning">{previewError}</div> : null}
      {previewSkippedClips.length > 0 ? (
        <div className="status-strip warning">
          Preview skipped {previewSkippedClips.length} clip{previewSkippedClips.length === 1 ? "" : "s"}:{" "}
          {previewSkippedClips.slice(0, 3).map((clip) => clip.reason).join("; ")}
          {previewSkippedClips.length > 3 ? `; +${previewSkippedClips.length - 3} more` : ""}
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-4">
        <div className="block-palette">
          {project.blocks.map((block) => (
            <button
              className="block-token"
              draggable
              key={block.id}
              onDragEnd={clearDragState}
              onDragStart={(event) => startBlockDrag(event, block)}
              style={blockAccentStyle(block)}
              type="button"
            >
              <span className="truncate">{block.name}</span>
              <span>
                {block.bars} bars | {formatTimeSignature(effectiveBlockTimeSignature(project, block))}
              </span>
            </button>
          ))}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            className="icon-button"
            disabled={timelineBarWidth <= MIN_BAR_WIDTH}
            onClick={() => zoomTimeline("out")}
            title="Zoom timeline out (PageDown or Ctrl+wheel down)"
            type="button"
          >
            <ZoomOut size={17} />
          </button>
          <span className="status-pill">{Math.round((timelineBarWidth / BAR_WIDTH) * 100)}%</span>
          <button
            className="icon-button"
            disabled={timelineBarWidth >= MAX_BAR_WIDTH}
            onClick={() => zoomTimeline("in")}
            title="Zoom timeline in (PageUp or Ctrl+wheel up)"
            type="button"
          >
            <ZoomIn size={17} />
          </button>
          <button
            className="control-button"
            type="button"
            onClick={() =>
              mutateActiveProject(
                {
                  type: "add_arranger_layer",
                  summary: "Added arranger layer",
                  payload: { laneCount: project.arrangement.lanes.length + 1 },
                },
                (current) => ({
                  ...current,
                  arrangement: {
                    lanes: [
                      ...current.arrangement.lanes,
                      {
                        id: makeId("lane"),
                        name: `Layer ${current.arrangement.lanes.length + 1}`,
                        clips: [],
                      },
                    ],
                  },
                }),
              )
            }
          >
            <Layers size={17} />
            Add Layer
          </button>
        </div>
      </div>

      <div className="timeline">
        <div
          aria-label="Arranger timeline"
          className="timeline-scroll"
          onKeyDown={handleTimelineKeyDown}
          onWheel={handleTimelineWheel}
          tabIndex={0}
        >
          <div
            className="timeline-content"
            style={{ "--bar-width": `${timelineBarWidth}px`, width: `${timelineWidth}px` } as BlockAccentStyle}
          >
            {previewDuration > 0 ? (
              <div
                aria-hidden="true"
                className="timeline-playhead"
                style={{ left: `${120 + previewBarPosition * timelineBarWidth}px` }}
              />
            ) : null}
            {project.arrangement.lanes.map((lane) => (
              <div
                className={`timeline-lane ${dragPreview?.laneId === lane.id ? "drop-active" : ""}`}
                key={lane.id}
                onDragLeave={(event) => clearLanePreview(event, lane.id)}
                onDragOver={(event) => updateDragPreview(event, lane.id)}
                onDrop={(event) => handleDrop(event, lane.id)}
              >
                <div className="timeline-lane-label">{lane.name}</div>
                <div className="timeline-track">
                  {lane.clips.length === 0 ? <div className="timeline-empty">Drop block or clip</div> : null}

                  {dragPreview?.laneId === lane.id ? (
                    <div
                      className="timeline-drop-preview"
                      style={{
                        left: `${dragPreview.startBar * timelineBarWidth}px`,
                        width: `${dragPreview.bars * timelineBarWidth}px`,
                      }}
                    >
                      bar {dragPreview.startBar + 1}
                    </div>
                  ) : null}

                  {lane.clips.map((clip) => {
                    const block = project.blocks.find((item) => item.id === clip.blockId);
                    const isImportedBlock = block?.sourceType === "imported";
                    const timeSignature = block ? formatTimeSignature(effectiveBlockTimeSignature(project, block)) : "-";
                    const requirement = requirementsByClipId.get(clip.id) ?? null;
                    const previewApplies =
                      resizePreview?.blockId === clip.blockId && resizePreview.variation === clip.variation;
                    const previewIsTarget = resizePreview?.clipId === clip.id;
                    const renderedStartBar = previewIsTarget ? resizePreview.startBar : clip.startBar;
                    const renderedBars = previewApplies ? resizePreview.bars : clip.bars;
                    const left = `${renderedStartBar * timelineBarWidth}px`;
                    const width = `${renderedBars * timelineBarWidth}px`;
                    const durationTimeSignature = block ? effectiveBlockTimeSignature(project, block) : project.song.timeSignature;
                    const durationIssue =
                      block?.sourceType === "generated"
                        ? getRenderDurationIssue({ bars: renderedBars, bpm: project.song.bpm, timeSignature: durationTimeSignature })
                        : null;
                    const durationTooltip = durationIssue
                      ? formatRenderDurationWarning(`${block?.name ?? "Detached block"} v${clip.variation}`, durationIssue)
                      : null;
                    const requirementState: RequirementRenderState = durationIssue
                      ? "duration-blocked"
                      : requirement
                        ? getRequirementRenderState({ requirement, graphBlocked: hasGraphCycle })
                        : "missing";
                    const requirementStatus = formatRequirementRenderState(requirementState);
                    const statusTitle =
                      [durationTooltip, requirement?.existingStem?.staleReason, requirement?.existingStem?.error]
                        .filter(Boolean)
                        .join(" · ") || undefined;
                    const usedVariations = block ? getUsedVariationsForBlock(project, block.id) : new Set<number>();
                    const splitPlan = !isImportedBlock
                      ? getSplitPlan({
                          bars: clip.bars,
                          currentVariation: clip.variation,
                          usedVariations,
                        })
                      : null;
                    const splitTitle = isImportedBlock
                      ? "Imported clips cannot split"
                      : clip.bars < 2
                        ? "Clip is already one bar"
                        : splitPlan
                          ? "Split this variation across all instances"
                          : "No unused variation is available for uneven split";
                    const clipMenuOpen = openActionsClipId === clip.id;
                    const waveformPath = resolveProjectAssetPath(projectPath, requirement?.existingStem?.filePath);

                    return (
                      <div
                        className={`timeline-clip ${draggingPayload?.kind === "clip" && draggingPayload.clipId === clip.id ? "dragging" : ""} ${durationIssue ? "render-too-long" : ""} ${resizePreview?.clipId === clip.id ? "resizing" : ""} ${clipMenuOpen ? "menu-open" : ""}`}
                        draggable={!resizeState}
                        key={clip.id}
                        onDragEnd={clearDragState}
                        onDragStart={(event) => startClipDrag(event, clip.id, lane.id)}
                        style={{ ...blockAccentStyle(block), left, width }}
                      >
                        <WaveformPreview className="clip-waveform" label={`${block?.name ?? "Detached block"} waveform`} path={waveformPath} />
                        {!isImportedBlock ? (
                          <>
                            <span
                              aria-label={`Resize ${block?.name ?? "clip"} left edge`}
                              className="clip-resize-handle left"
                              onPointerDown={(event) => startClipResize(event, clip, "left")}
                              role="separator"
                              title="Resize variation from left edge"
                            />
                            <span
                              aria-label={`Resize ${block?.name ?? "clip"} right edge`}
                              className="clip-resize-handle right"
                              onPointerDown={(event) => startClipResize(event, clip, "right")}
                              role="separator"
                              title="Resize variation from right edge"
                            />
                          </>
                        ) : null}
                        <div className="flex items-start justify-between gap-2">
                          <span className="truncate font-semibold">{block?.name ?? "Detached Block"}</span>
                          <div
                            className="clip-control-stack"
                            onPointerDown={(event) => event.stopPropagation()}
                          >
                            {durationIssue ? (
                              <span
                                className="duration-warning-icon compact"
                                title={durationTooltip ?? undefined}
                              >
                                <AlertTriangle size={13} />
                              </span>
                            ) : null}
                            <select
                              className="mini-field w-20"
                              disabled={isImportedBlock}
                              title={isImportedBlock ? "Imported stem variation is fixed" : "Dot means this variation exists in the arrangement"}
                              value={clip.variation}
                              onChange={(event) => setClipVariation(clip, Number(event.currentTarget.value))}
                            >
                              {Array.from({ length: VARIATION_COUNT }, (_, index) => {
                                const variation = index + 1;
                                const isPresent = usedVariations.has(variation);

                                return (
                                  <option key={variation} value={variation}>
                                    {isPresent ? "• " : ""}v{variation}
                                  </option>
                                );
                              })}
                            </select>
                            <div className="clip-actions">
                              <button
                                className="mini-icon-button neutral"
                                title="Clip actions"
                                type="button"
                                onClick={() => {
                                  setOpenActionsClipId((current) => (current === clip.id ? null : clip.id));
                                }}
                              >
                                <EllipsisVertical size={13} />
                              </button>
                              {openActionsClipId === clip.id ? (
                                <div className="clip-action-menu">
                                  <button type="button" onClick={() => cloneClip(lane.id, clip)}>
                                    <Copy size={13} />
                                    Clone
                                  </button>
                                  <button
                                    disabled={!splitPlan}
                                    title={splitTitle}
                                    type="button"
                                    onClick={() => (splitPlan ? splitClipVariation(clip, splitPlan) : undefined)}
                                  >
                                    <Scissors size={13} />
                                    Split
                                  </button>
                                  <button className="danger" type="button" onClick={() => deleteClip(clip)}>
                                    <Trash2 size={13} />
                                    Delete
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                        <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(6rem,0.75fr)] gap-2">
                          <select
                            className="mini-field min-w-0"
                            disabled={isImportedBlock}
                            value={clip.inputBlockId ?? ""}
                            onChange={(event) => {
                              const inputBlockId = event.currentTarget.value || null;
                              const inputStemId = inputBlockId ? latestReadyStemForBlock(project, inputBlockId)?.id ?? null : null;

                              mutateActiveProject(
                                {
                                  type: "set_clip_input_block",
                                  summary: "Updated clip input block",
                                  payload: { clipId: clip.id, inputBlockId, inputStemId },
                                },
                                (current) => {
                                  const updated = {
                                    ...current,
                                    arrangement: {
                                      lanes: current.arrangement.lanes.map((currentLane) => ({
                                        ...currentLane,
                                        clips: currentLane.clips.map((currentClip) =>
                                          currentClip.id === clip.id
                                            ? { ...currentClip, inputBlockId, inputStemId, stemId: null }
                                            : currentClip,
                                        ),
                                      })),
                                    },
                                  };
                                  const affectedBlockIds = collectDownstreamBlockIds(updated, [clip.blockId]);
                                  return markBlocksStale(updated, affectedBlockIds, "Arranger input graph changed.");
                                },
                              );
                            }}
                          >
                            <option value="">No input</option>
                            {project.blocks
                              .filter((item) => item.id !== clip.blockId)
                              .map((item) => (
                                <option key={item.id} value={item.id}>
                                  Input: {item.name}
                                </option>
                              ))}
                          </select>
                          <div className="clip-meta-status">
                            <span className="min-w-0 truncate text-xs text-genost-muted">
                              bar {renderedStartBar + 1} | {renderedBars} bars | {timeSignature}
                            </span>
                            <span
                              className={`status-pill clip-status-pill ${clipStatusClass(requirementState)}`}
                              title={statusTitle}
                            >
                              {requirementStatus}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            <div
              className={`timeline-lane timeline-new-lane ${dragPreview?.laneId === NEW_LAYER_DROP_ID ? "drop-active" : ""}`}
              onDragLeave={(event) => clearLanePreview(event, NEW_LAYER_DROP_ID)}
              onDragOver={(event) => updateDragPreview(event, NEW_LAYER_DROP_ID)}
              onDrop={(event) => handleDrop(event, null)}
            >
              <div className="timeline-lane-label">New Layer</div>
              <div className="timeline-track">
                <div className="timeline-empty">Drop here to create layer</div>
                {dragPreview?.laneId === NEW_LAYER_DROP_ID ? (
                  <div
                    className="timeline-drop-preview"
                    style={{
                      left: `${dragPreview.startBar * timelineBarWidth}px`,
                      width: `${dragPreview.bars * timelineBarWidth}px`,
                    }}
                  >
                    bar {dragPreview.startBar + 1}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
