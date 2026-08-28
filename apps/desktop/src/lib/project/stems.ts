import type { GenostProject } from "../schema/project";
import { markStemDependencyChainStale } from "./graph";

export type ArchivedStemRecord = {
  stemId: string;
  originalFilePath: string | null;
  archivePath: string | null;
  archiveFileName: string | null;
};

export function detachGeneratedStems(
  project: GenostProject,
  stemIds: string[],
  archivedAssets: ArchivedStemRecord[] = [],
  reason = "Archived from Components.",
): GenostProject {
  const selectedStemIds = new Set(stemIds);
  if (selectedStemIds.size === 0) {
    return project;
  }

  const archivedByStemId = new Map(archivedAssets.map((asset) => [asset.stemId, asset]));
  const timestamp = new Date().toISOString();
  const detached: GenostProject = {
    ...project,
    blocks: project.blocks.map((block) => ({
      ...block,
      implementedMelodies: block.implementedMelodies.filter((melody) => !selectedStemIds.has(melody.stemId)),
    })),
    arrangement: {
      lanes: project.arrangement.lanes.map((lane) => ({
        ...lane,
        clips: lane.clips.map((clip) => ({
          ...clip,
          inputStemId: clip.inputStemId && selectedStemIds.has(clip.inputStemId) ? null : clip.inputStemId,
          stemId: clip.stemId && selectedStemIds.has(clip.stemId) ? null : clip.stemId,
        })),
      })),
    },
    stems: project.stems.map((stem) => {
      if (!selectedStemIds.has(stem.id)) {
        return stem;
      }
      const archived = archivedByStemId.get(stem.id);
      return {
        ...stem,
        status: "detached" as const,
        queueOrder: null,
        fileName:
          archived?.archiveFileName ??
          (stem.fileName.startsWith("DETACHED_") ? stem.fileName : `DETACHED_${stem.fileName}`),
        filePath: null,
        archivePath: archived?.archivePath ?? stem.archivePath,
        staleReason: reason,
        error: null,
        updatedAt: timestamp,
      };
    }),
    mix: { ...project.mix, lastBuildPath: null },
  };

  return markStemDependencyChainStale(
    detached,
    stemIds,
    `${reason} Conditioned descendants are stale.`,
  );
}
