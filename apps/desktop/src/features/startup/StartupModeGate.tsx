import { Cpu, LoaderCircle, RefreshCcw, Unplug, WandSparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useStudioStore } from "../../app/store";
import { getWorkerHealth, runWorkerPreflight, type WorkerHealth } from "../../lib/worker-client/render";

type GenerationBackend = "auto" | "mlx" | "audiocraft";

export function isAbsoluteModelCachePath(path: string): boolean {
  return !path.trim() || /^(?:\/|[A-Za-z]:[\\/])/.test(path.trim());
}

export function StartupModeGate() {
  const selectMusicAiMode = useStudioStore((state) => state.selectMusicAiMode);
  const [health, setHealth] = useState<WorkerHealth | null>(null);
  const [preflight, setPreflight] = useState<WorkerHealth["preflight"] | null>(null);
  const [checking, setChecking] = useState(true);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [cachePath, setCachePath] = useState(() => window.localStorage.getItem("genost-default-model-cache") ?? "");
  const [backend, setBackend] = useState<GenerationBackend>(() => {
    const saved = window.localStorage.getItem("genost-default-backend");
    return saved === "mlx" || saved === "audiocraft" ? saved : "auto";
  });
  const cachePathValid = isAbsoluteModelCachePath(cachePath);

  async function validateBackend(nextCachePath = cachePath, nextBackend = backend) {
    setChecking(true);
    setValidationError(null);
    setPreflight(null);
    if (!isAbsoluteModelCachePath(nextCachePath)) {
      setChecking(false);
      setValidationError("Model cache path must be absolute.");
      return;
    }
    try {
      const result = await runWorkerPreflight({
        model_cache_path: nextCachePath.trim() || null,
        hf_home: nextCachePath.trim() || null,
        backend: nextBackend,
      });
      setPreflight(result);
      setHealth(await getWorkerHealth().catch(() => null));
      if (!result.ok) setValidationError(result.errors[0] ?? "Backend preflight failed.");
    } catch (error) {
      setHealth(null);
      setPreflight(null);
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

  function saveBackend(value: GenerationBackend) {
    setBackend(value);
    window.localStorage.setItem("genost-default-backend", value);
    void validateBackend(cachePath, value);
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
            <span className={`status-pill ${preflight?.ok ? "ready" : validationError ? "warning" : ""}`}>
              {checking ? <LoaderCircle className="animate-spin" size={14} /> : <Cpu size={14} />}
              {checking ? "Validating backend" : preflight ? `${preflight.backend.toUpperCase()} · ${preflight.device}` : "Backend unavailable"}
            </span>
            <button className="icon-button" disabled={checking} onClick={() => void validateBackend()} title="Run backend validation again" type="button">
              <RefreshCcw size={16} />
            </button>
          </div>
          {health ? (
            <div className="backend-capabilities">
              <span>MLX runtime: {health.mlx_available ? "ready" : "missing"}</span>
              <span>Apple MPS capability: {health.mps_available ? "available" : "unavailable"}</span>
              <span>AudioCraft CPU diagnostic: {health.audiocraft_available ? "installed" : "optional"}</span>
              <span>ffmpeg: {health.ffmpeg_available ? "ready" : "missing"}</span>
            </div>
          ) : null}
          {validationError ? <div className="graph-warning">{validationError}</div> : null}
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
            <label className="field-group">
              <span>Default Model Cache Path</span>
              <input
                aria-invalid={!cachePathValid}
                className="field"
                onBlur={() => void validateBackend()}
                placeholder="/Volumes/Models/HuggingFace"
                value={cachePath}
                onChange={(event) => saveCachePath(event.currentTarget.value)}
              />
            </label>
            <label className="field-group">
              <span>Generation Backend</span>
              <select className="field" value={backend} onChange={(event) => saveBackend(event.currentTarget.value as GenerationBackend)}>
                <option value="auto">Auto (MLX preferred)</option>
                <option value="mlx">MLX / Metal</option>
                <option value="audiocraft">AudioCraft / CPU diagnostic</option>
              </select>
            </label>
          </div>
          {preflight ? (
            <div className="flex flex-wrap gap-2">
              {Object.values(preflight.models).map((model) => (
                <span className={`status-pill ${model.available ? "ready" : "warning"}`} key={model.name}>
                  {model.name.replace("facebook/", "")} · {model.available ? "local" : "missing"}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <button className="mode-choice" disabled={!preflight?.ok || !cachePathValid || checking} onClick={() => selectMusicAiMode("online")} type="button">
            <span className="mode-choice-icon active">
              <Cpu size={24} />
            </span>
            <span className="mode-choice-title">Yes, render enabled</span>
            <span className="mode-choice-copy">
              Use {preflight?.backend.toUpperCase() ?? "the selected supported backend"}; hardware capability is reported separately.
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
