import { convertFileSrc } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  Archive,
  AudioLines,
  Boxes,
  ChevronRight,
  Cpu,
  Download,
  ExternalLink,
  FileAudio,
  FolderOpen,
  Menu,
  Moon,
  Music2,
  Music4,
  Play,
  Plus,
  RefreshCcw,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Unplug,
  WandSparkles,
  X,
} from "lucide-react";
import "wave-roll";
import { createElement, type FormEvent, useEffect, useMemo, useState } from "react";
import {
  bpmForPreset,
  buildStemConstructorPrompt,
  preflightAllowsStudio,
  useSessionStudioStore,
  type ReferenceAudioSelection,
} from "../../app/sessionStore";
import { WaveformPreview } from "../../lib/audio/WaveformPreview";
import {
  activePromptRevision,
  BPM_PRESETS,
  DEFAULT_TEXT_MODEL,
  nextDefaultSessionName,
  sessionTypeLabel,
  STEM_CONSTRUCTORS,
} from "../../lib/session/format";
import { loadSessionAtPath, resolveSessionAssetPath, selectExportFolder, type SessionCard } from "../../lib/session/storage";
import type { BpmPreset, GenostArtifact, GenostSession, SessionType } from "../../lib/session/schema";

type ArtifactTreeEntry = {
  sessionId: string;
  sessionTitle: string;
  artifactId: string;
  artifactName: string;
  filePath: string;
  absolutePath: string;
  mediaType: string;
};

const sessionChoices: Array<{ type: SessionType; emoji: string; title: string; copy: string; icon: typeof Music2 }> = [
  {
    type: "stem_constructor",
    emoji: "🧩",
    title: "Stem Constructor",
    copy: "Structured prompt builders for focused arps, basses, drums, pads, leads, keys, guitars, choirs, and scene themes.",
    icon: Boxes,
  },
  {
    type: "free_format",
    emoji: "✍️",
    title: "Free Format",
    copy: "Prompt-to-audio generation with optional reference audio, artifact actions, stem splitting, conversion, and export.",
    icon: WandSparkles,
  },
  {
    type: "midi_generator",
    emoji: "🎹",
    title: "Midi Generator",
    copy: "Generate MIDI candidates from text, preview them as piano rolls, and use clean guide audio to seed new sessions.",
    icon: Music4,
  },
];

function sourceForPreview(path: string | null): string | undefined {
  if (!path) return undefined;
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path) && !/^[A-Za-z]:[\\/]/.test(path) ? path : convertFileSrc(path);
}

function MidiPreview({ path, name }: { path: string | null; name: string }) {
  const files = useMemo(() => {
    const source = sourceForPreview(path);
    return source ? JSON.stringify([{ path: source, name, type: "midi", color: "#39ff14" }]) : "[]";
  }, [name, path]);

  if (!path) {
    return <div className="midi-preview-empty">No MIDI file</div>;
  }

  return (
    <div className="midi-preview-shell">
      {createElement("wave-roll", { files, readonly: true, style: { width: "100%", height: "260px" } })}
    </div>
  );
}

function ModelGate() {
  const workingDirectory = useSessionStudioStore((state) => state.workingDirectory);
  const metadata = useSessionStudioStore((state) => state.workspaceMetadata);
  const workerPreflight = useSessionStudioStore((state) => state.workerPreflight);
  const preflightChecking = useSessionStudioStore((state) => state.preflightChecking);
  const selectRoot = useSessionStudioStore((state) => state.selectRoot);
  const checkPreflight = useSessionStudioStore((state) => state.checkPreflight);
  const updateModelSettings = useSessionStudioStore((state) => state.updateModelSettings);
  const settings = metadata?.modelSettings ?? { cachePath: "", hfHome: null, backend: "auto" as const };

  function updateSettings(next: Partial<typeof settings>) {
    void updateModelSettings({ ...settings, ...next });
  }

  return (
    <div className="setup-strip">
      <div className="setup-path">
        <FolderOpen size={18} />
        <span>{workingDirectory ?? "No working directory selected"}</span>
        <button className="control-button" onClick={() => void selectRoot()} type="button">
          <FolderOpen size={17} />
          Select
        </button>
      </div>
      <div className="setup-grid">
        <label className="field-group">
          <span>Model Cache</span>
          <input
            className="field"
            onBlur={() => void checkPreflight()}
            onChange={(event) => updateSettings({ cachePath: event.currentTarget.value })}
            placeholder="/Volumes/Models/HuggingFace"
            value={settings.cachePath}
          />
        </label>
        <label className="field-group">
          <span>HF Home</span>
          <input
            className="field"
            onBlur={() => void checkPreflight()}
            onChange={(event) => updateSettings({ hfHome: event.currentTarget.value || null })}
            placeholder="Defaults to model cache"
            value={settings.hfHome ?? ""}
          />
        </label>
        <label className="field-group">
          <span>Backend</span>
          <select className="field" onChange={(event) => updateSettings({ backend: event.currentTarget.value as typeof settings.backend })} value={settings.backend}>
            <option value="auto">Auto</option>
            <option value="mlx">MLX</option>
            <option value="audiocraft">AudioCraft</option>
          </select>
        </label>
        <button className="control-button setup-refresh" disabled={preflightChecking} onClick={() => void checkPreflight()} type="button">
          <RefreshCcw size={17} />
          Check
        </button>
      </div>
      <div className="preflight-grid">
        {[DEFAULT_TEXT_MODEL, "facebook/musicgen-melody"].map((model) => {
          const available = workerPreflight?.models[model]?.available;
          return (
            <span className={`status-pill ${available ? "ready" : "warning"}`} key={model}>
              {available ? <Cpu size={14} /> : <Unplug size={14} />}
              {model.replace("facebook/", "")}: {available ? "local" : "missing"}
            </span>
          );
        })}
        <span className={`status-pill ${workerPreflight?.ok ? "ready" : "warning"}`}>
          <Settings2 size={14} />
          {preflightChecking ? "checking" : workerPreflight?.ok ? `${workerPreflight.backend} ${workerPreflight.device}` : "blocked"}
        </span>
      </div>
      {workerPreflight && !workerPreflight.ok ? (
        <div className="graph-warning">
          {workerPreflight.errors.slice(0, 3).map((error) => (
            <span key={error}>{error}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SessionSidebar({ onCreate }: { onCreate: (type: SessionType) => void }) {
  const metadata = useSessionStudioStore((state) => state.workspaceMetadata);
  const sessions = useSessionStudioStore((state) => state.sessions);
  const activeSession = useSessionStudioStore((state) => state.activeSession);
  const openSession = useSessionStudioStore((state) => state.openSession);
  const refreshSessions = useSessionStudioStore((state) => state.refreshSessions);
  const setSidebarCollapsed = useSessionStudioStore((state) => state.setSidebarCollapsed);
  const workerPreflight = useSessionStudioStore((state) => state.workerPreflight);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const collapsed = metadata?.sidebarCollapsed ?? false;
  const canUseStudio = preflightAllowsStudio(workerPreflight);
  const visibleSessions = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return sessions.filter((session) => {
      const matchesSearch =
        !query ||
        session.name.toLocaleLowerCase().includes(query) ||
        session.title.toLocaleLowerCase().includes(query) ||
        session.tags.some((tag) => tag.toLocaleLowerCase().includes(query));
      const matchesTag = !tagFilter || session.tags.includes(tagFilter);
      return matchesSearch && matchesTag;
    });
  }, [search, sessions, tagFilter]);

  if (collapsed) {
    return (
      <aside className="session-sidebar collapsed">
        <button className="icon-button" onClick={() => void setSidebarCollapsed(false)} title="Expand sidebar" type="button">
          <Menu size={18} />
        </button>
        <button className="icon-button" disabled={!canUseStudio} onClick={() => onCreate("free_format")} title="New session" type="button">
          <Plus size={18} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="session-sidebar">
      <div className="sidebar-head">
        <button className="icon-button" onClick={() => void setSidebarCollapsed(true)} title="Collapse sidebar" type="button">
          <Menu size={18} />
        </button>
        <button className="control-button" disabled={!canUseStudio} onClick={() => onCreate("free_format")} type="button">
          <Plus size={17} />
          New
        </button>
        <button className="icon-button" onClick={() => void refreshSessions()} title="Refresh sessions" type="button">
          <RefreshCcw size={17} />
        </button>
      </div>
      <label className="sidebar-search">
        <Search size={15} />
        <input onChange={(event) => setSearch(event.currentTarget.value)} placeholder="Search sessions" value={search} />
      </label>
      <label className="field-group">
        <span>Tag Filter</span>
        <select className="field" onChange={(event) => setTagFilter(event.currentTarget.value)} value={tagFilter}>
          <option value="">All tags</option>
          {(metadata?.knownTags ?? []).map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>
      </label>
      <div className="session-list">
        {visibleSessions.map((session) => (
          <button
            className={`session-row ${activeSession?.session.id === session.id ? "active" : ""}`}
            disabled={!canUseStudio}
            key={session.path}
            onClick={() => void openSession(session.path)}
            type="button"
          >
            <span className="session-row-main">
              <span>{session.title}</span>
              <small>{session.name}</small>
            </span>
            <span className="session-row-meta">
              {sessionTypeLabel(session.type)}
              <b>{session.artifactCount}</b>
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function NewSessionChoices({ onCreate }: { onCreate: (type: SessionType) => void }) {
  const workerPreflight = useSessionStudioStore((state) => state.workerPreflight);
  const canUseStudio = preflightAllowsStudio(workerPreflight);

  return (
    <div className="new-session-grid">
      {sessionChoices.map((choice) => {
        const Icon = choice.icon;
        return (
          <button className="new-session-choice" disabled={!canUseStudio} key={choice.type} onClick={() => onCreate(choice.type)} type="button">
            <span className="choice-topline">
              <span className="choice-emoji" aria-hidden="true">
                {choice.emoji}
              </span>
              <Icon size={22} />
            </span>
            <span className="choice-title">{choice.title}</span>
            <span className="choice-copy">{choice.copy}</span>
          </button>
        );
      })}
    </div>
  );
}

function NewSessionForm({ type, onDone }: { type: SessionType; onDone: () => void }) {
  const sessions = useSessionStudioStore((state) => state.sessions);
  const metadata = useSessionStudioStore((state) => state.workspaceMetadata);
  const createSession = useSessionStudioStore((state) => state.createSession);
  const [name, setName] = useState(() => nextDefaultSessionName(sessions.map((session) => session.name)));
  const [preset, setPreset] = useState<BpmPreset>("custom");
  const [bpm, setBpm] = useState(120);
  const [selectedTag, setSelectedTag] = useState("");
  const [newTag, setNewTag] = useState("");
  const [exportFolder, setExportFolder] = useState<string | null>(null);

  function changePreset(value: BpmPreset) {
    setPreset(value);
    if (value !== "custom") setBpm(bpmForPreset(value));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await createSession({
      type,
      name,
      bpm,
      bpmPreset: preset,
      tag: newTag.trim() || selectedTag || undefined,
      exportFolder,
    });
    onDone();
  }

  return (
    <form className="work-panel session-form" onSubmit={(event) => void submit(event)}>
      <div className="panel-title-row">
        <div>
          <p className="eyebrow">New Session</p>
          <h2>{sessionTypeLabel(type)}</h2>
        </div>
        <button className="icon-button" onClick={onDone} title="Close" type="button">
          <X size={17} />
        </button>
      </div>
      <div className="form-grid">
        <label className="field-group">
          <span>Name</span>
          <input className="field" onChange={(event) => setName(event.currentTarget.value)} required value={name} />
        </label>
        <label className="field-group">
          <span>BPM Preset</span>
          <select className="field" onChange={(event) => changePreset(event.currentTarget.value as BpmPreset)} value={preset}>
            {BPM_PRESETS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field-group">
          <span>BPM</span>
          <input className="field" max={260} min={40} onChange={(event) => setBpm(Number(event.currentTarget.value))} type="number" value={bpm} />
        </label>
        <label className="field-group">
          <span>Existing Tag</span>
          <select className="field" onChange={(event) => setSelectedTag(event.currentTarget.value)} value={selectedTag}>
            <option value="">No tag</option>
            {(metadata?.knownTags ?? []).map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        </label>
        <label className="field-group">
          <span>New Tag</span>
          <input className="field" onChange={(event) => setNewTag(event.currentTarget.value)} value={newTag} />
        </label>
        <div className="field-group">
          <span>Export Folder</span>
          <button className="control-button" onClick={() => void selectExportFolder().then((path) => path && setExportFolder(path))} type="button">
            <FolderOpen size={17} />
            {exportFolder ? "Change" : "Select"}
          </button>
        </div>
      </div>
      {exportFolder ? <p className="path-readout">{exportFolder}</p> : null}
      <button className="control-button form-submit" type="submit">
        <Plus size={17} />
        Create Session
      </button>
    </form>
  );
}

function useArtifactTree(sessions: SessionCard[], activeSession: GenostSession | null): ArtifactTreeEntry[] {
  const [entries, setEntries] = useState<ArtifactTreeEntry[]>([]);

  useEffect(() => {
    let alive = true;
    void Promise.all(
      sessions.map(async (card) => {
        const loaded = await loadSessionAtPath(card.path);
        return loaded.session.artifacts
          .filter((artifact) => artifact.status === "ready" && artifact.mediaType !== "audio/midi")
          .map((artifact) => ({
            sessionId: loaded.session.id,
            sessionTitle: loaded.session.title,
            artifactId: artifact.id,
            artifactName: artifact.name,
            filePath: artifact.filePath,
            absolutePath: resolveSessionAssetPath(loaded.path, artifact.filePath) ?? artifact.filePath,
            mediaType: artifact.mediaType,
          }));
      }),
    )
      .then((groups) => {
        if (alive) setEntries(groups.flat());
      })
      .catch(() => {
        if (alive) setEntries([]);
      });
    return () => {
      alive = false;
    };
  }, [activeSession?.updatedAt, sessions]);

  return entries;
}

function SessionHeader() {
  const activeSession = useSessionStudioStore((state) => state.activeSession);
  const saveState = useSessionStudioStore((state) => state.saveState);
  const updateSessionBasics = useSessionStudioStore((state) => state.updateSessionBasics);
  const chooseExportFolderForSession = useSessionStudioStore((state) => state.chooseExportFolderForSession);
  const closeSession = useSessionStudioStore((state) => state.closeSession);
  const [title, setTitle] = useState(activeSession?.session.title ?? "");
  const [tagText, setTagText] = useState(activeSession?.session.tags.join(", ") ?? "");

  useEffect(() => {
    setTitle(activeSession?.session.title ?? "");
    setTagText(activeSession?.session.tags.join(", ") ?? "");
  }, [activeSession?.session.id, activeSession?.session.tags, activeSession?.session.title]);

  if (!activeSession) return null;
  const session = activeSession.session;

  function saveTags() {
    void updateSessionBasics({ tags: tagText.split(",").map((tag) => tag.trim()) });
  }

  return (
    <div className="session-header">
      <div className="session-title-block">
        <button className="text-button" onClick={closeSession} type="button">
          <ChevronRight className="rotate-180" size={16} />
          Sessions
        </button>
        <input className="session-title-input" onBlur={() => void updateSessionBasics({ title: title.trim() || session.name })} onChange={(event) => setTitle(event.currentTarget.value)} value={title} />
        <div className="session-subline">
          <span>{session.name}</span>
          <span>{sessionTypeLabel(session.type)}</span>
          <span>{session.artifactCount} artifact(s)</span>
          <span>{activeSession.commands.commands.length} command(s)</span>
        </div>
      </div>
      <div className="session-header-controls">
        <label className="field-group compact">
          <span>BPM</span>
          <input
            className="mini-field"
            max={260}
            min={40}
            onChange={(event) => void updateSessionBasics({ bpm: Number(event.currentTarget.value), bpmPreset: "custom" })}
            type="number"
            value={session.bpm}
          />
        </label>
        <label className="field-group compact">
          <span>Preset</span>
          <select
            className="mini-field"
            onChange={(event) => {
              const preset = event.currentTarget.value as BpmPreset;
              void updateSessionBasics({ bpmPreset: preset, bpm: preset === "custom" ? session.bpm : bpmForPreset(preset) });
            }}
            value={session.bpmPreset}
          >
            {BPM_PRESETS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field-group tags-field compact">
          <span>Tags</span>
          <input className="mini-field" onBlur={saveTags} onChange={(event) => setTagText(event.currentTarget.value)} value={tagText} />
        </label>
        <button className="control-button" onClick={() => void chooseExportFolderForSession()} type="button">
          <FolderOpen size={16} />
          Export Folder
        </button>
        <span className={`status-pill ${saveState === "saved" ? "ready" : saveState === "error" ? "warning" : ""}`}>
          {saveState === "saved" ? "Saved" : saveState === "saving" ? "Saving" : saveState}
        </span>
      </div>
    </div>
  );
}

function PromptComposer({
  session,
  mode,
  prompt,
  setPrompt,
  onGenerate,
  children,
}: {
  session: GenostSession;
  mode: "audio" | "midi";
  prompt: string;
  setPrompt: (value: string) => void;
  onGenerate: (quantity: number) => void;
  children?: React.ReactNode;
}) {
  const archivePrompt = useSessionStudioStore((state) => state.archivePrompt);
  const activeRevision = activePromptRevision(session);
  const [quantity, setQuantity] = useState(mode === "midi" ? 4 : 2);

  return (
    <div className="composer-panel">
      <div className="composer-toolbar">
        <div className="revision-tabs">
          {session.promptHistory.revisions.map((revision) => (
            <span className={`revision-tab ${revision.id === activeRevision.id ? "active" : ""}`} key={revision.id}>
              {revision.label}
            </span>
          ))}
        </div>
        <button className="icon-button" onClick={() => void archivePrompt()} title="Archive prompt revision" type="button">
          <Archive size={17} />
        </button>
      </div>
      <textarea
        className="prompt-input"
        disabled={activeRevision.locked}
        onBlur={() => void useSessionStudioStore.getState().setPrompt(prompt)}
        onChange={(event) => setPrompt(event.currentTarget.value)}
        placeholder={activeRevision.locked ? "Archive this prompt to edit a fresh revision" : "Prompt"}
        value={prompt}
      />
      {children}
      <div className="composer-actions">
        <label className="field-group compact">
          <span>Quantity</span>
          <input className="mini-field" max={16} min={1} onChange={(event) => setQuantity(Number(event.currentTarget.value))} type="number" value={quantity} />
        </label>
        <button className="control-button" onClick={() => onGenerate(quantity)} type="button">
          <Sparkles size={17} />
          Generate
        </button>
      </div>
    </div>
  );
}

function MidiGeneratorView({ session }: { session: GenostSession }) {
  const generateMidiArtifacts = useSessionStudioStore((state) => state.generateMidiArtifacts);
  const activeRevision = activePromptRevision(session);
  const [prompt, setPrompt] = useState(activeRevision.prompt);

  useEffect(() => setPrompt(activePromptRevision(session).prompt), [session.promptHistory.activeRevisionId]);

  return (
    <PromptComposer
      mode="midi"
      onGenerate={(quantity) => void generateMidiArtifacts({ prompt, quantity })}
      prompt={prompt}
      session={session}
      setPrompt={setPrompt}
    />
  );
}

function ReferencePicker({ entries }: { entries: ArtifactTreeEntry[] }) {
  const selectedReferenceAudio = useSessionStudioStore((state) => state.selectedReferenceAudio);
  const chooseManualReferenceAudio = useSessionStudioStore((state) => state.chooseManualReferenceAudio);
  const clearReferenceAudio = useSessionStudioStore((state) => state.clearReferenceAudio);
  const useResolvedArtifactAsReference = useSessionStudioStore((state) => state.useResolvedArtifactAsReference);
  const [openTree, setOpenTree] = useState(false);

  return (
    <div className="reference-panel">
      <div className="reference-actions">
        <button className="control-button" onClick={() => void chooseManualReferenceAudio()} type="button">
          <FileAudio size={17} />
          Reference File
        </button>
        <button className="control-button" onClick={() => setOpenTree((value) => !value)} type="button">
          <AudioLines size={17} />
          Artifact Tree
        </button>
        {selectedReferenceAudio ? (
          <button className="icon-button danger" onClick={clearReferenceAudio} title="Clear reference" type="button">
            <X size={17} />
          </button>
        ) : null}
      </div>
      {selectedReferenceAudio ? (
        <div className="reference-readout">
          <Music2 size={15} />
          <span>{selectedReferenceAudio.name}</span>
          <small>{selectedReferenceAudio.path}</small>
        </div>
      ) : null}
      {openTree ? (
        <div className="artifact-tree">
          {entries.map((entry) => (
            <button
              key={`${entry.sessionId}:${entry.artifactId}`}
              onClick={() =>
                useResolvedArtifactAsReference({
                  path: entry.absolutePath,
                  name: `${entry.sessionTitle}/${entry.artifactName}`,
                  source: "artifact",
                  artifactId: entry.artifactId,
                } satisfies ReferenceAudioSelection)
              }
              type="button"
            >
              <span>{entry.sessionTitle}</span>
              <small>
                {entry.filePath} · {entry.mediaType}
              </small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FreeFormatView({ session, artifactTree }: { session: GenostSession; artifactTree: ArtifactTreeEntry[] }) {
  const selectedReferenceAudio = useSessionStudioStore((state) => state.selectedReferenceAudio);
  const generateAudioArtifacts = useSessionStudioStore((state) => state.generateAudioArtifacts);
  const activeRevision = activePromptRevision(session);
  const [prompt, setPrompt] = useState(activeRevision.prompt);

  useEffect(() => setPrompt(activePromptRevision(session).prompt), [session.promptHistory.activeRevisionId]);

  return (
    <PromptComposer
      mode="audio"
      onGenerate={(quantity) => void generateAudioArtifacts({ prompt, quantity, referencePath: selectedReferenceAudio?.path ?? null })}
      prompt={prompt}
      session={session}
      setPrompt={setPrompt}
    >
      <ReferencePicker entries={artifactTree} />
    </PromptComposer>
  );
}

function StemConstructorView({ session, artifactTree }: { session: GenostSession; artifactTree: ArtifactTreeEntry[] }) {
  const selectedReferenceAudio = useSessionStudioStore((state) => state.selectedReferenceAudio);
  const generateAudioArtifacts = useSessionStudioStore((state) => state.generateAudioArtifacts);
  const setPromptInStore = useSessionStudioStore((state) => state.setPrompt);
  const [constructorId, setConstructorId] = useState(STEM_CONSTRUCTORS[0].id);
  const constructor = STEM_CONSTRUCTORS.find((item) => item.id === constructorId) ?? STEM_CONSTRUCTORS[0];
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(constructor.fields.map((field) => [field.id, field.values[0] ?? ""])),
  );
  const [quantity, setQuantity] = useState(2);

  useEffect(() => {
    setValues(Object.fromEntries(constructor.fields.map((field) => [field.id, field.values[0] ?? ""])));
  }, [constructor.id]);

  const prompt = buildStemConstructorPrompt({ bpm: session.bpm, constructorId, values });

  return (
    <div className="composer-panel">
      <div className="constructor-grid">
        <label className="field-group">
          <span>Constructor</span>
          <select className="field" onChange={(event) => setConstructorId(event.currentTarget.value)} value={constructorId}>
            {STEM_CONSTRUCTORS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        {constructor.fields.map((field) => (
          <label className="field-group" key={field.id}>
            <span>{field.label}</span>
            <input className="field" list={`${constructor.id}-${field.id}`} onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.currentTarget.value }))} value={values[field.id] ?? ""} />
            <datalist id={`${constructor.id}-${field.id}`}>
              {field.values.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </label>
        ))}
      </div>
      <div className="prompt-readout">{prompt}</div>
      <ReferencePicker entries={artifactTree} />
      <div className="composer-actions">
        <label className="field-group compact">
          <span>Quantity</span>
          <input className="mini-field" max={16} min={1} onChange={(event) => setQuantity(Number(event.currentTarget.value))} type="number" value={quantity} />
        </label>
        <button
          className="control-button"
          onClick={() => {
            void setPromptInStore(prompt).then(() => generateAudioArtifacts({ prompt, quantity, referencePath: selectedReferenceAudio?.path ?? null }));
          }}
          type="button"
        >
          <Sparkles size={17} />
          Generate
        </button>
      </div>
    </div>
  );
}

function ArtifactCard({ artifact, selected, toggleSelected }: { artifact: GenostArtifact; selected: boolean; toggleSelected: (artifactId: string) => void }) {
  const activeSession = useSessionStudioStore((state) => state.activeSession);
  const exportArtifact = useSessionStudioStore((state) => state.exportArtifact);
  const journalArtifactReveal = useSessionStudioStore((state) => state.journalArtifactReveal);
  const renameArtifact = useSessionStudioStore((state) => state.renameArtifact);
  const useArtifactAsReference = useSessionStudioStore((state) => state.useArtifactAsReference);
  const convertArtifactToMidi = useSessionStudioStore((state) => state.convertArtifactToMidi);
  const splitArtifactIntoStems = useSessionStudioStore((state) => state.splitArtifactIntoStems);
  const updateStemVolume = useSessionStudioStore((state) => state.updateStemVolume);
  const createDerivedSessionFromArtifact = useSessionStudioStore((state) => state.createDerivedSessionFromArtifact);
  const absolutePath = activeSession ? resolveSessionAssetPath(activeSession.path, artifact.filePath) : null;
  const isMidi = artifact.mediaType === "audio/midi";
  const isAudio = artifact.mediaType.startsWith("audio/") && !isMidi;
  const [name, setName] = useState(artifact.name);

  useEffect(() => setName(artifact.name), [artifact.name]);

  async function reveal() {
    if (!absolutePath) return;
    await revealItemInDir(absolutePath);
    await journalArtifactReveal(artifact.id);
  }

  return (
    <article className={`artifact-card ${artifact.status}`}>
      <div className="artifact-head">
        {artifact.kind === "separated_stem" ? (
          <input checked={selected} onChange={() => toggleSelected(artifact.id)} title="Select stem for merge" type="checkbox" />
        ) : null}
        <input className="artifact-name" onBlur={() => void renameArtifact(artifact.id, name)} onChange={(event) => setName(event.currentTarget.value)} value={name} />
        <span className={`status-pill ${artifact.status === "ready" ? "ready" : artifact.status === "failed" ? "warning" : ""}`}>{artifact.status}</span>
      </div>
      <div className="artifact-meta">
        <span>{artifact.kind.replace(/_/g, " ")}</span>
        <span>{artifact.filePath}</span>
      </div>
      {isAudio ? (
        <>
          <WaveformPreview className="artifact-waveform" path={absolutePath} />
          <audio controls preload="none" src={sourceForPreview(absolutePath)} />
        </>
      ) : null}
      {isMidi ? <MidiPreview name={artifact.name} path={absolutePath} /> : null}
      {artifact.error ? <div className="graph-warning">{artifact.error}</div> : null}
      {artifact.kind === "separated_stem" ? (
        <label className="premix-volume">
          <span>{artifact.volumeDb.toFixed(1)} dB</span>
          <input max={6} min={-60} onChange={(event) => void updateStemVolume(artifact.id, Number(event.currentTarget.value))} step={0.5} type="range" value={artifact.volumeDb} />
        </label>
      ) : null}
      <div className="artifact-actions">
        <button className="icon-button" disabled={!absolutePath || artifact.status !== "ready"} onClick={() => void reveal()} title="Reveal location" type="button">
          <ExternalLink size={15} />
        </button>
        <button className="icon-button" disabled={artifact.status !== "ready"} onClick={() => void exportArtifact(artifact.id)} title="Export artifact" type="button">
          <Download size={15} />
        </button>
        {isAudio ? (
          <>
            <button className="icon-button" disabled={artifact.status !== "ready"} onClick={() => useArtifactAsReference(artifact.id)} title="Use as reference" type="button">
              <Play size={15} />
            </button>
            <button className="icon-button" disabled={artifact.status !== "ready"} onClick={() => void splitArtifactIntoStems(artifact.id)} title="Split to stems" type="button">
              <SlidersHorizontal size={15} />
            </button>
            <button className="icon-button" disabled={artifact.status !== "ready"} onClick={() => void convertArtifactToMidi(artifact.id, "melodic")} title="Convert to melodic MIDI" type="button">
              <Music2 size={15} />
            </button>
            <button className="icon-button" disabled={artifact.status !== "ready"} onClick={() => void convertArtifactToMidi(artifact.id, "drum")} title="Convert to drum MIDI" type="button">
              <AudioLines size={15} />
            </button>
            <button className="control-button" disabled={artifact.status !== "ready"} onClick={() => void createDerivedSessionFromArtifact(artifact.id, "free_format")} type="button">
              Start session from this melody
            </button>
          </>
        ) : null}
        {isMidi ? (
          <>
            <button className="control-button" disabled={artifact.status !== "ready"} onClick={() => void createDerivedSessionFromArtifact(artifact.id, "free_format")} type="button">
              Free Format
            </button>
            <button className="control-button" disabled={artifact.status !== "ready"} onClick={() => void createDerivedSessionFromArtifact(artifact.id, "stem_constructor")} type="button">
              Stem Constructor
            </button>
          </>
        ) : null}
      </div>
    </article>
  );
}

function ArtifactList({ session }: { session: GenostSession }) {
  const mergeSelectedStems = useSessionStudioStore((state) => state.mergeSelectedStems);
  const [selectedStems, setSelectedStems] = useState<string[]>([]);
  const byRevision = useMemo(
    () =>
      session.promptHistory.revisions.map((revision) => ({
        revision,
        artifacts: session.artifacts.filter((artifact) => artifact.promptRevisionId === revision.id || artifact.filePath.startsWith(`${revision.artifactFolder}/`)),
      })),
    [session.artifacts, session.promptHistory.revisions],
  );

  function toggleSelected(artifactId: string) {
    setSelectedStems((current) => (current.includes(artifactId) ? current.filter((id) => id !== artifactId) : [...current, artifactId]));
  }

  return (
    <div className="artifact-section">
      <div className="artifact-section-head">
        <h2>Artifacts</h2>
        <button className="control-button" disabled={selectedStems.length === 0} onClick={() => void mergeSelectedStems(selectedStems)} type="button">
          <AudioLines size={17} />
          Merge Selected
        </button>
      </div>
      {byRevision.map((group) => (
        <section className="artifact-revision" key={group.revision.id}>
          <div className="revision-label">
            <span>{group.revision.label}</span>
            <small>{group.revision.artifactFolder}</small>
          </div>
          <div className="artifact-grid">
            {group.artifacts.map((artifact) => (
              <ArtifactCard artifact={artifact} key={artifact.id} selected={selectedStems.includes(artifact.id)} toggleSelected={toggleSelected} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ActiveSessionWorkspace({ artifactTree }: { artifactTree: ArtifactTreeEntry[] }) {
  const activeSession = useSessionStudioStore((state) => state.activeSession);
  if (!activeSession) return null;
  const session = activeSession.session;

  return (
    <div className="session-workspace">
      <SessionHeader />
      {session.exportFolder ? <p className="path-readout">Export: {session.exportFolder}</p> : null}
      {session.type === "midi_generator" ? <MidiGeneratorView session={session} /> : null}
      {session.type === "free_format" ? <FreeFormatView artifactTree={artifactTree} session={session} /> : null}
      {session.type === "stem_constructor" ? <StemConstructorView artifactTree={artifactTree} session={session} /> : null}
      <ArtifactList session={session} />
    </div>
  );
}

export function SessionStudio() {
  const bootstrap = useSessionStudioStore((state) => state.bootstrap);
  const toggleTheme = useSessionStudioStore((state) => state.toggleTheme);
  const theme = useSessionStudioStore((state) => state.theme);
  const workingDirectory = useSessionStudioStore((state) => state.workingDirectory);
  const workerPreflight = useSessionStudioStore((state) => state.workerPreflight);
  const sessions = useSessionStudioStore((state) => state.sessions);
  const activeSession = useSessionStudioStore((state) => state.activeSession);
  const status = useSessionStudioStore((state) => state.status);
  const error = useSessionStudioStore((state) => state.error);
  const [creationType, setCreationType] = useState<SessionType | null>(null);
  const artifactTree = useArtifactTree(sessions, activeSession?.session ?? null);
  const canUseStudio = Boolean(workingDirectory && preflightAllowsStudio(workerPreflight));
  const ThemeIcon = theme === "dark" ? Sun : Moon;

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <section className="cp-root genost-screen session-studio min-h-screen bg-genost-base text-genost-text">
      <header className="studio-topbar">
        <div>
          <p className="eyebrow">GENOST</p>
          <h1>Session Studio</h1>
        </div>
        <div className="topbar-actions">
          {status ? <span className={`status-pill ${canUseStudio ? "ready" : ""}`}>{status}</span> : null}
          <button className="icon-button" onClick={toggleTheme} title={theme === "dark" ? "Use light theme" : "Use dark theme"} type="button">
            <ThemeIcon size={18} />
          </button>
        </div>
      </header>
      <ModelGate />
      {error ? <div className="studio-error">{error}</div> : null}
      <div className="studio-layout">
        <SessionSidebar onCreate={setCreationType} />
        <main className="studio-main">
          {!workingDirectory || !canUseStudio ? (
            <div className="setup-empty">
              <Cpu size={26} />
              <span>Working directory and local MusicGen medium/melody models are required.</span>
            </div>
          ) : creationType ? (
            <NewSessionForm onDone={() => setCreationType(null)} type={creationType} />
          ) : activeSession ? (
            <ActiveSessionWorkspace artifactTree={artifactTree} />
          ) : (
            <NewSessionChoices onCreate={setCreationType} />
          )}
        </main>
      </div>
    </section>
  );
}
