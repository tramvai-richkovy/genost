import { useEffect, useState } from "react";
import { AlertTriangle, FileMusic, Tags, X } from "lucide-react";
import { useStudioStore } from "../../app/store";
import {
  formatSwing,
  getCompositionPromptIssues,
  getCompositionFieldIssues,
  normalizeTags,
  parseCommaTags,
  SWING_PRESETS,
  swingPresetForFeel,
  withGeneratedCompositionPrompt,
} from "../../lib/project/format";
import type { GenostProject, SwingFeel, TimeSignature } from "../../lib/schema/project";

type SongPatch = Partial<GenostProject["song"]>;

function parseInteger(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function parseDecimal(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function markReadyStemsStale(project: GenostProject): GenostProject {
  return {
    ...project,
    stems: project.stems.map((stem) =>
      ["queued", "rendering", "ready"].includes(stem.status)
        ? {
            ...stem,
            status: "stale",
            staleReason: "Composition prompt changed; archive as prior revision before rerender.",
            updatedAt: new Date().toISOString(),
          }
        : stem,
    ),
  };
}

function tagsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((tag, index) => tag === right[index]);
}

export function CompositionTab() {
  const activeProject = useStudioStore((state) => state.activeProject);
  const workspaceGenreReferences = useStudioStore((state) => state.workspaceGenreReferences);
  const mutateActiveProject = useStudioStore((state) => state.mutateActiveProject);
  const rememberGenreReferences = useStudioStore((state) => state.rememberGenreReferences);
  const selectReferenceTrack = useStudioStore((state) => state.selectReferenceTrack);
  const committedGenreReferencesValue = activeProject?.project.song.genreReferences.join(", ") ?? "";
  const [genreReferencesDraft, setGenreReferencesDraft] = useState(committedGenreReferencesValue);
  const [genreReferencesFocused, setGenreReferencesFocused] = useState(false);

  useEffect(() => {
    if (!genreReferencesFocused) {
      setGenreReferencesDraft(committedGenreReferencesValue);
    }
  }, [activeProject?.project.id, committedGenreReferencesValue, genreReferencesFocused]);

  if (!activeProject) {
    return null;
  }

  const { project } = activeProject;
  const promptIssues = getCompositionPromptIssues(project.song);
  const fieldIssues = getCompositionFieldIssues(project.song);
  const bpmInvalid = fieldIssues.some((issue) => issue.startsWith("BPM"));
  const keyInvalid = fieldIssues.some((issue) => issue.startsWith("Key"));
  const cachePathInvalid = fieldIssues.some((issue) => issue.startsWith("Model cache path"));
  const availableGenreReferences = workspaceGenreReferences.filter(
    (tag) => !project.song.genreReferences.some((selected) => selected.toLocaleLowerCase() === tag.toLocaleLowerCase()),
  );

  function updateSong(commandType: string, summary: string, patch: SongPatch, markStale = true) {
    mutateActiveProject(
      {
        type: commandType,
        summary,
        payload: patch,
      },
      (current) => {
        const updated = {
          ...current,
          song: withGeneratedCompositionPrompt({ ...current.song, ...patch }),
        };

        return markStale ? markReadyStemsStale(updated) : updated;
      },
    );
  }

  function updateTimeSignature(index: 0 | 1, value: string) {
    const currentSignature = project.song.timeSignature;
    const nextSignature: TimeSignature = [...currentSignature] as TimeSignature;
    nextSignature[index] = parseInteger(value, currentSignature[index], 1, 32);
    updateSong("set_time_signature", "Updated project time signature", { timeSignature: nextSignature });
  }

  function updateSwingFeel(feel: SwingFeel) {
    updateSong("set_swing", "Updated swing", { swing: swingPresetForFeel(feel) });
  }

  function updateSwingRatio(value: string) {
    updateSong("set_swing", "Updated swing", {
      swing: {
        ...project.song.swing,
        ratio: parseDecimal(value, project.song.swing.ratio, 1, 3),
      },
    });
  }

  function updateGenreReferences(rawValue: string) {
    setGenreReferencesDraft(rawValue);
    const genreReferences = parseCommaTags(rawValue);

    if (tagsEqual(project.song.genreReferences, genreReferences)) {
      return;
    }

    updateSong("set_genre_references", "Updated genre references", { genreReferences });
    void rememberGenreReferences(genreReferences);
  }

  function normalizeGenreReferencesDraft() {
    setGenreReferencesFocused(false);
    setGenreReferencesDraft(parseCommaTags(genreReferencesDraft).join(", "));
  }

  function addGenreReference(tag: string) {
    const genreReferences = normalizeTags([...project.song.genreReferences, tag]);
    updateSong("add_genre_reference", "Added genre reference", { genreReferences });
    void rememberGenreReferences(genreReferences);
  }

  function removeGenreReference(tag: string) {
    const genreReferences = project.song.genreReferences.filter(
      (item) => item.toLocaleLowerCase() !== tag.toLocaleLowerCase(),
    );
    updateSong("remove_genre_reference", "Removed genre reference", { genreReferences });
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="grid gap-4">
        <div className="grid gap-4 md:grid-cols-[140px_150px_minmax(0,1fr)_230px]">
          <label className="field-group">
            <span>BPM *</span>
            <input
              aria-describedby="composition-field-validation"
              aria-invalid={bpmInvalid}
              className="field"
              type="number"
              min={40}
              max={260}
              value={project.song.bpm}
              onChange={(event) =>
                updateSong("set_bpm", "Updated BPM", {
                  bpm: parseInteger(event.currentTarget.value, project.song.bpm, 40, 260),
                })
              }
            />
          </label>

          <label className="field-group">
            <span>Time Sig *</span>
            <div className="grid grid-cols-[1fr_12px_1fr] items-center gap-2">
              <input
                className="field px-2 text-center"
                type="number"
                min={1}
                max={32}
                value={project.song.timeSignature[0]}
                onChange={(event) => updateTimeSignature(0, event.currentTarget.value)}
                aria-label="Project time signature beats"
              />
              <span className="text-center text-genost-muted">/</span>
              <input
                className="field px-2 text-center"
                type="number"
                min={1}
                max={32}
                value={project.song.timeSignature[1]}
                onChange={(event) => updateTimeSignature(1, event.currentTarget.value)}
                aria-label="Project time signature beat value"
              />
            </div>
          </label>

          <label className="field-group">
            <span>Key</span>
            <input
              aria-describedby="composition-field-validation"
              aria-invalid={keyInvalid}
              className="field"
              value={project.song.key}
              onChange={(event) => updateSong("set_key", "Updated key", { key: event.currentTarget.value })}
            />
          </label>

          <div className="grid gap-2">
            <label className="field-group">
              <span>Swing *</span>
              <select
                className="field"
                value={project.song.swing.feel}
                onChange={(event) => updateSwingFeel(event.currentTarget.value as SwingFeel)}
              >
                {SWING_PRESETS.map((preset) => (
                  <option key={preset.feel} value={preset.feel}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-group">
              <span>Ratio</span>
              <input
                className="field"
                type="number"
                min={1}
                max={3}
                step={0.05}
                value={project.song.swing.ratio}
                onChange={(event) => updateSwingRatio(event.currentTarget.value)}
              />
            </label>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="field-group">
            <span>Mood *</span>
            <input
              className="field"
              value={project.song.mood}
              onChange={(event) => updateSong("set_mood", "Updated mood", { mood: event.currentTarget.value })}
            />
          </label>

          <label className="field-group">
            <span>Purpose</span>
            <input
              className="field"
              value={project.song.purpose}
              onChange={(event) => updateSong("set_purpose", "Updated purpose", { purpose: event.currentTarget.value })}
            />
          </label>
        </div>

        <label className="field-group">
          <span>Genre References * comma-separated</span>
          <input
            className="field"
            value={genreReferencesDraft}
            onBlur={normalizeGenreReferencesDraft}
            onChange={(event) => updateGenreReferences(event.currentTarget.value)}
            onFocus={() => setGenreReferencesFocused(true)}
          />
        </label>

        <div className="flex min-h-8 flex-wrap items-center gap-2">
          <Tags className="text-genost-cyan" size={16} />
          {project.song.genreReferences.map((tag) => (
            <button className="tag-chip active" key={tag} onClick={() => removeGenreReference(tag)} type="button">
              {tag}
              <X size={13} />
            </button>
          ))}
          {availableGenreReferences.slice(0, 10).map((tag) => (
            <button className="tag-chip" key={tag} onClick={() => addGenreReference(tag)} type="button">
              {tag}
            </button>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="field-group">
            <span>Reference Notes</span>
            <textarea
              className="field min-h-24 resize-none"
              value={project.song.referenceNotes}
              onChange={(event) =>
                updateSong("set_reference_notes", "Updated reference notes", { referenceNotes: event.currentTarget.value })
              }
            />
          </label>

          <label className="field-group">
            <span>What To Avoid</span>
            <textarea
              className="field min-h-24 resize-none"
              value={project.song.avoid}
              onChange={(event) => updateSong("set_avoid", "Updated avoid list", { avoid: event.currentTarget.value })}
            />
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="field-group">
            <span>Rhythm Feel</span>
            <input
              className="field"
              value={project.song.rhythmFeel}
              onChange={(event) => updateSong("set_rhythm_feel", "Updated rhythm feel", { rhythmFeel: event.currentTarget.value })}
            />
          </label>

          <label className="field-group">
            <span>Sonic Palette</span>
            <input
              className="field"
              value={project.song.sonicPalette}
              onChange={(event) =>
                updateSong("set_sonic_palette", "Updated sonic palette", { sonicPalette: event.currentTarget.value })
              }
            />
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="field-group">
            <span>Production Notes</span>
            <textarea
              className="field min-h-24 resize-none"
              value={project.song.productionNotes}
              onChange={(event) =>
                updateSong("set_production_notes", "Updated production notes", { productionNotes: event.currentTarget.value })
              }
            />
          </label>

          <label className="field-group">
            <span>Arrangement Notes</span>
            <textarea
              className="field min-h-24 resize-none"
              value={project.song.arrangementNotes}
              onChange={(event) =>
                updateSong("set_arrangement_notes", "Updated arrangement notes", { arrangementNotes: event.currentTarget.value })
              }
            />
          </label>
        </div>
      </div>

      <aside className="grid content-start gap-4">
        <div className={`status-strip ${fieldIssues.length > 0 ? "warning" : ""}`} id="composition-field-validation" role="status">
          {fieldIssues.length > 0 ? fieldIssues.join(" · ") : "BPM, key, and cache path valid"}
        </div>
        <div className="work-panel grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className={`status-pill ${promptIssues.length === 0 ? "ready" : ""}`}>
              {promptIssues.length === 0 ? "Prompt ready" : `Missing: ${promptIssues.join(", ")}`}
            </span>
            {promptIssues.length > 0 ? <AlertTriangle className="text-genost-warn" size={18} /> : null}
          </div>

          <label className="field-group">
            <span>Generated MusicGen Prompt</span>
            <textarea className="field min-h-52 resize-none leading-6" readOnly value={project.song.prompt} />
          </label>
        </div>

        <div className="work-panel grid gap-2 text-xs text-genost-muted">
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold uppercase text-genost-text">Swing Ratio Help</span>
            <span className="status-pill">{formatSwing(project.song.swing)}</span>
          </div>
          {SWING_PRESETS.map((preset) => (
            <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-2" key={preset.feel}>
              <span className="font-bold text-genost-text">{preset.label}</span>
              <span>{preset.help}</span>
            </div>
          ))}
        </div>

        <div className="work-panel grid gap-3">
          <label className="field-group">
            <span>Reference Track MP3</span>
            <input className="field" readOnly value={project.song.referenceTrackName ?? ""} />
          </label>
          <div className="flex items-center gap-2">
            <button className="control-button flex-1" onClick={selectReferenceTrack} type="button">
              <FileMusic size={17} />
              Import MP3
            </button>
            <button
              className="icon-button"
              disabled={!project.song.referenceTrackPath}
              onClick={() =>
                updateSong("clear_reference_track", "Cleared reference track", {
                  referenceTrackPath: null,
                  referenceTrackName: null,
                })
              }
              title="Clear reference track"
              type="button"
            >
              <X size={17} />
            </button>
          </div>
        </div>

        <label className="field-group">
          <span>Model Cache Path</span>
          <input
            aria-describedby="composition-field-validation"
            aria-invalid={cachePathInvalid}
            className="field"
            placeholder="/Volumes/YourSSDName/models"
            value={project.song.modelCachePath}
            onChange={(event) =>
              updateSong("set_model_cache_path", "Updated model cache path", { modelCachePath: event.currentTarget.value }, false)
            }
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="field-group">
            <span>Generation Backend</span>
            <select
              className="field"
              value={project.song.generationBackend}
              onChange={(event) =>
                updateSong(
                  "set_generation_backend",
                  "Updated generation backend",
                  { generationBackend: event.currentTarget.value as GenostProject["song"]["generationBackend"] },
                  false,
                )
              }
            >
              <option value="auto">Auto</option>
              <option value="mlx">MLX / Metal</option>
              <option value="audiocraft">AudioCraft / CPU diagnostic</option>
            </select>
          </label>
          <label className="field-group">
            <span>Text Model</span>
            <input className="field" readOnly value={project.song.defaultTextModel} />
          </label>
          <label className="field-group">
            <span>Melody Model</span>
            <input className="field" readOnly value={project.song.defaultMelodyModel} />
          </label>
        </div>

        <label className="field-group">
          <span>Sample Rate</span>
          <input className="field" readOnly value={project.song.sampleRate} />
        </label>
      </aside>
    </div>
  );
}
