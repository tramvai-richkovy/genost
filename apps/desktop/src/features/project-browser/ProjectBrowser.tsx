import { Cpu, FolderOpen, Plus, RefreshCcw, SquareChevronRight, Unplug } from "lucide-react";
import { type FormEvent, type MouseEvent, useMemo, useState } from "react";
import { useStudioStore } from "../../app/store";
import { ThemeToggle } from "../../components/ThemeToggle";

export function ProjectBrowser() {
  const projectsRoot = useStudioStore((state) => state.projectsRoot);
  const projects = useStudioStore((state) => state.projects);
  const musicAiMode = useStudioStore((state) => state.musicAiMode);
  const status = useStudioStore((state) => state.status);
  const error = useStudioStore((state) => state.error);
  const selectRoot = useStudioStore((state) => state.selectRoot);
  const refreshProjects = useStudioStore((state) => state.refreshProjects);
  const createProject = useStudioStore((state) => state.createProject);
  const openProject = useStudioStore((state) => state.openProject);
  const openDemoProject = useStudioStore((state) => state.openDemoProject);
  const [title, setTitle] = useState("GENOST Sketch");

  const rootLabel = useMemo(() => projectsRoot ?? "No projects folder selected", [projectsRoot]);

  function submitCreateProject(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    void createProject(title);
  }

  function handleCreateTileClick(event: MouseEvent<HTMLFormElement>) {
    const target = event.target;

    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.closest("button,input,select,textarea,a")) {
      return;
    }

    void createProject(title);
  }

  return (
    <section className="cp-root genost-screen min-h-screen bg-genost-base text-genost-text">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-8 py-7">
        <header className="flex items-center justify-between border-b border-genost-line pb-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-genost-acid">GENOST</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal">Project Studio</h1>
          </div>
          <div className="flex items-center gap-2">
            {musicAiMode ? (
              <span className={`status-pill ${musicAiMode === "online" ? "ready" : "warning"}`}>
                {musicAiMode === "online" ? <Cpu size={14} /> : <Unplug size={14} />}
                {musicAiMode === "online" ? "MusicGen online" : "MusicGen offline"}
              </span>
            ) : null}
            <ThemeToggle />
            <button className="icon-button" onClick={refreshProjects} title="Refresh projects" type="button">
              <RefreshCcw size={18} />
            </button>
            <button className="control-button" onClick={selectRoot} type="button">
              <FolderOpen size={18} />
              Select Folder
            </button>
          </div>
        </header>

        <div className="mt-5 flex items-center justify-between gap-4 text-sm text-genost-muted">
          <span className="truncate">{rootLabel}</span>
          {status ? <span className="status-pill">{status}</span> : null}
        </div>

        {error ? <div className="mt-4 rounded border border-genost-danger/60 bg-genost-danger/10 px-3 py-2 text-sm text-genost-danger">{error}</div> : null}

        {!projectsRoot ? (
          <div className="empty-state mt-7">
            <FolderOpen size={22} />
            <span>Select a readable projects folder to begin.</span>
          </div>
        ) : projects.length === 0 && !error ? (
          <div className="empty-state mt-7">
            <Plus size={22} />
            <span>This folder has no GENOST projects yet.</span>
          </div>
        ) : null}

        <div className="mt-7 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
          <form
            aria-label="Create new project"
            className="project-card border-genost-acid/70"
            onClick={handleCreateTileClick}
            onSubmit={submitCreateProject}
          >
            <div>
              <Plus className="text-genost-acid" size={28} />
              <h2 className="mt-5 text-lg font-semibold">Create New Project</h2>
            </div>
            <div className="space-y-3">
              <input
                className="field"
                onChange={(event) => setTitle(event.currentTarget.value)}
                value={title}
                aria-label="New project title"
              />
              <button className="control-button w-full justify-center" type="submit">
                <Plus size={17} />
                Create
              </button>
            </div>
          </form>

          {projects.map((project) => (
            <button className="project-card text-left" key={project.path} onClick={() => openProject(project.path)} type="button">
              <div>
                <SquareChevronRight className="text-genost-cyan" size={26} />
                <h2 className="mt-5 line-clamp-3 text-xl font-semibold">{project.title}</h2>
              </div>
              <span className="text-xs text-genost-muted">{new Date(project.updatedAt).toLocaleString()}</span>
            </button>
          ))}
        </div>

        <div className="mt-auto pt-8">
          <button className="text-button" onClick={openDemoProject} type="button">
            Open in-memory dev project
          </button>
        </div>
      </div>
    </section>
  );
}
