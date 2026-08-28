import { convertFileSrc } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { FastForward, FolderOpen, LoaderCircle, Pause, Play, Rewind } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStudioStore } from "../../app/store";
import { isUriAssetPath, resolveProjectAssetPath } from "../../lib/audio/paths";
import { buildArrangerMix, type MixBuildResult } from "../../lib/audio/mixdown";
import { WaveformPreview } from "../../lib/audio/WaveformPreview";

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "--:--";
  }

  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function PlayerTab() {
  const activeProject = useStudioStore((state) => state.activeProject);
  const mutateActiveProject = useStudioStore((state) => state.mutateActiveProject);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionSeconds, setPositionSeconds] = useState(0);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [isBuilding, setIsBuilding] = useState(false);
  const [buildResult, setBuildResult] = useState<MixBuildResult | null>(null);
  const mixPath = activeProject?.project.mix.lastBuildPath ?? null;
  const resolvedMixPath = resolveProjectAssetPath(activeProject?.path, mixPath);
  const hasMix = Boolean(resolvedMixPath);
  const progressPercent = durationSeconds > 0 ? Math.min(100, (positionSeconds / durationSeconds) * 100) : 0;

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setDurationSeconds(0);
    setIsPlaying(false);
    setPositionSeconds(0);
    setPlaybackError(null);
  }, [resolvedMixPath]);

  if (!activeProject) {
    return null;
  }

  const { project, path: projectPath } = activeProject;

  function updateMix(patch: Partial<typeof project.mix>, type: string, summary: string) {
    mutateActiveProject(
      {
        type,
        summary,
        payload: patch,
      },
      (current) => ({
        ...current,
        mix: { ...current.mix, ...patch },
      }),
    );
  }

  function getAudio(): HTMLAudioElement | null {
    if (!resolvedMixPath) {
      return null;
    }

    if (audioRef.current) {
      return audioRef.current;
    }

    const audio = new Audio(isUriAssetPath(resolvedMixPath) ? resolvedMixPath : convertFileSrc(resolvedMixPath));
    audioRef.current = audio;
    audio.onerror = () => {
      setIsPlaying(false);
      setPlaybackError(`Could not load mix audio: ${mixPath ?? resolvedMixPath}`);
    };
    audio.onloadedmetadata = () => setDurationSeconds(audio.duration);
    audio.ontimeupdate = () => setPositionSeconds(audio.currentTime);
    audio.onplay = () => {
      setPlaybackError(null);
      setIsPlaying(true);
    };
    audio.onpause = () => setIsPlaying(false);
    audio.onended = () => {
      setIsPlaying(false);
      setPositionSeconds(0);
    };

    return audio;
  }

  function playMix() {
    const audio = getAudio();

    if (!audio) {
      return;
    }

    void audio.play().catch((error: unknown) => {
      setIsPlaying(false);
      setPlaybackError(error instanceof Error ? error.message : `Could not play mix audio: ${mixPath ?? resolvedMixPath}`);
    });
  }

  function pauseMix() {
    audioRef.current?.pause();
  }

  function seekBy(seconds: number) {
    const audio = getAudio();

    if (!audio) {
      return;
    }

    const maxTime = Number.isFinite(audio.duration) ? audio.duration : durationSeconds;
    audio.currentTime = Math.max(0, Math.min(maxTime || 0, audio.currentTime + seconds));
    setPositionSeconds(audio.currentTime);
  }

  async function buildMix() {
    if (!projectPath || isBuilding) {
      return;
    }
    setIsBuilding(true);
    setPlaybackError(null);
    setBuildResult(null);
    try {
      const result = await buildArrangerMix(projectPath, project);
      setBuildResult(result);
      mutateActiveProject(
        {
          type: "build_mix_completed",
          summary: "Built arranger mix",
          payload: {
            path: result.relativePath,
            durationSeconds: result.durationSeconds,
            peak: result.peak,
            loudnessDb: result.loudnessDb,
            normalizationGainDb: result.normalizationGainDb,
            skippedClips: result.skippedClips,
          },
        },
        (current) => ({ ...current, mix: { ...current.mix, lastBuildPath: result.relativePath } }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPlaybackError(message);
      mutateActiveProject(
        {
          type: "build_mix_failed",
          summary: "Mix build failed",
          payload: { error: message },
          actor: "system",
          source: "system",
        },
        (current) => current,
      );
    } finally {
      setIsBuilding(false);
    }
  }

  async function revealMix() {
    if (!resolvedMixPath || isUriAssetPath(resolvedMixPath)) return;
    try {
      await revealItemInDir(resolvedMixPath);
      mutateActiveProject(
        { type: "reveal_mix", summary: "Revealed mix in Finder", payload: { path: mixPath } },
        (current) => current,
      );
    } catch (error) {
      setPlaybackError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="work-panel min-h-96">
        <div className="flex items-center gap-2">
          <button className="icon-button" disabled={!hasMix} onClick={() => seekBy(-10)} title="Rewind" type="button">
            <Rewind size={18} />
          </button>
          <button className={`icon-button ${isPlaying ? "active" : ""}`} disabled={!hasMix} onClick={playMix} title="Play" type="button">
            <Play size={18} />
          </button>
          <button className="icon-button" disabled={!hasMix} onClick={pauseMix} title="Pause" type="button">
            <Pause size={18} />
          </button>
          <button className="icon-button" disabled={!hasMix} onClick={() => seekBy(10)} title="Fast forward" type="button">
            <FastForward size={18} />
          </button>
          <div className="ml-3 h-2 flex-1 rounded bg-genost-line">
            <div className="h-2 rounded bg-genost-acid" style={{ width: `${progressPercent}%` }} />
          </div>
          <span className="w-24 text-right text-sm text-genost-muted">
            {formatClock(positionSeconds)} / {durationSeconds > 0 ? formatClock(durationSeconds) : "--:--"}
          </span>
        </div>
        {playbackError ? <div className="graph-warning mt-4">{playbackError}</div> : null}

        <WaveformPreview
          className="mt-6 h-40"
          label="Final mix waveform"
          path={resolvedMixPath}
          playhead={durationSeconds > 0 ? positionSeconds / durationSeconds : 0}
        />

        <div className="mt-8 flex flex-wrap gap-2">
          <button
            className="control-button"
            disabled={!projectPath || isBuilding || project.arrangement.lanes.every((lane) => lane.clips.length === 0)}
            type="button"
            onClick={() => void buildMix()}
          >
            {isBuilding ? <LoaderCircle className="animate-spin" size={17} /> : null}
            {isBuilding ? "Building…" : "Build Mix"}
          </button>
          <button className="control-button" disabled={!hasMix} onClick={() => void revealMix()} type="button">
            <FolderOpen size={17} />
            Reveal
          </button>
        </div>
        {buildResult ? (
          <div className={`mt-4 status-strip ${buildResult.skippedClips.length > 0 || buildResult.peak > 1 ? "warning" : ""}`}>
            {buildResult.durationSeconds.toFixed(2)}s · {buildResult.loudnessDb.toFixed(1)} dB RMS · peak {buildResult.peak.toFixed(3)}
            {` · normalized ${buildResult.normalizationGainDb >= 0 ? "+" : ""}${buildResult.normalizationGainDb.toFixed(1)} dB`}
            {buildResult.skippedClips.length > 0 ? ` · skipped ${buildResult.skippedClips.length} clip(s)` : " · all clips rendered"}
          </div>
        ) : null}
      </section>

      <section className="work-panel space-y-5">
        <div className="sfx-section">
          <div className="sfx-heading">
            <h2>Master Delay</h2>
            <select
              className="mini-field w-20"
              value={project.mix.masterDelayEnabled ? "on" : "off"}
              onChange={(event) =>
                updateMix(
                  { masterDelayEnabled: event.currentTarget.value === "on" },
                  "set_master_delay_enabled",
                  "Updated master delay enable",
                )
              }
            >
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="field-group">
              <span>Wet</span>
              <input
                className="field"
                max={1}
                min={0}
                step={0.01}
                type="number"
                value={project.mix.masterDelay}
                onChange={(event) =>
                  updateMix({ masterDelay: Number(event.currentTarget.value) }, "set_master_delay", "Updated master delay")
                }
              />
            </label>
            <label className="field-group">
              <span>Time ms</span>
              <input
                className="field"
                max={2000}
                min={1}
                type="number"
                value={project.mix.masterDelayTimeMs}
                onChange={(event) =>
                  updateMix(
                    { masterDelayTimeMs: Number(event.currentTarget.value) },
                    "set_master_delay_time",
                    "Updated delay time",
                  )
                }
              />
            </label>
            <label className="field-group">
              <span>Feedback</span>
              <input
                className="field"
                max={0.95}
                min={0}
                step={0.01}
                type="number"
                value={project.mix.masterDelayFeedback}
                onChange={(event) =>
                  updateMix(
                    { masterDelayFeedback: Number(event.currentTarget.value) },
                    "set_master_delay_feedback",
                    "Updated delay feedback",
                  )
                }
              />
            </label>
            <label className="field-group">
              <span>Filter Hz</span>
              <input
                className="field"
                max={18000}
                min={200}
                type="number"
                value={project.mix.masterDelayFilterHz}
                onChange={(event) =>
                  updateMix(
                    { masterDelayFilterHz: Number(event.currentTarget.value) },
                    "set_master_delay_filter",
                    "Updated delay filter",
                  )
                }
              />
            </label>
          </div>
        </div>

        <div className="sfx-section">
          <div className="sfx-heading">
            <h2>Master Reverb</h2>
            <select
              className="mini-field w-20"
              value={project.mix.masterReverbEnabled ? "on" : "off"}
              onChange={(event) =>
                updateMix(
                  { masterReverbEnabled: event.currentTarget.value === "on" },
                  "set_master_reverb_enabled",
                  "Updated master reverb enable",
                )
              }
            >
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="field-group">
              <span>Wet</span>
              <input
                className="field"
                max={1}
                min={0}
                step={0.01}
                type="number"
                value={project.mix.masterReverb}
                onChange={(event) =>
                  updateMix({ masterReverb: Number(event.currentTarget.value) }, "set_master_reverb", "Updated master reverb")
                }
              />
            </label>
            <label className="field-group">
              <span>Decay s</span>
              <input
                className="field"
                max={20}
                min={0.1}
                step={0.1}
                type="number"
                value={project.mix.masterReverbDecaySeconds}
                onChange={(event) =>
                  updateMix(
                    { masterReverbDecaySeconds: Number(event.currentTarget.value) },
                    "set_master_reverb_decay",
                    "Updated reverb decay",
                  )
                }
              />
            </label>
            <label className="field-group">
              <span>Pre-delay</span>
              <input
                className="field"
                max={500}
                min={0}
                type="number"
                value={project.mix.masterReverbPreDelayMs}
                onChange={(event) =>
                  updateMix(
                    { masterReverbPreDelayMs: Number(event.currentTarget.value) },
                    "set_master_reverb_predelay",
                    "Updated reverb pre-delay",
                  )
                }
              />
            </label>
            <label className="field-group">
              <span>Damp Hz</span>
              <input
                className="field"
                max={18000}
                min={200}
                type="number"
                value={project.mix.masterReverbDampeningHz}
                onChange={(event) =>
                  updateMix(
                    { masterReverbDampeningHz: Number(event.currentTarget.value) },
                    "set_master_reverb_dampening",
                    "Updated reverb dampening",
                  )
                }
              />
            </label>
          </div>
        </div>

        <div className="sfx-section">
          <div className="sfx-heading">
            <h2>Limiter</h2>
            <select
              className="mini-field w-20"
              value={project.mix.masterLimiter ? "on" : "off"}
              onChange={(event) =>
                updateMix(
                  { masterLimiter: event.currentTarget.value === "on" },
                  "set_master_limiter",
                  "Updated master limiter",
                )
              }
            >
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="field-group">
              <span>Threshold</span>
              <input
                className="field"
                max={0}
                min={-24}
                step={0.1}
                type="number"
                value={project.mix.masterLimiterThresholdDb}
                onChange={(event) =>
                  updateMix(
                    { masterLimiterThresholdDb: Number(event.currentTarget.value) },
                    "set_master_limiter_threshold",
                    "Updated limiter threshold",
                  )
                }
              />
            </label>
            <label className="field-group">
              <span>Release</span>
              <input
                className="field"
                max={2000}
                min={10}
                type="number"
                value={project.mix.masterLimiterReleaseMs}
                onChange={(event) =>
                  updateMix(
                    { masterLimiterReleaseMs: Number(event.currentTarget.value) },
                    "set_master_limiter_release",
                    "Updated limiter release",
                  )
                }
              />
            </label>
            <label className="field-group col-span-2">
              <span>Output Gain</span>
              <input
                className="field"
                max={12}
                min={-24}
                step={0.1}
                type="number"
                value={project.mix.outputGainDb}
                onChange={(event) =>
                  updateMix({ outputGainDb: Number(event.currentTarget.value) }, "set_output_gain", "Updated output gain")
                }
              />
            </label>
          </div>
        </div>
      </section>
    </div>
  );
}
