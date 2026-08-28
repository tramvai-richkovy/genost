import { AlertTriangle, GitBranch } from "lucide-react";
import { useStudioStore } from "../../app/store";
import { effectiveBlockTimeSignature, formatTimeSignature } from "../../lib/project/format";
import {
  collectDownstreamBlockIds,
  findBlockGraphCycle,
  getBlockInputEdges,
  latestReadyStemForBlock,
  markBlocksStale,
} from "../../lib/project/graph";

function blockName(blockId: string, blocks: Array<{ id: string; name: string }>): string {
  return blocks.find((block) => block.id === blockId)?.name ?? "Detached Block";
}

export function ArrangerGraphTab() {
  const activeProject = useStudioStore((state) => state.activeProject);
  const mutateActiveProject = useStudioStore((state) => state.mutateActiveProject);

  if (!activeProject) {
    return null;
  }

  const { project } = activeProject;
  const edges = getBlockInputEdges(project);
  const cycle = findBlockGraphCycle(project);

  function currentInputForBlock(blockId: string): string {
    const inputBlockIds = [
      ...new Set(
        project.arrangement.lanes
          .flatMap((lane) => lane.clips)
          .filter((clip) => clip.blockId === blockId && clip.inputBlockId)
          .map((clip) => clip.inputBlockId as string),
      ),
    ];

    if (inputBlockIds.length === 0) {
      return "";
    }

    return inputBlockIds.length === 1 ? inputBlockIds[0] : "__mixed";
  }

  function updateBlockInput(targetBlockId: string, inputBlockId: string | null) {
    if (project.blocks.find((block) => block.id === targetBlockId)?.sourceType === "imported") {
      return;
    }

    const inputStemId = inputBlockId ? latestReadyStemForBlock(project, inputBlockId)?.id ?? null : null;

    mutateActiveProject(
      {
        type: "set_graph_block_input",
        summary: "Updated arranger graph link",
        payload: { targetBlockId, inputBlockId, inputStemId },
      },
      (current) => {
        const updated = {
          ...current,
          arrangement: {
            lanes: current.arrangement.lanes.map((lane) => ({
              ...lane,
              clips: lane.clips.map((clip) =>
                clip.blockId === targetBlockId
                  ? {
                      ...clip,
                      inputBlockId,
                      inputStemId,
                      stemId: null,
                    }
                  : clip,
              ),
            })),
          },
        };
        const affectedBlockIds = collectDownstreamBlockIds(updated, [targetBlockId]);
        return markBlocksStale(updated, affectedBlockIds, "Arranger graph link changed.");
      },
    );
  }

  return (
    <div className="space-y-5">
      {cycle ? (
        <div className="graph-warning">
          <AlertTriangle size={18} />
          <span>
            Graph loop: {cycle.map((blockId) => blockName(blockId, project.blocks)).join(" -> ")}. Rendering is paused
            until the loop is removed.
          </span>
        </div>
      ) : null}

      <div className="graph-canvas">
        {project.blocks.map((block) => {
          const inputValue = currentInputForBlock(block.id);
          const outgoing = edges.filter((edge) => edge.sourceBlockId === block.id);
          const incoming = edges.filter((edge) => edge.targetBlockId === block.id);
          const staleCount = project.stems.filter((stem) => stem.blockId === block.id && stem.status === "stale").length;

          return (
            <article className="graph-node" key={block.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-xl font-semibold">{block.name}</h2>
                  <p className="mt-1 text-xs text-genost-muted">
                    {block.bars} bars | {formatTimeSignature(effectiveBlockTimeSignature(project, block))}
                    {staleCount > 0 ? ` | ${staleCount} stale` : ""}
                  </p>
                </div>
                <GitBranch className="text-genost-cyan" size={20} />
              </div>

              <label className="field-group mt-4">
                <span>Input Source</span>
                <select
                  className="field"
                  disabled={block.sourceType === "imported"}
                  value={inputValue}
                  onChange={(event) => updateBlockInput(block.id, event.currentTarget.value || null)}
                >
                  <option value="">No input</option>
                  {inputValue === "__mixed" ? (
                    <option disabled value="__mixed">
                      Mixed inputs
                    </option>
                  ) : null}
                  {project.blocks
                    .filter((item) => item.id !== block.id)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                </select>
              </label>

              <div className="mt-4 grid gap-2 text-xs text-genost-muted">
                <div className="truncate">Receives: {incoming.length ? incoming.map((edge) => blockName(edge.sourceBlockId, project.blocks)).join(", ") : "seed"}</div>
                <div className="truncate">Feeds: {outgoing.length ? outgoing.map((edge) => blockName(edge.targetBlockId, project.blocks)).join(", ") : "-"}</div>
              </div>
            </article>
          );
        })}
      </div>

      <div className="queue-table">
        <div className="graph-edge-row graph-edge-header">
          <span>Source</span>
          <span>Target</span>
        </div>
        {edges.length === 0 ? (
          <div className="graph-edge-row">
            <span>Seed blocks only</span>
            <span>-</span>
          </div>
        ) : (
          edges.map((edge) => (
            <div className="graph-edge-row" key={`${edge.sourceBlockId}-${edge.targetBlockId}`}>
              <span>{blockName(edge.sourceBlockId, project.blocks)}</span>
              <span>{blockName(edge.targetBlockId, project.blocks)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
