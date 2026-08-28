import { ArrowLeft, AudioLines, Boxes, Cpu, ListMusic, Music2, Network, Rows3, SlidersHorizontal, Unplug } from "lucide-react";
import { useStudioStore, type StudioTab } from "../../app/store";
import { ThemeToggle } from "../../components/ThemeToggle";
import { ArrangerGraphTab } from "../arranger-graph/ArrangerGraphTab";
import { ArrangerTab } from "../arranger/ArrangerTab";
import { BlocksTab } from "../blocks/BlocksTab";
import { CompositionTab } from "../composition/CompositionTab";
import { PlayerTab } from "../player/PlayerTab";
import { PremixTab } from "../premix/PremixTab";
import { RenderQueueTab } from "../render-queue/RenderQueueTab";

const tabs: Array<{ id: StudioTab; label: string; icon: typeof Music2 }> = [
  { id: "composition", label: "Composition", icon: Music2 },
  { id: "blocks", label: "Blocks", icon: Boxes },
  { id: "arranger", label: "Arranger", icon: Rows3 },
  { id: "graph", label: "Graph", icon: Network },
  { id: "premix", label: "Premix", icon: AudioLines },
  { id: "components", label: "Components", icon: ListMusic },
  { id: "player", label: "Player", icon: SlidersHorizontal },
];

export function ProjectWorkspace() {
  const activeProject = useStudioStore((state) => state.activeProject);
  const activeTab = useStudioStore((state) => state.activeTab);
  const musicAiMode = useStudioStore((state) => state.musicAiMode);
  const status = useStudioStore((state) => state.status);
  const error = useStudioStore((state) => state.error);
  const saveState = useStudioStore((state) => state.saveState);
  const closeProject = useStudioStore((state) => state.closeProject);
  const setActiveTab = useStudioStore((state) => state.setActiveTab);

  if (!activeProject) {
    return null;
  }

  return (
    <section className="cp-root genost-screen min-h-screen bg-genost-base text-genost-text">
      <div className="mx-auto flex min-h-screen w-full max-w-[1500px] flex-col px-6 py-5">
        <header className="flex items-center justify-between border-b border-genost-line pb-4">
          <div className="min-w-0">
            <button className="text-button mb-3" onClick={closeProject} type="button">
              <ArrowLeft size={16} />
              Projects
            </button>
            <h1 className="truncate text-2xl font-semibold">{activeProject.project.title}</h1>
            <p className="mt-1 truncate text-sm text-genost-muted">
              {activeProject.path ?? "In-memory demo project"} | {activeProject.commands.commands.length} command(s)
            </p>
          </div>
          <div className="flex items-center gap-2">
            {musicAiMode ? (
              <span className={`status-pill ${musicAiMode === "online" ? "ready" : "warning"}`}>
                {musicAiMode === "online" ? <Cpu size={14} /> : <Unplug size={14} />}
                {musicAiMode === "online" ? "MusicGen online" : "MusicGen offline"}
              </span>
            ) : null}
            {status ? <span className="status-pill">{status}</span> : null}
            <span
              aria-live="polite"
              className={`status-pill ${saveState === "saved" ? "ready" : saveState === "error" ? "warning" : ""}`}
              title={saveState === "error" ? error ?? "The latest project change could not be saved" : undefined}
            >
              {saveState === "saved" ? "Saved" : saveState === "dirty" ? "Dirty" : saveState === "saving" ? "Saving…" : "Save error"}
            </span>
            <ThemeToggle />
          </div>
        </header>

        {error ? <div className="mt-4 rounded border border-genost-danger/60 bg-genost-danger/10 px-3 py-2 text-sm text-genost-danger">{error}</div> : null}

        <nav className="mt-5 flex gap-2 overflow-x-auto border-b border-genost-line pb-3">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                className={`tab-button ${activeTab === tab.id ? "active" : ""}`}
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                type="button"
              >
                <Icon size={17} />
                {tab.label}
              </button>
            );
          })}
        </nav>

        <main className="py-5">
          {activeTab === "composition" ? <CompositionTab /> : null}
          {activeTab === "blocks" ? <BlocksTab /> : null}
          {activeTab === "arranger" ? <ArrangerTab /> : null}
          {activeTab === "graph" ? <ArrangerGraphTab /> : null}
          {activeTab === "premix" ? <PremixTab /> : null}
          {activeTab === "components" ? <RenderQueueTab /> : null}
          {activeTab === "player" ? <PlayerTab /> : null}
        </main>
      </div>
    </section>
  );
}
