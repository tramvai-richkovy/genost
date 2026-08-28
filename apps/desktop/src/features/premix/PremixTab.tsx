import { convertFileSrc } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Archive, Blend, FolderOpen, LoaderCircle, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStudioStore } from "../../app/store";
import {
  normalizeSeparationVolumeDb,
  SeparationBundleLoopPreview,
} from "../../lib/audio/separationBundlePreview";
import { isUriAssetPath, resolveProjectAssetPath } from "../../lib/audio/paths";
import { makeId } from "../../lib/project/format";
import { visibleSeparationBundles } from "../../lib/project/separationBundles";
import { archiveSeparationBundle } from "../../lib/project/storage";
import type { SeparationBundle, SeparationOutput } from "../../lib/schema/project";
import { mergeSeparationOutputs } from "../../lib/worker-client/separation";

type ActiveBundlePreview = {
  bundleId: string;
  preview: SeparationBundleLoopPreview;
};

export function PremixTab() {
  const activeProject = useStudioStore((state) => state.activeProject);
  const mutateActiveProject = useStudioStore((state) => state.mutateActiveProject);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bundlePreviewRef = useRef<ActiveBundlePreview | null>(null);
  const previewRequestRef = useRef(0);
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);
  const [previewBundleId, setPreviewBundleId] = useState<string | null>(null);
  const [loadingBundleId, setLoadingBundleId] = useState<string | null>(null);
  const [busyBundleId, setBusyBundleId] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [volumeDrafts, setVolumeDrafts] = useState<Record<string, number>>({});

  useEffect(() => () => {
    previewRequestRef.current += 1;
    audioRef.current?.pause();
    bundlePreviewRef.current?.preview.stop();
  }, []);

  if (!activeProject) return null;
  const { project, path: projectPath } = activeProject;
  const bundles = visibleSeparationBundles(project.separationBundles);

  function stopIndividualPreview() {
    audioRef.current?.pause();
    audioRef.current = null;
    setPreviewAssetId(null);
  }

  function stopBundlePreview() {
    previewRequestRef.current += 1;
    bundlePreviewRef.current?.preview.stop();
    bundlePreviewRef.current = null;
    setPreviewBundleId(null);
    setLoadingBundleId(null);
  }

  function outputVolume(output: SeparationOutput): number {
    return volumeDrafts[output.id] ?? output.volumeDb;
  }

  function previewOutputVolume(bundleId: string, outputId: string, value: number) {
    const volumeDb = normalizeSeparationVolumeDb(value);
    setVolumeDrafts((current) => ({ ...current, [outputId]: volumeDb }));
    if (bundlePreviewRef.current?.bundleId === bundleId) {
      bundlePreviewRef.current.preview.setVolume(outputId, volumeDb);
    }
  }

  function commitOutputVolume(bundleId: string, outputId: string, value: number) {
    const volumeDb = normalizeSeparationVolumeDb(value);
    const bundle = project.separationBundles.find((item) => item.id === bundleId);
    const output = bundle?.outputs.find((item) => item.id === outputId);
    setVolumeDrafts((current) => {
      const next = { ...current };
      delete next[outputId];
      return next;
    });
    if (!output || output.volumeDb === volumeDb) return;

    mutateActiveProject(
      {
        type: "set_separation_output_volume",
        summary: `Set ${output.label} premix level to ${volumeDb} dB`,
        payload: { bundleId, outputId, label: output.label, volumeDb },
      },
      (current) => ({
        ...current,
        separationBundles: current.separationBundles.map((item) => item.id === bundleId ? {
          ...item,
          outputs: item.outputs.map((candidate) => candidate.id === outputId ? { ...candidate, volumeDb } : candidate),
          updatedAt: new Date().toISOString(),
        } : item),
      }),
    );
  }

  async function toggleBundlePreview(bundle: SeparationBundle) {
    if (previewBundleId === bundle.id || loadingBundleId === bundle.id) {
      stopBundlePreview();
      return;
    }

    stopIndividualPreview();
    stopBundlePreview();
    setPreviewError(null);
    const tracks = bundle.outputs.flatMap((output) => {
      if (output.status !== "ready") return [];
      const path = resolveProjectAssetPath(projectPath, output.filePath);
      return path ? [{ id: output.id, path, volumeDb: outputVolume(output) }] : [];
    });
    if (tracks.length === 0) {
      setPreviewError("This bundle has no playable outputs.");
      return;
    }

    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    setLoadingBundleId(bundle.id);
    try {
      const preview = await SeparationBundleLoopPreview.create(tracks);
      if (previewRequestRef.current !== requestId) {
        preview.stop();
        return;
      }
      bundlePreviewRef.current = { bundleId: bundle.id, preview };
      setPreviewBundleId(bundle.id);
    } catch (error) {
      if (previewRequestRef.current === requestId) {
        setPreviewError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (previewRequestRef.current === requestId) setLoadingBundleId(null);
    }
  }

  function toggleAssetPreview(assetId: string, filePath: string | null) {
    stopBundlePreview();
    if (previewAssetId === assetId) {
      stopIndividualPreview();
      return;
    }
    stopIndividualPreview();
    setPreviewError(null);
    const path = resolveProjectAssetPath(projectPath, filePath);
    if (!path) return;
    const audio = new Audio(isUriAssetPath(path) ? path : convertFileSrc(path));
    audioRef.current = audio;
    setPreviewAssetId(assetId);
    audio.onended = () => setPreviewAssetId(null);
    audio.onerror = () => {
      setPreviewAssetId(null);
      setPreviewError("Could not load premix audio.");
    };
    void audio.play().catch((error: unknown) => {
      setPreviewAssetId(null);
      setPreviewError(error instanceof Error ? error.message : String(error));
    });
  }

  function selectOutput(bundleId: string, outputId: string, selected: boolean) {
    mutateActiveProject(
      { type: "select_separation_output", summary: "Updated premix merge selection", payload: { bundleId, outputId, selected } },
      (current) => ({
        ...current,
        separationBundles: current.separationBundles.map((bundle) => bundle.id === bundleId ? {
          ...bundle,
          selectedOutputIds: selected
            ? Array.from(new Set([...bundle.selectedOutputIds, outputId]))
            : bundle.selectedOutputIds.filter((id) => id !== outputId),
          updatedAt: new Date().toISOString(),
        } : bundle),
      }),
    );
  }

  async function mergeSelectedOutputs(bundleId: string) {
    const bundle = project.separationBundles.find((item) => item.id === bundleId);
    if (!bundle || !projectPath || bundle.selectedOutputIds.length === 0) return;
    const selected = bundle.outputs.filter((output) => bundle.selectedOutputIds.includes(output.id));
    const paths = selected.map((output) => resolveProjectAssetPath(projectPath, output.filePath)).filter((path): path is string => Boolean(path));
    if (paths.length !== selected.length || paths.some(isUriAssetPath)) return;

    const levels = selected.map((output) => outputVolume(output));
    const outputLevelsDb = Object.fromEntries(selected.map((output, index) => [output.id, levels[index]]));
    const mergeId = makeId("merge");
    const fileName = `${mergeId}.wav`;
    const destination = await join(projectPath, "STEMS", "SEPARATIONS", bundleId, "MERGES", fileName);
    setBusyBundleId(bundleId);
    setPreviewError(null);
    try {
      const result = await mergeSeparationOutputs({
        merge_id: mergeId,
        output_paths: paths,
        input_gains_db: levels,
        destination_path: destination,
      });
      const createdAt = new Date().toISOString();
      mutateActiveProject(
        {
          type: result.status === "ready" ? "merge_separation_outputs_completed" : "merge_separation_outputs_failed",
          summary: result.status === "ready" ? "Published premix merge" : "Premix merge failed",
          payload: { bundleId, mergeId, outputIds: bundle.selectedOutputIds, outputLevelsDb, errorCode: result.error_code, error: result.error },
          actor: result.status === "ready" ? "user" : "worker",
          source: result.status === "ready" ? "web-ui" : "worker",
        },
        (current) => ({
          ...current,
          separationBundles: current.separationBundles.map((item) => item.id === bundleId ? {
            ...item,
            merges: result.status === "ready" ? [...item.merges, {
              id: mergeId,
              outputIds: [...item.selectedOutputIds],
              outputLevelsDb,
              fileName: result.file_name ?? fileName,
              filePath: `STEMS/SEPARATIONS/${bundleId}/MERGES/${result.file_name ?? fileName}`,
              status: "ready" as const,
              archivePath: null,
              createdAt,
            }] : item.merges,
            errorCode: result.error_code,
            error: result.error,
            updatedAt: createdAt,
          } : item),
        }),
      );
      if (result.status === "failed") setPreviewError(result.error ?? "Premix merge failed.");
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyBundleId(null);
    }
  }

  async function revealAsset(bundleId: string, assetId: string, filePath: string | null) {
    const path = resolveProjectAssetPath(projectPath, filePath);
    if (!path || isUriAssetPath(path)) return;
    try {
      await revealItemInDir(path);
      mutateActiveProject({ type: "reveal_separation_output", summary: "Revealed premix asset", payload: { bundleId, assetId, filePath } }, (current) => current);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : String(error));
    }
  }

  async function archiveBundle(bundleId: string) {
    if (!projectPath) return;
    if (previewBundleId === bundleId) stopBundlePreview();
    try {
      const archivePath = await archiveSeparationBundle(projectPath, bundleId);
      mutateActiveProject(
        { type: "archive_separation_bundle", summary: "Archived premix bundle", payload: { bundleId, archivePath } },
        (current) => ({ ...current, separationBundles: current.separationBundles.map((bundle) => bundle.id === bundleId ? {
          ...bundle,
          status: "archived",
          outputs: bundle.outputs.map((output) => ({ ...output, status: "archived", filePath: output.filePath?.replace(`STEMS/SEPARATIONS/${bundleId}`, archivePath) ?? null })),
          merges: bundle.merges.map((merge) => ({ ...merge, status: "archived", archivePath, filePath: merge.filePath?.replace(`STEMS/SEPARATIONS/${bundleId}`, archivePath) ?? null })),
          updatedAt: new Date().toISOString(),
        } : bundle) }),
      );
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="section-title">Premix</h2>
          <span className="text-sm text-genost-muted">{bundles.length} active bundle(s)</span>
        </div>
        {previewBundleId ? <span className="status-pill ready">Looping bundle</span> : null}
      </div>
      {previewError ? <div className="graph-warning">{previewError}</div> : null}
      {bundles.length === 0 ? <div className="work-panel text-sm text-genost-muted">No separation bundles</div> : null}

      {project.blocks.map((block) => {
        const blockBundles = bundles.filter((bundle) => bundle.blockId === block.id);
        if (blockBundles.length === 0) return null;
        return (
          <section className="work-panel" key={block.id}>
            <div className="flex items-center justify-between gap-3">
              <h3 className="block-title-input">{block.name}</h3>
              <span className="status-pill">{blockBundles.length} bundle(s)</span>
            </div>
            {blockBundles.map((bundle) => {
              const sourceStem = project.stems.find((stem) => stem.id === bundle.sourceStemId);
              const bundlePlaying = previewBundleId === bundle.id;
              const bundleLoading = loadingBundleId === bundle.id;
              return (
                <div className="separation-bundle" key={bundle.id}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <strong>Six-stem bundle</strong>
                      <span className="ml-2 text-xs text-genost-muted">{bundle.model} · {sourceStem?.fileName ?? bundle.sourceStemId} · preferred {bundle.preferredTarget}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button className={`control-button ${bundlePlaying ? "active" : ""}`} disabled={bundle.status !== "ready" || bundle.outputs.length === 0} onClick={() => void toggleBundlePreview(bundle)} title={bundlePlaying || bundleLoading ? "Stop bundle loop" : "Play bundle in loop"} type="button">
                        {bundleLoading ? <LoaderCircle className="animate-spin" size={15} /> : bundlePlaying ? <Pause size={15} /> : <Play size={15} />}
                        {bundlePlaying ? "Stop Loop" : bundleLoading ? "Loading" : "Play Loop"}
                      </button>
                      <span className={`status-pill ${bundle.status === "ready" ? "ready" : "warning"}`}>{bundle.status}</span>
                      <button className="icon-button danger" disabled={bundle.status === "separating"} onClick={() => void archiveBundle(bundle.id)} title="Archive bundle without deleting sources" type="button"><Archive size={15} /></button>
                    </div>
                  </div>
                  {bundle.error ? <div className="graph-warning mt-2">{bundle.errorCode}: {bundle.error}</div> : null}
                  <div className="mt-2 grid gap-1">
                    {bundle.outputs.map((output) => {
                      const previewing = previewAssetId === output.id;
                      const volumeDb = outputVolume(output);
                      return (
                        <div className="separation-output-row premix-output-row" key={output.id}>
                          <input aria-label={`Select ${output.label} for merge`} checked={bundle.selectedOutputIds.includes(output.id)} onChange={(event) => selectOutput(bundle.id, output.id, event.currentTarget.checked)} type="checkbox" />
                          <span className="font-semibold uppercase">{output.label}</span>
                          {output.label === bundle.preferredTarget ? <span className="status-pill ready">Preferred</span> : <span />}
                          <span className="truncate text-xs text-genost-muted">{output.durationSeconds?.toFixed(2)}s · peak {output.peak?.toFixed(3)}</span>
                          <label className="premix-volume">
                            <span>{volumeDb > 0 ? "+" : ""}{volumeDb} dB</span>
                            <input
                              aria-label={`${output.label} premix volume`}
                              max={6}
                              min={-60}
                              onBlur={(event) => commitOutputVolume(bundle.id, output.id, Number(event.currentTarget.value))}
                              onChange={(event) => previewOutputVolume(bundle.id, output.id, Number(event.currentTarget.value))}
                              onKeyUp={(event) => commitOutputVolume(bundle.id, output.id, Number(event.currentTarget.value))}
                              onPointerUp={(event) => commitOutputVolume(bundle.id, output.id, Number(event.currentTarget.value))}
                              step={1}
                              type="range"
                              value={volumeDb}
                            />
                          </label>
                          <button className={`icon-button ${previewing ? "active" : ""}`} onClick={() => toggleAssetPreview(output.id, output.filePath)} title={previewing ? "Pause separated output" : "Play separated output"} type="button">{previewing ? <Pause size={14} /> : <Play size={14} />}</button>
                          <button className="icon-button" onClick={() => void revealAsset(bundle.id, output.id, output.filePath)} title="Reveal separated output" type="button"><FolderOpen size={14} /></button>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 border-t border-genost-line pt-2">
                    <span className="text-xs text-genost-muted">{bundle.selectedOutputIds.length} selected · {bundle.merges.length} preserved merge(s)</span>
                    <button className="control-button" disabled={bundle.selectedOutputIds.length === 0 || busyBundleId === bundle.id} onClick={() => void mergeSelectedOutputs(bundle.id)} type="button">{busyBundleId === bundle.id ? <LoaderCircle className="animate-spin" size={15} /> : <Blend size={15} />} Merge Selected</button>
                  </div>
                  {bundle.merges.map((merge) => (
                    <div className="separation-output-row premix-output-row mt-1" key={merge.id}>
                      <span />
                      <span className="font-semibold uppercase">Merge</span>
                      <span className="status-pill ready">{merge.outputIds.length} stems</span>
                      <span className="truncate text-xs text-genost-muted">{merge.fileName}</span>
                      <span className="truncate text-xs text-genost-muted">Saved levels</span>
                      <button className={`icon-button ${previewAssetId === merge.id ? "active" : ""}`} onClick={() => toggleAssetPreview(merge.id, merge.filePath)} title="Play merged derivative" type="button">{previewAssetId === merge.id ? <Pause size={14} /> : <Play size={14} />}</button>
                      <button className="icon-button" onClick={() => void revealAsset(bundle.id, merge.id, merge.filePath)} title="Reveal merged derivative" type="button"><FolderOpen size={14} /></button>
                    </div>
                  ))}
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
