import { join } from "@tauri-apps/api/path";
import { useEffect, useRef, useState } from "react";
import { useStudioStore } from "../../app/store";
import { resolveProjectAssetPath } from "../../lib/audio/paths";
import {
  composeStemPrompt,
  composeVariationStemPrompt,
  effectiveBlockTimeSignature,
  makeId,
  nowIso,
  stemRequirementHash,
} from "../../lib/project/format";
import { writeStemSidecar } from "../../lib/project/storage";
import type { GenostBlock, GenostProject, GenostStem } from "../../lib/schema/project";
import {
  getWorkerJob,
  renderStem,
  type AudioContentCategory,
  type WorkerJobStatus,
  type WorkerRenderResponse,
  WorkerRenderCanceledError,
  WorkerRenderFailedError,
} from "../../lib/worker-client/render";

function blockText(block: GenostBlock): string {
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

export function audioContentCategoryForBlock(block: GenostBlock): AudioContentCategory {
  const text = blockText(block);
  if (/\b(bass|sub|reese|drone|low end)\b/.test(text)) {
    return "bass_drone";
  }
  if (/\b(drum|drums|kick|snare|hat|hats|break|percussion|perc|tom|toms|rhythm|beat)\b/.test(text)) {
    return "rhythm";
  }
  if (/\b(lead|melody|melodic|hook|arp|arpeggio|bell|pluck|guitar|choir|voice|vocal|horn|pad|chord)\b/.test(text)) {
    return "melody";
  }
  return "generic";
}

export function generationKindForRequest(conditioned: boolean, fixtureToneMode: boolean): "text" | "conditioned" | "fixture" {
  if (fixtureToneMode) return "fixture";
  return conditioned ? "conditioned" : "text";
}

function nextQueuedStem(project: GenostProject): GenostStem | null {
  return (
    [...project.stems]
      .filter((stem) => stem.status === "queued")
      .sort((left, right) => (left.queueOrder ?? Number.MAX_SAFE_INTEGER) - (right.queueOrder ?? Number.MAX_SAFE_INTEGER))
      .find((stem) => {
        if (!stem.inputStemId) {
          return true;
        }
        const inputStem = project.stems.find((item) => item.id === stem.inputStemId);
        return !inputStem || !["queued", "rendering"].includes(inputStem.status);
      }) ??
    null
  );
}

export type InterruptedRenderRecovery =
  | { action: "persist-ready" }
  | { action: "mark-canceled"; message: string }
  | { action: "mark-failed"; errorCode: string; message: string }
  | { action: "wait" }
  | { action: "requeue" };

export function getInterruptedRenderRecovery(job: WorkerJobStatus | null): InterruptedRenderRecovery {
  if (job?.status === "ready" && job.details) {
    return { action: "persist-ready" };
  }

  if (job?.status === "canceled") {
    return { action: "mark-canceled", message: job.message };
  }

  if (job?.status === "failed") {
    return {
      action: "mark-failed",
      errorCode: job.details?.error_code ?? "generation_failed",
      message: job.details?.error || job.message || "Worker render failed.",
    };
  }

  if (job) {
    return { action: "wait" };
  }

  return { action: "requeue" };
}

function relativeStemPath(fileName: string): string {
  return `STEMS/${fileName}`;
}

type MutateActiveProject = ReturnType<typeof useStudioStore.getState>["mutateActiveProject"];

async function persistCompletedRender(args: {
  projectPath: string;
  projectSnapshot: GenostProject;
  stem: GenostStem;
  block: GenostBlock;
  result: WorkerRenderResponse;
  mutateActiveProject: MutateActiveProject;
}): Promise<void> {
  const { projectPath, projectSnapshot, stem, block, result, mutateActiveProject } = args;
  const prompt =
    stem.variation > 1 && stem.inputStemId
      ? composeVariationStemPrompt(projectSnapshot, block, stem.variation)
      : composeStemPrompt(projectSnapshot, block, stem.variation);
  const inputStem = stem.inputStemId
    ? projectSnapshot.stems.find((item) => item.id === stem.inputStemId && item.status === "ready") ?? null
    : null;
  const category = audioContentCategoryForBlock(block);
  const outputPath = await join(projectPath, "STEMS", stem.fileName);
  const generatedAt = nowIso();
  await writeStemSidecar(outputPath, {
    schemaVersion: 1,
    id: stem.id,
    blockId: block.id,
    variation: stem.variation,
    inputStemId: stem.inputStemId,
    inputStemPath: inputStem?.filePath ?? null,
    prompt,
    promptHash: stem.promptHash,
    backend: result.backend,
    model: result.model ?? stem.model,
    seed: stem.seed,
    durationSeconds: result.validation_metrics?.duration_seconds ?? stem.durationSeconds,
    sampleRate: result.sample_rate ?? projectSnapshot.song.sampleRate,
    device: result.device,
    generationSettings: {
      backend: result.backend,
      device: result.device,
      durationSeconds: stem.durationSeconds,
      sampleRate: result.sample_rate ?? projectSnapshot.song.sampleRate,
      seed: stem.seed,
      validationProfile: "music",
      validationCategory: category,
    },
    validationMetrics: result.validation_metrics,
    validationCategory: category,
    generationSeconds: result.generation_seconds,
    filePath: relativeStemPath(stem.fileName),
    generatedAt,
  });

  if (useStudioStore.getState().activeProject?.path !== projectPath) {
    return;
  }
  finishSuccessfulRender(stem, block, result, relativeStemPath(stem.fileName), mutateActiveProject);
}

export function RenderQueueProcessor() {
  const activeProject = useStudioStore((state) => state.activeProject);
  const musicAiMode = useStudioStore((state) => state.musicAiMode);
  const mutateActiveProject = useStudioStore((state) => state.mutateActiveProject);
  const setWorkerJob = useStudioStore((state) => state.setWorkerJob);
  const processingRef = useRef<string | null>(null);
  const [reconcileTick, setReconcileTick] = useState(0);

  useEffect(() => {
    if (musicAiMode !== "online" || !activeProject?.path || processingRef.current) {
      return;
    }

    const interruptedStem = activeProject.project.stems.find((item) => item.status === "rendering");
    if (interruptedStem) {

      const projectPath = activeProject.path;
      const projectSnapshot = activeProject.project;
      const block = projectSnapshot.blocks.find((item) => item.id === interruptedStem.blockId);
      const processingKey = `${projectPath}:${interruptedStem.id}:reconcile`;
      processingRef.current = processingKey;
      void getWorkerJob(interruptedStem.id)
        .then(async (job) => {
          if (useStudioStore.getState().activeProject?.path !== projectPath) {
            return;
          }
          if (job) {
            setWorkerJob(job);
          }
          const recovery = getInterruptedRenderRecovery(job);
          if (recovery.action === "persist-ready" && job?.details && block) {
            await persistCompletedRender({
              projectPath,
              projectSnapshot,
              stem: interruptedStem,
              block,
              result: job.details,
              mutateActiveProject,
            });
            return;
          }
          if (recovery.action === "mark-canceled") {
            mutateActiveProject(
              {
                type: "render_component_canceled",
                summary: "Component render canceled",
                payload: { stemId: interruptedStem.id, message: recovery.message },
                actor: "worker",
                source: "worker",
              },
              (current) => ({
                ...current,
                stems: current.stems.map((item) =>
                  item.id === interruptedStem.id && item.status === "rendering"
                    ? { ...item, status: "canceled" as const, queueOrder: null, error: null, updatedAt: nowIso() }
                    : item,
                ),
              }),
            );
            return;
          }
          if (recovery.action === "mark-failed") {
            mutateActiveProject(
              {
                type: "render_component_failed",
                summary: "Component render failed",
                payload: {
                  stemId: interruptedStem.id,
                  errorCode: recovery.errorCode,
                  error: recovery.message,
                },
                actor: "worker",
                source: "worker",
              },
              (current) => ({
                ...current,
                stems: current.stems.map((item) =>
                  item.id === interruptedStem.id && item.status === "rendering"
                    ? { ...item, status: "failed" as const, queueOrder: null, error: recovery.message, updatedAt: nowIso() }
                    : item,
                ),
              }),
            );
            return;
          }
          if (recovery.action === "wait") {
            window.setTimeout(() => setReconcileTick((value) => value + 1), 1000);
            return;
          }
          mutateActiveProject(
            {
              type: "render_component_recovered",
              summary: "Recovered interrupted component render",
              payload: { stemId: interruptedStem.id, reason: "worker_has_no_active_job" },
              actor: "system",
              source: "system",
            },
            (current) => ({
              ...current,
              stems: current.stems.map((item) =>
                item.id === interruptedStem.id && item.status === "rendering"
                  ? { ...item, status: "queued" as const, error: null, updatedAt: nowIso() }
                  : item,
              ),
            }),
          );
        })
        .catch((error: unknown) => {
          if (useStudioStore.getState().activeProject?.path !== projectPath) {
            return;
          }
          const message = error instanceof Error ? error.message : String(error);
          mutateActiveProject(
            {
              type: "render_component_failed",
              summary: "Could not reconcile component render",
              payload: { stemId: interruptedStem.id, error: message },
              actor: "worker",
              source: "worker",
            },
            (current) => ({
              ...current,
              stems: current.stems.map((item) =>
                item.id === interruptedStem.id && item.status === "rendering"
                  ? { ...item, status: "failed" as const, queueOrder: null, error: message, updatedAt: nowIso() }
                  : item,
              ),
            }),
          );
        })
        .finally(() => {
          if (processingRef.current === processingKey) {
            processingRef.current = null;
          }
        });
      return;
    }

    const stem = nextQueuedStem(activeProject.project);
    if (!stem) {
      return;
    }

    const block = activeProject.project.blocks.find((item) => item.id === stem.blockId);
    if (!block) {
      mutateActiveProject(
        {
          type: "render_component_failed",
          summary: "Component render failed",
          payload: { stemId: stem.id, error: `Missing block ${stem.blockId}` },
          actor: "worker",
          source: "worker",
        },
        (current) => ({
          ...current,
          stems: current.stems.map((item) =>
            item.id === stem.id
              ? { ...item, status: "failed" as const, queueOrder: null, error: `Missing block ${stem.blockId}`, updatedAt: nowIso() }
              : item,
          ),
        }),
      );
      return;
    }

    const projectPath = activeProject.path;
    const projectSnapshot = activeProject.project;
    const prompt =
      stem.variation > 1 && stem.inputStemId
        ? composeVariationStemPrompt(projectSnapshot, block, stem.variation)
        : composeStemPrompt(projectSnapshot, block, stem.variation);
    const inputStem = stem.inputStemId
      ? projectSnapshot.stems.find((item) => item.id === stem.inputStemId && item.status === "ready") ?? null
      : null;
    const inputPath = resolveProjectAssetPath(projectPath, inputStem?.filePath);
    const category = audioContentCategoryForBlock(block);
    const processingKey = `${projectPath}:${stem.id}`;
    processingRef.current = processingKey;

    mutateActiveProject(
      {
        type: "render_component_started",
        summary: `Rendering ${block.name} v${stem.variation}`,
        payload: { stemId: stem.id, blockId: block.id, variation: stem.variation, queueOrder: stem.queueOrder },
        actor: "worker",
        source: "worker",
      },
      (current) => ({
        ...current,
        stems: current.stems.map((item) =>
          item.id === stem.id && item.status === "queued"
            ? { ...item, status: "rendering" as const, error: null, updatedAt: nowIso() }
            : item,
        ),
      }),
    );

    void (async () => {
      try {
        if (stem.inputStemId && !inputPath) {
          throw new Error(`Conditioning stem ${stem.inputStemId} is not ready or has no audio file.`);
        }

        const currentStem = useStudioStore
          .getState()
          .activeProject?.project.stems.find((item) => item.id === stem.id);
        if (currentStem?.status !== "rendering") {
          return;
        }

        const outputPath = await join(projectPath, "STEMS", stem.fileName);
        const result = await renderStem(
          {
            job_id: stem.id,
            kind: generationKindForRequest(Boolean(inputPath), import.meta.env.VITE_GENOST_FIXTURE_TONE === "1"),
            prompt,
            output_path: outputPath,
            duration_seconds: Math.max(1, Math.round(stem.durationSeconds)),
            model_name: stem.model,
            reference_audio_path: inputPath,
            seed: stem.seed,
            model_cache_path: projectSnapshot.song.modelCachePath || null,
            backend: "auto",
            audio_validation_profile: "music",
            audio_content_category: category,
          },
          (job: WorkerJobStatus) => setWorkerJob(job),
        );

        await persistCompletedRender({ projectPath, projectSnapshot, stem, block, result, mutateActiveProject });
      } catch (error) {
        if (useStudioStore.getState().activeProject?.path !== projectPath) {
          return;
        }
        const canceled = error instanceof WorkerRenderCanceledError;
        const errorCode = error instanceof WorkerRenderFailedError ? error.code : "worker_client_failed";
        const message = error instanceof Error ? error.message : String(error);
        mutateActiveProject(
          {
            type: canceled ? "render_component_canceled" : "render_component_failed",
            summary: canceled
              ? `Canceled ${block.name} v${stem.variation}`
              : `Render failed for ${block.name} v${stem.variation}`,
            payload: { stemId: stem.id, blockId: block.id, variation: stem.variation, errorCode, error: message },
            actor: "worker",
            source: "worker",
          },
          (current) => ({
            ...current,
            stems: current.stems.map((item) =>
              item.id === stem.id && item.status === "rendering"
                ? {
                    ...item,
                    status: canceled ? ("canceled" as const) : ("failed" as const),
                    queueOrder: null,
                    error: canceled ? null : message,
                    updatedAt: nowIso(),
                  }
                : item,
            ),
          }),
        );
      } finally {
        if (processingRef.current === processingKey) {
          processingRef.current = null;
        }
      }
    })();
  }, [activeProject, musicAiMode, mutateActiveProject, reconcileTick, setWorkerJob]);

  return null;
}

function finishSuccessfulRender(
  stem: GenostStem,
  block: GenostBlock,
  result: WorkerRenderResponse,
  filePath: string,
  mutateActiveProject: ReturnType<typeof useStudioStore.getState>["mutateActiveProject"],
): void {
  const updatedAt = nowIso();
  mutateActiveProject(
    {
      type: "render_component_ready",
      summary: `Rendered ${block.name} v${stem.variation}`,
      payload: {
        stemId: stem.id,
        blockId: block.id,
        variation: stem.variation,
        filePath,
        backend: result.backend,
        device: result.device,
        generationSeconds: result.generation_seconds,
        validationMetrics: result.validation_metrics,
      },
      actor: "worker",
      source: "worker",
    },
    (current) => {
      const currentStem = current.stems.find((item) => item.id === stem.id);
      const currentBlock = current.blocks.find((item) => item.id === block.id);
      if (!currentStem || !currentBlock || !["rendering", "stale"].includes(currentStem.status)) {
        return current;
      }

      const beatsPerBar = effectiveBlockTimeSignature(current, currentBlock)[0];
      const renderedBars = Math.max(1, Math.round((stem.durationSeconds * current.song.bpm) / (beatsPerBar * 60)));
      const currentPromptHash = stemRequirementHash({
        project: current,
        block: { ...currentBlock, bars: renderedBars },
        variation: stem.variation,
        inputStemId: stem.inputStemId,
        seed: stem.seed,
      });
      const requirementsChanged = currentPromptHash !== stem.promptHash || currentStem.status === "stale";

      return {
        ...current,
        blocks: current.blocks.map((item) =>
          item.id === block.id
            ? {
                ...item,
                implementedMelodies: [
                  ...item.implementedMelodies.filter((melody) => melody.stemId !== stem.id),
                  { id: makeId("melody"), stemId: stem.id, textMetadata: `Variation ${stem.variation}`, createdAt: updatedAt },
                ],
              }
            : item,
        ),
        stems: current.stems.map((item) =>
          item.id === stem.id
            ? {
                ...item,
                status: requirementsChanged ? ("stale" as const) : ("ready" as const),
                queueOrder: null,
                filePath,
                durationSeconds: result.validation_metrics?.duration_seconds ?? item.durationSeconds,
                staleReason: requirementsChanged
                  ? item.staleReason ?? "Project requirements changed while this stem was rendering."
                  : null,
                error: null,
                renderMetadata: {
                  backend: result.backend,
                  device: result.device,
                  model: result.model,
                  generationSeconds: result.generation_seconds,
                  validationMetrics: result.validation_metrics,
                  completedAt: updatedAt,
                },
                updatedAt,
              }
            : item,
        ),
      };
    },
  );
}
