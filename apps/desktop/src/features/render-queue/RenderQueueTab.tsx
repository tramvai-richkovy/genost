import { convertFileSrc } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Archive, FolderOpen, Pause, Play, RotateCcw, Square, Trash2, Unplug, WandSparkles, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStudioStore } from "../../app/store";
import { isUriAssetPath, resolveProjectAssetPath } from "../../lib/audio/paths";
import { formatRenderDurationWarning, getCompositionPromptIssues } from "../../lib/project/format";
import { findBlockGraphCycle } from "../../lib/project/graph";
import {
  collectRequirements,
  formatRequirementInput,
  getRequirementRenderState,
  queueComponentRequirement,
  type ComponentRequirement,
} from "../../lib/project/requirements";
import { archiveDetachedStemAssets, describeProjectStorageError, type ArchivedStemAsset } from "../../lib/project/storage";
import { detachGeneratedStems as detachGeneratedStemsFromProject } from "../../lib/project/stems";
import type { GenostProject, GenostStem } from "../../lib/schema/project";
import { cancelWorkerJob, type WorkerJobStatus } from "../../lib/worker-client/render";
import { getComponentStatusLabel, getRenderBlockReason } from "./renderQueueState";

function isLiveGeneratedStem(project: GenostProject, stem: GenostStem): boolean {
  const block = project.blocks.find((item) => item.id === stem.blockId);
  return Boolean(block && block.sourceType !== "imported" && !["superseded", "archived", "detached"].includes(stem.status));
}

export function getLiveGeneratedStems(project: GenostProject): GenostStem[] {
  return project.stems.filter((stem) => isLiveGeneratedStem(project, stem));
}

export function detachLiveGeneratedStems(
  project: GenostProject,
  archivedAssets: ArchivedStemAsset[] = [],
): GenostProject {
  return detachGeneratedStems(
    project,
    getLiveGeneratedStems(project).map((stem) => stem.id),
    archivedAssets,
    "Archived by Components Delete All.",
  );
}

export function detachGeneratedStems(
  project: GenostProject,
  stemIds: string[],
  archivedAssets: ArchivedStemAsset[] = [],
  reason = "Archived from Components.",
): GenostProject {
  return detachGeneratedStemsFromProject(project, stemIds, archivedAssets, reason);
}

function workerElapsedSeconds(job: WorkerJobStatus, now: number): number {
  const started = job.started_at ? Date.parse(job.started_at) : Date.parse(job.created_at);
  const finished = job.finished_at ? Date.parse(job.finished_at) : now;
  return Number.isFinite(started) && Number.isFinite(finished) ? Math.max(0, Math.floor((finished - started) / 1000)) : 0;
}

function validationSummary(stem: GenostStem | null): string | null {
  const metrics = stem?.renderMetadata?.validationMetrics;
  if (!metrics) return null;
  const peak = metrics.peak;
  const rms = metrics.rms_db;
  return [
    typeof peak === "number" ? `peak ${peak.toFixed(3)}` : null,
    typeof rms === "number" ? `RMS ${rms.toFixed(1)} dBFS` : null,
  ].filter(Boolean).join(" · ") || null;
}

export function RenderQueueTab() {
  const activeProject = useStudioStore((state) => state.activeProject);
  const musicAiMode = useStudioStore((state) => state.musicAiMode);
  const mutateActiveProject = useStudioStore((state) => state.mutateActiveProject);
  const workerJobs = useStudioStore((state) => state.workerJobs);
  const setWorkerJob = useStudioStore((state) => state.setWorkerJob);
  const [previewStemId, setPreviewStemId] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [deleteAllConfirmStep, setDeleteAllConfirmStep] = useState<0 | 1 | 2>(0);
  const [deleteAllError, setDeleteAllError] = useState<string | null>(null);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [selectedRequirementKeys, setSelectedRequirementKeys] = useState<Set<string>>(new Set());
  const [archivingStemId, setArchivingStemId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [blockFilter, setBlockFilter] = useState("all");
  const [clockTick, setClockTick] = useState(() => Date.now());
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!Object.values(workerJobs).some((job) => ["queued", "rendering"].includes(job.status))) return;
    const interval = window.setInterval(() => setClockTick(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [workerJobs]);

  if (!activeProject) {
    return null;
  }

  const { project, path: projectPath } = activeProject;
  const requirements = collectRequirements(project);
  const graphCycle = findBlockGraphCycle(project);
  const compositionIssues = getCompositionPromptIssues(project.song);
  const renderBlockReason = getRenderBlockReason({
    musicAiMode,
    compositionIssues,
    hasGraphCycle: Boolean(graphCycle),
  });
  const offlineRenderBlocked = renderBlockReason === "offline";
  const renderBlocked = Boolean(renderBlockReason);
  const liveGeneratedStems = getLiveGeneratedStems(project);
  const deleteAllDisabled = liveGeneratedStems.length === 0 || isDeletingAll;
  const visibleRequirements = requirements.filter((requirement) => {
    if (blockFilter !== "all" && requirement.block.id !== blockFilter) {
      return false;
    }
    const status = requirement.existingStem?.status ?? "missing";
    if (statusFilter === "needs-render") {
      return requirement.inputMissing || ["missing", "stale", "failed", "canceled"].includes(status);
    }
    if (statusFilter === "active") {
      return ["queued", "rendering"].includes(status);
    }
    return statusFilter === "all" || status === statusFilter;
  });
  const selectedRequirements = requirements.filter((requirement) => selectedRequirementKeys.has(requirement.key));

  function queueRequirements(requirementsToQueue: ComponentRequirement[]) {
    for (const requirement of [...requirementsToQueue].sort((left, right) => left.variation - right.variation)) {
      if (
        requirement.block.sourceType === "generated" &&
        !requirement.durationIssue &&
        (!requirement.existingStem || ["missing", "failed", "canceled", "stale"].includes(requirement.existingStem.status))
      ) {
        queueRequirement(requirement, false);
      }
    }
  }

  function queueRequirement(requirement: ComponentRequirement, regenerate: boolean) {
    if (renderBlocked || requirement.block.sourceType === "imported" || requirement.durationIssue) {
      return;
    }

    mutateActiveProject(
      {
        type: regenerate ? "regenerate_component" : "queue_component_render",
        summary: regenerate ? "Regenerated component" : "Queued component render",
        payload: {
          blockId: requirement.block.id,
          variation: requirement.variation,
          bars: requirement.bars,
          durationSeconds: requirement.durationSeconds,
          inputStemId: requirement.inputStemId,
          variationAnchor: requirement.variationAnchor,
          clipIds: requirement.clips.map((clip) => clip.id),
        },
      },
      (current) => {
        return queueComponentRequirement(current, requirement, regenerate);
      },
    );
  }

  async function cancelStem(stem: GenostStem) {
    if (stem.status === "rendering") {
      try {
        const workerJob = await cancelWorkerJob(stem.id);
        if (workerJob) {
          setWorkerJob(workerJob);
        }
        mutateActiveProject(
          {
            type: workerJob ? "request_cancel_component_render" : "cancel_interrupted_component_render",
            summary: workerJob ? "Requested component cancellation" : "Canceled interrupted component render",
            payload: { stemId: stem.id, workerJobFound: Boolean(workerJob) },
          },
          (current) =>
            workerJob
              ? current
              : {
                  ...current,
                  stems: current.stems.map((currentStem) =>
                    currentStem.id === stem.id && currentStem.status === "rendering"
                      ? { ...currentStem, status: "canceled" as const, queueOrder: null, error: null, updatedAt: new Date().toISOString() }
                      : currentStem,
                  ),
                },
        );
      } catch (error) {
        setPreviewError(error instanceof Error ? error.message : String(error));
      }
      return;
    }

    mutateActiveProject(
      {
        type: "cancel_component_render",
        summary: "Canceled component render",
        payload: { stemId: stem.id, queueOrder: stem.queueOrder },
      },
      (current) => ({
        ...current,
        stems: current.stems.map((currentStem) =>
          currentStem.id === stem.id && ["queued", "rendering"].includes(currentStem.status)
            ? {
                ...currentStem,
                status: "canceled",
                queueOrder: null,
                updatedAt: new Date().toISOString(),
              }
            : currentStem,
        ),
      }),
    );
  }

  async function deleteAllLiveGeneratedStems() {
    if (deleteAllDisabled) {
      return;
    }

    const stemsToArchive = getLiveGeneratedStems(project);

    if (stemsToArchive.length === 0) {
      setDeleteAllConfirmStep(0);
      return;
    }

    setIsDeletingAll(true);
    setDeleteAllError(null);
    audioRef.current?.pause();
    audioRef.current = null;
    setPreviewStemId(null);

    try {
      const archivedAssets = projectPath ? await archiveDetachedStemAssets(projectPath, stemsToArchive) : [];

      mutateActiveProject(
        {
          type: "archive_all_live_components",
          summary: `Archived ${stemsToArchive.length} live component stem(s)`,
          payload: {
            stemIds: stemsToArchive.map((stem) => stem.id),
            archivedAssets,
            reason: "components_delete_all",
          },
        },
        (current) => detachLiveGeneratedStems(current, archivedAssets),
      );
      setDeleteAllConfirmStep(0);
    } catch (error) {
      setDeleteAllError(describeProjectStorageError(error, "Archiving live component stems", projectPath ?? undefined));
    } finally {
      setIsDeletingAll(false);
    }
  }

  async function archiveStem(stem: GenostStem) {
    if (!projectPath || ["queued", "rendering"].includes(stem.status)) {
      return;
    }
    setArchivingStemId(stem.id);
    setDeleteAllError(null);
    try {
      const archivedAssets = await archiveDetachedStemAssets(projectPath, [stem]);
      mutateActiveProject(
        {
          type: "archive_component",
          summary: `Archived component ${stem.fileName}`,
          payload: { stemId: stem.id, archivedAssets, reason: "components_remove" },
        },
        (current) => detachGeneratedStems(current, [stem.id], archivedAssets),
      );
    } catch (error) {
      setDeleteAllError(describeProjectStorageError(error, "Archiving component", projectPath));
    } finally {
      setArchivingStemId(null);
    }
  }

  async function revealStem(stem: GenostStem) {
    const resolvedPath = resolveProjectAssetPath(projectPath, stem.filePath);
    if (!resolvedPath || isUriAssetPath(resolvedPath)) {
      return;
    }
    try {
      await revealItemInDir(resolvedPath);
      mutateActiveProject(
        {
          type: "reveal_component",
          summary: `Revealed component ${stem.fileName}`,
          payload: { stemId: stem.id, filePath: stem.filePath },
        },
        (current) => current,
      );
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : String(error));
    }
  }

  function togglePreview(stem: GenostStem | null) {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    if (!stem || previewStemId === stem.id) {
      setPreviewStemId(null);
      return;
    }

    setPreviewStemId(stem.id);
    setPreviewError(null);

    const resolvedFilePath = resolveProjectAssetPath(projectPath, stem.filePath);

    if (resolvedFilePath) {
      const audio = new Audio(isUriAssetPath(resolvedFilePath) ? resolvedFilePath : convertFileSrc(resolvedFilePath));
      audioRef.current = audio;
      audio.onended = () => setPreviewStemId(null);
      audio.onerror = () => {
        setPreviewStemId(null);
        setPreviewError(`Could not load component audio: ${stem.filePath ?? stem.fileName}`);
      };
      void audio.play().catch((error: unknown) => {
        setPreviewStemId(null);
        setPreviewError(error instanceof Error ? error.message : `Could not play component audio: ${stem.filePath ?? stem.fileName}`);
      });
    } else {
      setPreviewStemId(null);
      setPreviewError(`Component audio path is not available: ${stem.fileName}`);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-2">
          <select className="mini-field" onChange={(event) => setBlockFilter(event.currentTarget.value)} value={blockFilter}>
            <option value="all">All blocks</option>
            {project.blocks.map((block) => (
              <option key={block.id} value={block.id}>{block.name}</option>
            ))}
          </select>
          <select className="mini-field" onChange={(event) => setStatusFilter(event.currentTarget.value)} value={statusFilter}>
            <option value="all">All statuses</option>
            <option value="needs-render">Needs render</option>
            <option value="active">Queued / rendering</option>
            <option value="ready">Ready</option>
            <option value="stale">Stale</option>
            <option value="failed">Failed</option>
            <option value="canceled">Canceled</option>
          </select>
        </div>
        <div className="grid justify-items-end gap-2">
          <div className="flex gap-2">
            <button
              className="control-button"
              type="button"
              onClick={() => queueRequirements(selectedRequirements)}
              disabled={renderBlocked || selectedRequirements.length === 0}
              title={offlineRenderBlocked ? "MusicGen is offline" : "Render selected missing or stale components"}
            >
              <WandSparkles size={17} />
              Render Selected
            </button>
            <button
              className="control-button"
              type="button"
              onClick={() => queueRequirements(requirements)}
              disabled={renderBlocked}
              title={offlineRenderBlocked ? "MusicGen is offline" : "Render all missing or stale components"}
            >
              <WandSparkles size={17} />
              Render All
            </button>
          </div>
          <button
            className="control-button danger"
            disabled={deleteAllDisabled}
            onClick={() => {
              setDeleteAllError(null);
              setDeleteAllConfirmStep(1);
            }}
            title={liveGeneratedStems.length > 0 ? "Archive every generated live stem and clear component bindings" : "No generated live stems to archive"}
            type="button"
          >
            <Trash2 size={17} />
            Delete All
          </button>
        </div>
      </div>

      {compositionIssues.length > 0 ? (
        <div className="graph-warning">
          <XCircle size={18} />
          <span>Composition missing: {compositionIssues.join(", ")}.</span>
        </div>
      ) : null}

      {offlineRenderBlocked ? (
        <div className="graph-warning offline">
          <Unplug size={18} />
          <span>MusicGen is offline. Planning stays enabled; render and regenerate actions are disabled for this session.</span>
        </div>
      ) : null}
      {previewError ? <div className="graph-warning">{previewError}</div> : null}
      {deleteAllError ? <div className="graph-warning">{deleteAllError}</div> : null}

      <div className="queue-table">
        <div className="queue-row queue-header">
          <label className="flex items-center gap-2" title="Select all component requirements">
            <input
              checked={visibleRequirements.length > 0 && visibleRequirements.every((item) => selectedRequirementKeys.has(item.key))}
              onChange={(event) =>
                setSelectedRequirementKeys((current) => {
                  const next = new Set(current);
                  for (const requirement of visibleRequirements) {
                    if (event.currentTarget.checked) next.add(requirement.key);
                    else next.delete(requirement.key);
                  }
                  return next;
                })
              }
              type="checkbox"
            />
            Order
          </label>
          <span>Component</span>
          <span>Variation</span>
          <span>Input</span>
          <span>Model</span>
          <span>Status</span>
          <span>Preview</span>
          <span>Actions</span>
        </div>
        {visibleRequirements.map((requirement) => {
          const stem = requirement.existingStem;
          const requirementState = getRequirementRenderState({
            requirement,
            graphBlocked: renderBlockReason === "graph-cycle",
          });
          const isPreviewing = previewStemId === stem?.id;
          const workerJob = stem ? workerJobs[stem.id] : null;
          const elapsedSeconds = workerJob ? workerElapsedSeconds(workerJob, clockTick) : null;
          const persistedValidationSummary = validationSummary(stem);
          const canRender = !stem || ["missing", "failed", "canceled", "stale"].includes(stem.status);
          const isImported = requirement.block.sourceType === "imported";
          const durationTooltip = requirement.durationIssue
            ? formatRenderDurationWarning(`${requirement.block.name} v${requirement.variation}`, requirement.durationIssue)
            : null;
          const renderActionTitle = isImported
            ? "Imported stem is already ready"
            : durationTooltip
              ? durationTooltip
              : offlineRenderBlocked
                ? "MusicGen is offline"
                : "Queue render";
          const regenerateActionTitle = isImported
            ? "Imported stem cannot regenerate"
            : durationTooltip
              ? durationTooltip
              : offlineRenderBlocked
                ? "MusicGen is offline"
                : "Regenerate component";
          const statusWarning = [
            "duration-blocked",
            "graph-cycle-blocked",
            "input-missing",
            "validation-failed",
            "failed",
            "stale",
          ].includes(requirementState);

          return (
            <div className="queue-row" key={requirement.key}>
              <label className="queue-order flex items-center gap-2">
                <input
                  checked={selectedRequirementKeys.has(requirement.key)}
                  onChange={(event) =>
                    setSelectedRequirementKeys((current) => {
                      const next = new Set(current);
                      if (event.currentTarget.checked) next.add(requirement.key);
                      else next.delete(requirement.key);
                      return next;
                    })
                  }
                  type="checkbox"
                />
                {stem?.queueOrder ? `#${stem.queueOrder}` : "-"}
              </label>
              <span className="truncate">{requirement.block.name}</span>
              <span>v{requirement.variation} / {requirement.bars} bars</span>
              <span className="truncate text-genost-muted">
                {formatRequirementInput(project, requirement, offlineRenderBlocked)}
              </span>
              <span className="truncate">
                {isImported
                  ? "imported-audio"
                  : requirement.variationAnchor || requirement.inputBlockId || requirement.inputStemId
                    ? project.song.defaultMelodyModel
                    : project.song.defaultTextModel}
              </span>
              <span
                className={`status-pill ${requirementState === "ready" ? "ready" : ""} ${statusWarning ? "warning" : ""}`}
                title={
                  (durationTooltip ??
                    [
                      workerJob?.message,
                      stem?.error,
                      elapsedSeconds !== null ? `${elapsedSeconds}s elapsed` : null,
                      persistedValidationSummary,
                    ]
                      .filter(Boolean)
                      .join(" · ")) ||
                  undefined
                }
              >
                {stem?.status === "rendering" && workerJob
                  ? `${Math.round(workerJob.progress * 100)}% · ${elapsedSeconds}s`
                  : stem?.status === "ready" && persistedValidationSummary
                    ? `ready · ${stem.renderMetadata?.validationMetrics?.peak?.toFixed(2) ?? "ok"}`
                  : getComponentStatusLabel({
                      renderBlockReason,
                      requirementState,
                    })}
              </span>
              <button
                className={`icon-button ${isPreviewing ? "active" : ""}`}
                disabled={!resolveProjectAssetPath(projectPath, stem?.filePath)}
                onClick={() => togglePreview(stem)}
                title={
                  resolveProjectAssetPath(projectPath, stem?.filePath)
                    ? isPreviewing
                      ? "Pause preview"
                      : "Preview component"
                    : "No rendered audio to preview"
                }
                type="button"
              >
                {isPreviewing ? <Pause size={17} /> : <Play size={17} />}
              </button>
              <div className="flex items-center gap-2">
                <button
                  className="icon-button"
                  disabled={
                    isImported ||
                    (requirement.inputMissing && !requirement.variationAnchor) ||
                    renderBlocked ||
                    Boolean(requirement.durationIssue) ||
                    !canRender ||
                    Boolean(stem && ["queued", "rendering"].includes(stem.status))
                  }
                  onClick={() => queueRequirement(requirement, false)}
                  title={renderActionTitle}
                  type="button"
                >
                  <WandSparkles size={17} />
                </button>
                <button
                  className="icon-button"
                  disabled={
                    isImported ||
                    !stem ||
                    (requirement.inputMissing && !requirement.variationAnchor) ||
                    renderBlocked ||
                    Boolean(requirement.durationIssue) ||
                    ["queued", "rendering"].includes(stem.status)
                  }
                  onClick={() => queueRequirement(requirement, true)}
                  title={regenerateActionTitle}
                  type="button"
                >
                  <RotateCcw size={17} />
                </button>
                <button
                  className="icon-button"
                  disabled={!stem || !resolveProjectAssetPath(projectPath, stem.filePath)}
                  onClick={() => (stem ? void revealStem(stem) : undefined)}
                  title="Reveal component in Finder"
                  type="button"
                >
                  <FolderOpen size={17} />
                </button>
                <button
                  className="icon-button danger"
                  disabled={
                    isImported ||
                    !stem ||
                    ["queued", "rendering"].includes(stem.status) ||
                    archivingStemId === stem.id
                  }
                  onClick={() => (stem ? void archiveStem(stem) : undefined)}
                  title="Archive and detach component"
                  type="button"
                >
                  <Archive size={17} />
                </button>
                <button
                  className="icon-button danger"
                  disabled={!stem || !["queued", "rendering"].includes(stem.status) || Boolean(workerJob?.cancel_requested)}
                  onClick={() => (stem ? void cancelStem(stem) : undefined)}
                  title={
                    stem?.status === "rendering"
                      ? workerJob?.cancel_requested
                        ? "Cancellation requested"
                        : "Cancel active render"
                      : "Cancel queued render"
                  }
                  type="button"
                >
                  {stem?.status === "rendering" ? <XCircle size={17} /> : <Square size={17} />}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {deleteAllConfirmStep > 0 ? (
        <div className="confirm-backdrop">
          <div aria-modal="true" className="confirm-dialog" role="dialog">
            <div className="flex items-start gap-3">
              <span className="duration-warning-icon compact mt-1">
                <Trash2 size={14} />
              </span>
              <div className="min-w-0">
                <h2>{deleteAllConfirmStep === 1 ? "Archive All Live Components?" : "Confirm Delete All"}</h2>
                <p>
                  {deleteAllConfirmStep === 1
                    ? "Generated live stems will move to ARCHIVE as DETACHED files, component links will clear, and imported stems will stay in place."
                    : `Archive ${liveGeneratedStems.length} generated live stem${liveGeneratedStems.length === 1 ? "" : "s"} now?`}
                </p>
              </div>
            </div>
            <div className="confirm-actions">
              <button
                className="control-button"
                disabled={isDeletingAll}
                onClick={() => setDeleteAllConfirmStep(deleteAllConfirmStep === 1 ? 0 : 1)}
                type="button"
              >
                {deleteAllConfirmStep === 1 ? "Cancel" : "Back"}
              </button>
              {deleteAllConfirmStep === 1 ? (
                <button className="control-button danger" onClick={() => setDeleteAllConfirmStep(2)} type="button">
                  Continue
                </button>
              ) : (
                <button className="control-button danger" disabled={isDeletingAll} onClick={deleteAllLiveGeneratedStems} type="button">
                  {isDeletingAll ? "Archiving" : "Archive All"}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
