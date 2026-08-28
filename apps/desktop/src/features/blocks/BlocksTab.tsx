import { convertFileSrc } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { AlertTriangle, Archive, AudioLines, FileUp, FolderOpen, LoaderCircle, Pause, Play, Plus, RotateCcw, Trash2, WandSparkles } from "lucide-react";
import { useRef, useState } from "react";
import { useStudioStore } from "../../app/store";
import { collectDownstreamBlockIds, findBlockGraphCycle, markBlocksStale, markStemDependencyChainStale } from "../../lib/project/graph";
import { archiveDetachedStemAssets, describeProjectStorageError } from "../../lib/project/storage";
import { detachGeneratedStems } from "../../lib/project/stems";
import { cancelWorkerJob } from "../../lib/worker-client/render";
import {
  barsToSeconds,
  effectiveBlockTimeSignature,
  formatRenderDurationWarning,
  formatTimeSignature,
  getRenderDurationIssue,
  getCompositionPromptIssues,
  makeId,
} from "../../lib/project/format";
import { collectRequirements, queueComponentRequirement } from "../../lib/project/requirements";
import { isUriAssetPath, resolveProjectAssetPath } from "../../lib/audio/paths";
import { getRenderBlockReason } from "../render-queue/renderQueueState";
import { separateStem } from "../../lib/worker-client/separation";
import {
  SEPARATOR_TARGET_VALUES,
  SOUND_CHARACTER_VALUES,
  type GenostBlock,
  type SeparatorTarget,
  type SoundCharacter,
  type TimeSignature,
} from "../../lib/schema/project";

function parseInteger(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function createBlock(): GenostBlock {
  return {
    id: makeId("block"),
    name: "New Block",
    bars: 16,
    timeSignature: null,
    role: "",
    instruments: [],
    separatorTarget: "other",
    validationCategory: "generic",
    soundCharacter: "clean",
    sourceType: "generated",
    importedStemId: null,
    melodyDescription: "",
    melodyPrompt: "",
    rhythmFeel: "",
    timbre: "",
    energy: 5,
    density: 5,
    avoid: "",
    volumeDb: -6,
    delaySend: 0,
    reverbSend: 0,
    compressorEnabled: false,
    implementedMelodies: [],
  };
}

export function BlocksTab() {
  const activeProject = useStudioStore((state) => state.activeProject);
  const importStemAsBlock = useStudioStore((state) => state.importStemAsBlock);
  const mutateActiveProject = useStudioStore((state) => state.mutateActiveProject);
  const musicAiMode = useStudioStore((state) => state.musicAiMode);
  const [pendingRemoveBlockId, setPendingRemoveBlockId] = useState<string | null>(null);
  const [isRemovingBlock, setIsRemovingBlock] = useState(false);
  const [removalError, setRemovalError] = useState<string | null>(null);
  const [previewStemId, setPreviewStemId] = useState<string | null>(null);
  const [separationBusyId, setSeparationBusyId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  if (!activeProject) {
    return null;
  }

  const { project, path: projectPath } = activeProject;
  const requirements = collectRequirements(project);
  const renderBlocked = Boolean(getRenderBlockReason({
    musicAiMode,
    compositionIssues: getCompositionPromptIssues(project.song),
    hasGraphCycle: Boolean(findBlockGraphCycle(project)),
  }));
  const pendingRemoveBlock = project.blocks.find((block) => block.id === pendingRemoveBlockId) ?? null;
  const pendingClips = pendingRemoveBlock
    ? project.arrangement.lanes.flatMap((lane) => lane.clips).filter((clip) => clip.blockId === pendingRemoveBlock.id)
    : [];
  const pendingStems = pendingRemoveBlock
    ? project.stems.filter((stem) => stem.blockId === pendingRemoveBlock.id && stem.status !== "detached")
    : [];

  async function removePendingBlock() {
    if (!pendingRemoveBlock) {
      return;
    }
    setIsRemovingBlock(true);
    setRemovalError(null);
    try {
      await Promise.all(
        pendingStems
          .filter((stem) => stem.status === "rendering")
          .map((stem) => cancelWorkerJob(stem.id).catch(() => null)),
      );
      const archivedAssets = projectPath
        ? await archiveDetachedStemAssets(projectPath, pendingStems)
        : [];
      const blockId = pendingRemoveBlock.id;
      const stemIds = pendingStems.map((stem) => stem.id);
      const clipIds = pendingClips.map((clip) => clip.id);
      mutateActiveProject(
        {
          type: "remove_block",
          summary: `Removed block ${pendingRemoveBlock.name}`,
          payload: { blockId, stemIds, clipIds, archivedAssets },
        },
        (current) => {
          const detached = detachGeneratedStems(current, stemIds, archivedAssets, "Source block was removed.");
          return {
            ...detached,
            blocks: detached.blocks.filter((item) => item.id !== blockId),
            arrangement: {
              lanes: detached.arrangement.lanes.map((lane) => ({
                ...lane,
                clips: lane.clips.filter((clip) => clip.blockId !== blockId),
              })),
            },
          };
        },
      );
      setPendingRemoveBlockId(null);
    } catch (error) {
      setRemovalError(describeProjectStorageError(error, "Removing block", projectPath ?? undefined));
    } finally {
      setIsRemovingBlock(false);
    }
  }

  function updateBlock(blockId: string, patch: Partial<GenostBlock>, commandType: string) {
    const block = project.blocks.find((item) => item.id === blockId);

    if (block?.sourceType === "imported" && Object.keys(patch).some((key) => key !== "bars")) {
      return;
    }

    const isImportedBarsEdit = block?.sourceType === "imported" && typeof patch.bars === "number";
    const isSeparatorPreferenceEdit = Object.keys(patch).every((key) => key === "separatorTarget");

    mutateActiveProject(
      {
        type: commandType,
        summary: "Updated block",
        payload: { blockId, patch },
      },
      (current) => {
        const now = new Date().toISOString();
        const importedDurationSeconds = isImportedBarsEdit
          ? barsToSeconds(patch.bars as number, current.song.bpm, current.song.timeSignature[0])
          : null;

        const updated = {
          ...current,
          blocks: current.blocks.map((block) => (block.id === blockId ? { ...block, ...patch } : block)),
          arrangement: isImportedBarsEdit
            ? {
                lanes: current.arrangement.lanes.map((lane) => ({
                  ...lane,
                  clips: lane.clips.map((clip) =>
                    clip.blockId === blockId ? { ...clip, bars: patch.bars as number } : clip,
                  ),
                })),
              }
            : current.arrangement,
          stems: current.stems.map((stem) => {
            if (isImportedBarsEdit && stem.blockId === blockId && importedDurationSeconds) {
              return { ...stem, durationSeconds: importedDurationSeconds, updatedAt: now };
            }

            if (isSeparatorPreferenceEdit) {
              return stem;
            }

            return stem;
          }),
        };

        if (isSeparatorPreferenceEdit || isImportedBarsEdit) {
          return updated;
        }

        const directlyAffectedStemIds = updated.stems
          .filter((stem) => stem.blockId === blockId)
          .map((stem) => stem.id);
        const downstreamBlockIds = collectDownstreamBlockIds(updated, [blockId]);
        return markStemDependencyChainStale(
          markBlocksStale(
            updated,
            downstreamBlockIds,
            "Block settings changed; archive as prior revision before rerender.",
          ),
          directlyAffectedStemIds,
          "An input stem's block settings changed.",
        );
      },
    );
  }

  function updateBlockTimeSignature(block: GenostBlock, index: 0 | 1, value: string) {
    const currentSignature = block.timeSignature ?? project.song.timeSignature;
    const nextSignature: TimeSignature = [...currentSignature] as TimeSignature;
    nextSignature[index] = parseInteger(value, currentSignature[index], 1, 32);
    updateBlock(block.id, { timeSignature: nextSignature }, "set_block_time_signature");
  }

  function queueMelody(stemId: string, regenerate: boolean) {
    const stem = project.stems.find((item) => item.id === stemId);
    const requirement = stem
      ? requirements.find((item) => item.block.id === stem.blockId && item.variation === stem.variation)
      : null;
    if (!requirement || renderBlocked || requirement.durationIssue) return;
    mutateActiveProject(
      {
        type: regenerate ? "regenerate_component" : "queue_component_render",
        summary: regenerate ? "Regenerated component from Blocks" : "Queued component from Blocks",
        payload: { blockId: requirement.block.id, variation: requirement.variation, stemId },
      },
      (current) => queueComponentRequirement(current, requirement, regenerate),
    );
  }

  function toggleMelodyPreview(stemId: string) {
    audioRef.current?.pause();
    audioRef.current = null;
    if (previewStemId === stemId) {
      setPreviewStemId(null);
      return;
    }
    const stem = project.stems.find((item) => item.id === stemId);
    const path = resolveProjectAssetPath(projectPath, stem?.filePath);
    if (!path) return;
    const audio = new Audio(isUriAssetPath(path) ? path : convertFileSrc(path));
    audioRef.current = audio;
    setPreviewStemId(stemId);
    audio.onended = () => setPreviewStemId(null);
    audio.onerror = () => setPreviewStemId(null);
    void audio.play().catch(() => setPreviewStemId(null));
  }

  async function separateImplementedStem(blockId: string, stemId: string) {
    const stem = project.stems.find((item) => item.id === stemId);
    const sourcePath = resolveProjectAssetPath(projectPath, stem?.filePath);
    if (!stem || !sourcePath || !projectPath || isUriAssetPath(sourcePath)) return;
    const bundleId = makeId("separation");
    const createdAt = new Date().toISOString();
    setSeparationBusyId(stemId);
    mutateActiveProject(
      { type: "separate_stem_started", summary: "Started six-stem separation", payload: { bundleId, blockId, stemId, model: "htdemucs_6s.yaml" } },
      (current) => ({
        ...current,
        separationBundles: [...current.separationBundles, {
          id: bundleId,
          blockId,
          sourceStemId: stemId,
          rawStemPath: stem.filePath ?? stem.fileName,
          model: "htdemucs_6s.yaml",
          preferredTarget: current.blocks.find((item) => item.id === blockId)?.separatorTarget ?? "other",
          status: "separating",
          selectedOutputIds: [],
          outputs: [],
          merges: [],
          previewMetadata: {},
          errorCode: null,
          error: null,
          createdAt,
          updatedAt: createdAt,
        }],
      }),
    );
    try {
      const bundlePath = await join(projectPath, "STEMS", "SEPARATIONS", bundleId);
      const result = await separateStem({
        bundle_id: bundleId,
        source_stem_path: sourcePath,
        bundle_path: bundlePath,
        model: "htdemucs_6s.yaml",
        model_cache_path: project.song.modelCachePath || null,
      });
      const completedAt = new Date().toISOString();
      mutateActiveProject(
        {
          type: result.status === "ready" ? "separate_stem_completed" : "separate_stem_failed",
          summary: result.status === "ready" ? "Published six-stem separation bundle" : "Six-stem separation failed",
          payload: { bundleId, sourceStemId: stemId, outputs: result.outputs, errorCode: result.error_code, error: result.error },
          actor: result.status === "ready" ? "user" : "worker",
          source: result.status === "ready" ? "web-ui" : "worker",
        },
        (current) => ({
          ...current,
          separationBundles: current.separationBundles.map((bundle) => bundle.id === bundleId ? {
            ...bundle,
            status: result.status,
            outputs: result.outputs.map((output) => ({
              id: makeId("separated"),
              label: output.label,
              fileName: output.file_name,
              filePath: `STEMS/SEPARATIONS/${bundleId}/${output.file_name}`,
              status: "ready" as const,
              volumeDb: 0,
              durationSeconds: output.duration_seconds,
              peak: output.peak,
              createdAt: completedAt,
            })),
            previewMetadata: { outputCount: result.outputs.length, model: result.model },
            errorCode: result.error_code,
            error: result.error,
            updatedAt: completedAt,
          } : bundle),
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      mutateActiveProject(
        { type: "separate_stem_failed", summary: "Six-stem separation failed", payload: { bundleId, error: message }, actor: "worker", source: "worker" },
        (current) => ({ ...current, separationBundles: current.separationBundles.map((bundle) => bundle.id === bundleId ? { ...bundle, status: "failed", errorCode: "separator_client_failed", error: message, updatedAt: new Date().toISOString() } : bundle) }),
      );
    } finally {
      setSeparationBusyId(null);
    }
  }

  async function revealMelody(stemId: string) {
    const stem = project.stems.find((item) => item.id === stemId);
    const path = resolveProjectAssetPath(projectPath, stem?.filePath);
    if (!path || isUriAssetPath(path)) return;
    await revealItemInDir(path);
    mutateActiveProject({ type: "reveal_component", summary: "Revealed component from Blocks", payload: { stemId } }, (current) => current);
  }

  async function archiveMelody(stemId: string) {
    const stem = project.stems.find((item) => item.id === stemId);
    if (!stem || !projectPath || ["queued", "rendering"].includes(stem.status)) return;
    const archivedAssets = await archiveDetachedStemAssets(projectPath, [stem]);
    mutateActiveProject(
      { type: "archive_component", summary: "Archived component from Blocks", payload: { stemId, archivedAssets } },
      (current) => detachGeneratedStems(current, [stemId], archivedAssets, "Archived from Blocks."),
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <button className="control-button" type="button" onClick={importStemAsBlock}>
          <FileUp size={17} />
          Import Stem
        </button>
        <button
          className="control-button"
          type="button"
          onClick={() =>
            mutateActiveProject(
              {
                type: "add_block",
                summary: "Added block",
                payload: {},
              },
              (current) => ({ ...current, blocks: [...current.blocks, createBlock()] }),
            )
          }
        >
          <Plus size={17} />
          Add Block
        </button>
      </div>

      {removalError ? <div className="graph-warning">{removalError}</div> : null}

      {project.blocks.map((block) => {
        const timeSignature = effectiveBlockTimeSignature(project, block);
        const durationIssue =
          block.sourceType === "generated"
            ? getRenderDurationIssue({ bars: block.bars, bpm: project.song.bpm, timeSignature })
            : null;

        return (
          <article className={`work-panel ${durationIssue ? "render-too-long" : ""}`} key={block.id}>
            <div className="flex items-start justify-between gap-4">
              <label className="min-w-0 flex-1">
                <span className="sr-only">Block name</span>
                <input
                  className="block-title-input"
                  readOnly={block.sourceType === "imported"}
                  value={block.name}
                  onChange={(event) => updateBlock(block.id, { name: event.currentTarget.value }, "set_block_name")}
                />
              </label>
              <div className="flex shrink-0 items-start gap-2">
                {durationIssue ? (
                  <span
                    className="duration-warning-icon mt-1"
                    title={formatRenderDurationWarning(`${block.name} block`, durationIssue)}
                  >
                    <AlertTriangle size={17} />
                  </span>
                ) : null}
                <button
                  className="icon-button danger mt-1"
                  type="button"
                  title="Remove block"
                  onClick={() => setPendingRemoveBlockId(block.id)}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            </div>

            {block.sourceType === "imported" ? (
              <div className="mt-4 grid gap-4 md:grid-cols-[160px_minmax(0,1fr)]">
                <label className="field-group">
                  <span>Bars</span>
                  <input
                    className="field"
                    type="number"
                    min={1}
                    max={64}
                    value={block.bars}
                    onChange={(event) =>
                      updateBlock(
                        block.id,
                        { bars: parseInteger(event.currentTarget.value, block.bars, 1, 64) },
                        "set_imported_block_bars",
                      )
                    }
                  />
                </label>
                <label className="field-group">
                  <span>Imported Stem</span>
                  <input
                    className="field"
                    readOnly
                    value={project.stems.find((stem) => stem.id === block.importedStemId)?.fileName ?? "Missing imported stem"}
                  />
                </label>
              </div>
            ) : (
              <>
                <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_150px_260px]">
                  <label className="field-group">
                    <span>Melody Prompt</span>
                    <input
                      className="field"
                      value={block.melodyPrompt}
                      onChange={(event) =>
                        updateBlock(block.id, { melodyPrompt: event.currentTarget.value }, "set_block_melody_prompt")
                      }
                    />
                  </label>

                  <label className="field-group">
                    <span>Bars</span>
                    <input
                      className="field"
                      type="number"
                      min={1}
                      max={16}
                      value={block.bars}
                      onChange={(event) =>
                        updateBlock(
                          block.id,
                          { bars: parseInteger(event.currentTarget.value, block.bars, 1, 16) },
                          "set_block_bars",
                        )
                      }
                    />
                  </label>

                  <div className="grid gap-2">
                    <label className="field-group">
                      <span>Time Sig</span>
                      <select
                        className="field"
                        value={block.timeSignature ? "override" : "project"}
                        onChange={(event) =>
                          updateBlock(
                            block.id,
                            { timeSignature: event.currentTarget.value === "override" ? project.song.timeSignature : null },
                            "set_block_time_signature_mode",
                          )
                        }
                      >
                        <option value="project">Project {formatTimeSignature(project.song.timeSignature)}</option>
                        <option value="override">Override</option>
                      </select>
                    </label>
                    <div className="grid grid-cols-[1fr_12px_1fr] items-center gap-2">
                      <input
                        className="field px-2 text-center"
                        type="number"
                        min={1}
                        max={32}
                        disabled={!block.timeSignature}
                        value={(block.timeSignature ?? project.song.timeSignature)[0]}
                        onChange={(event) => updateBlockTimeSignature(block, 0, event.currentTarget.value)}
                        aria-label={`${block.name} time signature beats`}
                      />
                      <span className="text-center text-genost-muted">/</span>
                      <input
                        className="field px-2 text-center"
                        type="number"
                        min={1}
                        max={32}
                        disabled={!block.timeSignature}
                        value={(block.timeSignature ?? project.song.timeSignature)[1]}
                        onChange={(event) => updateBlockTimeSignature(block, 1, event.currentTarget.value)}
                        aria-label={`${block.name} time signature beat value`}
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_180px_220px_minmax(0,1fr)]">
                  <label className="field-group">
                    <span>Instruments</span>
                    <input
                      className="field"
                      value={block.instruments.join(", ")}
                      onChange={(event) =>
                        updateBlock(
                          block.id,
                          {
                            instruments: event.currentTarget.value
                              .split(",")
                              .map((item) => item.trim())
                              .filter(Boolean),
                          },
                          "set_block_instruments",
                        )
                      }
                    />
                  </label>

                  <label className="field-group">
                    <span>Separator Target *</span>
                    <select
                      className="field capitalize"
                      required
                      value={block.separatorTarget}
                      onChange={(event) =>
                        updateBlock(
                          block.id,
                          { separatorTarget: event.currentTarget.value as SeparatorTarget },
                          "set_block_separator_target",
                        )
                      }
                    >
                      {SEPARATOR_TARGET_VALUES.map((target) => (
                        <option key={target} value={target}>
                          {target}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field-group">
                    <span>Sound Character *</span>
                    <select
                      className="field"
                      required
                      value={block.soundCharacter}
                      onChange={(event) =>
                        updateBlock(
                          block.id,
                          { soundCharacter: event.currentTarget.value as SoundCharacter },
                          "set_block_sound_character",
                        )
                      }
                    >
                      {SOUND_CHARACTER_VALUES.map((character) => (
                        <option key={character} value={character}>
                          {character}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field-group">
                    <span>Melody Description</span>
                    <input
                      className="field"
                      value={block.melodyDescription}
                      onChange={(event) =>
                        updateBlock(block.id, { melodyDescription: event.currentTarget.value }, "set_block_melody_description")
                      }
                    />
                  </label>
                </div>

                <div className="mt-4 grid gap-4 xl:grid-cols-3">
                  <label className="field-group">
                    <span>Role</span>
                    <input
                      className="field"
                      value={block.role}
                      onChange={(event) => updateBlock(block.id, { role: event.currentTarget.value }, "set_block_role")}
                    />
                  </label>
                  <label className="field-group">
                    <span>Rhythm Feel</span>
                    <input
                      className="field"
                      value={block.rhythmFeel}
                      onChange={(event) => updateBlock(block.id, { rhythmFeel: event.currentTarget.value }, "set_block_rhythm_feel")}
                    />
                  </label>
                  <label className="field-group">
                    <span>Timbre / Texture</span>
                    <input
                      className="field"
                      value={block.timbre}
                      onChange={(event) => updateBlock(block.id, { timbre: event.currentTarget.value }, "set_block_timbre")}
                    />
                  </label>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_160px_160px]">
                  <label className="field-group">
                    <span>Block Avoid</span>
                    <input
                      className="field"
                      value={block.avoid}
                      onChange={(event) => updateBlock(block.id, { avoid: event.currentTarget.value }, "set_block_avoid")}
                    />
                  </label>
                  <label className="field-group">
                    <span>Energy {block.energy}/10</span>
                    <input
                      className="field"
                      type="range"
                      min={1}
                      max={10}
                      value={block.energy}
                      onChange={(event) =>
                        updateBlock(block.id, { energy: Number(event.currentTarget.value) }, "set_block_energy")
                      }
                    />
                  </label>
                  <label className="field-group">
                    <span>Density {block.density}/10</span>
                    <input
                      className="field"
                      type="range"
                      min={1}
                      max={10}
                      value={block.density}
                      onChange={(event) =>
                        updateBlock(block.id, { density: Number(event.currentTarget.value) }, "set_block_density")
                      }
                    />
                  </label>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-4">
                  <label className="field-group">
                    <span>Volume dB</span>
                    <input
                      className="field"
                      type="number"
                      min={-60}
                      max={12}
                      value={block.volumeDb}
                      onChange={(event) =>
                        updateBlock(block.id, { volumeDb: Number(event.currentTarget.value) }, "set_block_volume")
                      }
                    />
                  </label>
                  <label className="field-group">
                    <span>Delay</span>
                    <input
                      className="field"
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      value={block.delaySend}
                      onChange={(event) =>
                        updateBlock(block.id, { delaySend: Number(event.currentTarget.value) }, "set_block_delay")
                      }
                    />
                  </label>
                  <label className="field-group">
                    <span>Reverb</span>
                    <input
                      className="field"
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      value={block.reverbSend}
                      onChange={(event) =>
                        updateBlock(block.id, { reverbSend: Number(event.currentTarget.value) }, "set_block_reverb")
                      }
                    />
                  </label>
                  <label className="field-group">
                    <span>Compressor</span>
                    <select
                      className="field"
                      value={block.compressorEnabled ? "on" : "off"}
                      onChange={(event) =>
                        updateBlock(block.id, { compressorEnabled: event.currentTarget.value === "on" }, "set_block_compressor")
                      }
                    >
                      <option value="off">Off</option>
                      <option value="on">On</option>
                    </select>
                  </label>
                </div>

                <div className="mt-4 grid gap-2 border-t border-genost-line pt-3 text-sm text-genost-muted">
                  <span>Implemented melodies: {block.implementedMelodies.length}</span>
                  {block.implementedMelodies.map((melody) => {
                    const stem = project.stems.find((item) => item.id === melody.stemId);
                    const hasAudio = Boolean(resolveProjectAssetPath(projectPath, stem?.filePath));
                    const previewing = previewStemId === melody.stemId;
                    return (
                      <div className="implemented-melody-row" key={melody.id}>
                        <span className="min-w-0 flex-1 truncate">{stem?.fileName ?? melody.stemId}</span>
                        <span className={`status-pill ${stem?.status === "ready" ? "ready" : "warning"}`}>{stem?.status ?? "missing"}</span>
                        <button className="icon-button" disabled={renderBlocked || !stem || !["missing", "stale", "failed", "canceled"].includes(stem.status)} onClick={() => queueMelody(melody.stemId, false)} title="Render component" type="button"><WandSparkles size={15} /></button>
                        <button className="icon-button" disabled={renderBlocked || !stem || ["queued", "rendering"].includes(stem.status)} onClick={() => queueMelody(melody.stemId, true)} title="Regenerate component" type="button"><RotateCcw size={15} /></button>
                        <button className={`icon-button ${previewing ? "active" : ""}`} disabled={!hasAudio} onClick={() => toggleMelodyPreview(melody.stemId)} title={previewing ? "Pause preview" : "Preview component"} type="button">{previewing ? <Pause size={15} /> : <Play size={15} />}</button>
                        <button className="icon-button" disabled={!hasAudio} onClick={() => void revealMelody(melody.stemId)} title="Reveal component" type="button"><FolderOpen size={15} /></button>
                        <button className="icon-button" disabled={!hasAudio || separationBusyId === melody.stemId} onClick={() => void separateImplementedStem(block.id, melody.stemId)} title="Separate into six retained stems" type="button">{separationBusyId === melody.stemId ? <LoaderCircle className="animate-spin" size={15} /> : <AudioLines size={15} />}</button>
                        <button className="icon-button danger" disabled={!stem || ["queued", "rendering"].includes(stem.status)} onClick={() => void archiveMelody(melody.stemId)} title="Archive component" type="button"><Archive size={15} /></button>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </article>
        );
      })}

      {pendingRemoveBlock ? (
        <div className="confirm-backdrop">
          <div aria-modal="true" className="confirm-dialog" role="dialog">
            <div className="flex items-start gap-3">
              <span className="duration-warning-icon compact mt-1"><Trash2 size={14} /></span>
              <div className="min-w-0">
                <h2>Remove {pendingRemoveBlock.name}?</h2>
                <p>
                  {pendingClips.length} arranger clip{pendingClips.length === 1 ? "" : "s"} will be removed and {pendingStems.length} stem{pendingStems.length === 1 ? "" : "s"} will be preserved under ARCHIVE as detached audio.
                </p>
              </div>
            </div>
            <div className="confirm-actions">
              <button className="control-button" disabled={isRemovingBlock} onClick={() => setPendingRemoveBlockId(null)} type="button">Cancel</button>
              <button className="control-button danger" disabled={isRemovingBlock} onClick={() => void removePendingBlock()} type="button">
                {isRemovingBlock ? "Archiving…" : "Archive & Remove"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
