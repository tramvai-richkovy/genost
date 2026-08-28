import { Cpu, LoaderCircle, RefreshCcw, Unplug, WandSparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useStudioStore } from "../../app/store";
import { getWorkerHealth, type WorkerHealth } from "../../lib/worker-client/render";

export function StartupModeGate() {
  const selectMusicAiMode = useStudioStore((state) => state.selectMusicAiMode);
  const [health, setHealth] = useState<WorkerHealth | null>(null);
  const [checking, setChecking] = useState(true);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [cachePath, setCachePath] = useState(() => window.localStorage.getItem("genost-default-model-cache") ?? "");

  async function validateBackend() {
    setChecking(true);
    setValidationError(null);
    try {
      setHealth(await getWorkerHealth());
    } catch (error) {
      setHealth(null);
      setValidationError(error instanceof Error ? error.message : String(error));
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    void validateBackend();
  }, []);

  function saveCachePath(value: string) {
    setCachePath(value);
    window.localStorage.setItem("genost-default-model-cache", value.trim());
  }

  return (
    <section className="cp-root genost-screen mode-gate min-h-screen bg-genost-base text-genost-text">
      <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center px-8 py-10">
        <header className="border-b border-genost-line pb-5">
          <p className="text-xs font-semibold uppercase tracking-normal text-genost-acid">GENOST</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal">Is MusicGen Online?</h1>
        </header>

        <div className="work-panel mt-6 grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className={`status-pill ${health?.ok ? "ready" : validationError ? "warning" : ""}`}>
              {checking ? <LoaderCircle className="animate-spin" size={14} /> : <Cpu size={14} />}
              {checking ? "Validating backend" : health ? `${health.generation_backend.toUpperCase()} · ${health.device}` : "Backend unavailable"}
            </span>
            <button className="icon-button" disabled={checking} onClick={() => void validateBackend()} title="Run backend validation again" type="button">
              <RefreshCcw size={16} />
            </button>
          </div>
          {health ? (
            <div className="backend-capabilities">
              <span>MLX backend: {health.mlx_available ? "ready" : "missing"}</span>
              <span>Apple MPS hardware: {health.mps_available ? "available" : "unavailable"}</span>
              <span>AudioCraft CPU diagnostic: {health.audiocraft_available ? "installed" : "optional"}</span>
              <span>ffmpeg: {health.ffmpeg_available ? "ready" : "missing"}</span>
            </div>
          ) : null}
          {validationError ? <div className="graph-warning">{validationError}</div> : null}
          <label className="field-group">
            <span>Default Model Cache Path</span>
            <input className="field" placeholder="/Volumes/Models/HuggingFace" value={cachePath} onChange={(event) => saveCachePath(event.currentTarget.value)} />
          </label>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <button className="mode-choice" onClick={() => selectMusicAiMode("online")} type="button">
            <span className="mode-choice-icon active">
              <Cpu size={24} />
            </span>
            <span className="mode-choice-title">Yes, render enabled</span>
            <span className="mode-choice-copy">
              Use {health?.generation_backend?.toUpperCase() ?? "the supported local backend"}; hardware capability is reported separately.
            </span>
          </button>

          <button className="mode-choice" onClick={() => selectMusicAiMode("offline")} type="button">
            <span className="mode-choice-icon">
              <Unplug size={24} />
            </span>
            <span className="mode-choice-title">No, planning only</span>
            <span className="mode-choice-copy">
              Build composition, blocks, arranger clips, graph links, and mix settings without queueing MusicGen jobs.
            </span>
          </button>
        </div>

        <div className="mt-5 flex items-center gap-2 text-sm text-genost-muted">
          <WandSparkles className="text-genost-violet" size={17} />
          <span>Offline mode is not saved into the project; restart and choose online when the model is available.</span>
        </div>
      </div>
    </section>
  );
}
