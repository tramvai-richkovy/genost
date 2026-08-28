import type { GenostProject, GenostStem } from "../schema/project";

export type BlockEdge = {
  sourceBlockId: string;
  targetBlockId: string;
};

export function latestReadyStemForBlock(project: GenostProject, blockId: string): GenostStem | null {
  return (
    [...project.stems]
      .filter((stem) => stem.blockId === blockId && stem.status === "ready")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null
  );
}

export function getBlockInputEdges(project: GenostProject): BlockEdge[] {
  const edgeKeys = new Set<string>();
  const edges: BlockEdge[] = [];

  for (const clip of project.arrangement.lanes.flatMap((lane) => lane.clips)) {
    if (!clip.inputBlockId || clip.inputBlockId === clip.blockId) {
      continue;
    }

    const key = `${clip.inputBlockId}->${clip.blockId}`;
    if (edgeKeys.has(key)) {
      continue;
    }

    edgeKeys.add(key);
    edges.push({ sourceBlockId: clip.inputBlockId, targetBlockId: clip.blockId });
  }

  return edges;
}

export function findBlockGraphCycle(project: GenostProject): string[] | null {
  const edges = getBlockInputEdges(project);
  const outgoing = new Map<string, string[]>();

  for (const edge of edges) {
    outgoing.set(edge.sourceBlockId, [...(outgoing.get(edge.sourceBlockId) ?? []), edge.targetBlockId]);
  }

  const visited = new Set<string>();
  const active = new Set<string>();
  const stack: string[] = [];

  function visit(blockId: string): string[] | null {
    if (active.has(blockId)) {
      return stack.slice(stack.indexOf(blockId)).concat(blockId);
    }

    if (visited.has(blockId)) {
      return null;
    }

    visited.add(blockId);
    active.add(blockId);
    stack.push(blockId);

    for (const nextBlockId of outgoing.get(blockId) ?? []) {
      const cycle = visit(nextBlockId);
      if (cycle) {
        return cycle;
      }
    }

    stack.pop();
    active.delete(blockId);
    return null;
  }

  for (const block of project.blocks) {
    const cycle = visit(block.id);
    if (cycle) {
      return cycle;
    }
  }

  return null;
}

export function collectDownstreamBlockIds(project: GenostProject, startingBlockIds: string[]): string[] {
  const edges = getBlockInputEdges(project);
  const downstream = new Set(startingBlockIds);
  const queue = [...startingBlockIds];

  while (queue.length > 0) {
    const blockId = queue.shift();

    if (!blockId) {
      continue;
    }

    for (const edge of edges.filter((item) => item.sourceBlockId === blockId)) {
      if (!downstream.has(edge.targetBlockId)) {
        downstream.add(edge.targetBlockId);
        queue.push(edge.targetBlockId);
      }
    }
  }

  return [...downstream];
}

export function markBlocksStale(project: GenostProject, blockIds: string[], reason: string): GenostProject {
  const blockSet = new Set(blockIds);
  const now = new Date().toISOString();

  return {
    ...project,
    stems: project.stems.map((stem) =>
      blockSet.has(stem.blockId) && ["queued", "rendering", "ready"].includes(stem.status)
        ? {
            ...stem,
            status: "stale",
            queueOrder: null,
            staleReason: reason,
            updatedAt: now,
          }
        : stem,
    ),
  };
}

export function markStemDependencyChainStale(
  project: GenostProject,
  inputStemIds: string[],
  reason: string,
): GenostProject {
  const affected = new Set(inputStemIds);
  const queue = [...inputStemIds];

  while (queue.length > 0) {
    const inputStemId = queue.shift();
    for (const stem of project.stems) {
      if (stem.inputStemId === inputStemId && !affected.has(stem.id)) {
        affected.add(stem.id);
        queue.push(stem.id);
      }
    }
  }

  const now = new Date().toISOString();
  return {
    ...project,
    stems: project.stems.map((stem) =>
      affected.has(stem.id) && ["queued", "rendering", "ready"].includes(stem.status)
        ? {
            ...stem,
            status: "stale" as const,
            queueOrder: null,
            staleReason: reason,
            updatedAt: now,
          }
        : stem,
    ),
  };
}
