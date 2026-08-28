import type { MusicAiMode } from "../../app/store";
import { formatRequirementRenderState, type RequirementRenderState } from "../../lib/project/requirements";

export type RenderBlockReason = "offline" | "composition" | "graph-cycle" | null;

export function getRenderBlockReason(args: {
  musicAiMode: MusicAiMode | null;
  compositionIssues: string[];
  hasGraphCycle: boolean;
}): RenderBlockReason {
  if (args.musicAiMode === "offline") {
    return "offline";
  }

  if (args.compositionIssues.length > 0) {
    return "composition";
  }

  if (args.hasGraphCycle) {
    return "graph-cycle";
  }

  return null;
}

export function getComponentStatusLabel(args: {
  renderBlockReason: RenderBlockReason;
  requirementState: RequirementRenderState;
}): string {
  if (args.requirementState === "duration-blocked") {
    return "duration blocked";
  }

  if (args.renderBlockReason === "offline") {
    return ["missing", "input-missing", "graph-cycle-blocked"].includes(args.requirementState)
      ? "planned"
      : formatRequirementRenderState(args.requirementState);
  }

  if (args.renderBlockReason === "composition") {
    return "composition missing";
  }

  if (args.renderBlockReason === "graph-cycle") {
    return "graph cycle";
  }

  return formatRequirementRenderState(args.requirementState);
}
