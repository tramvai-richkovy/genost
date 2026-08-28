import type { SeparationBundle } from "../schema/project";

export function visibleSeparationBundles(bundles: SeparationBundle[]): SeparationBundle[] {
  return bundles.filter((bundle) => {
    if (bundle.status === "archived") return false;
    if (bundle.status !== "failed") return true;

    return !bundles.some(
      (candidate) =>
        candidate.sourceStemId === bundle.sourceStemId &&
        candidate.status === "ready" &&
        candidate.createdAt > bundle.createdAt,
    );
  });
}
