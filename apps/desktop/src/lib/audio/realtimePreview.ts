import { convertFileSrc } from "@tauri-apps/api/core";
import { Player, getContext, getTransport, start as startTone } from "tone";
import Tuna from "./tuna";
import {
  connectBlockMixGraph,
  connectMasterMixGraph,
  findPlayableStemById,
  getArrangementEndSeconds,
  getMasterEffectTailSeconds,
  type SkippedAudioClip,
} from "./audioGraph";
import { barsToSeconds } from "../project/format";
import type { GenostProject } from "../schema/project";
import { isUriAssetPath, resolveProjectAssetPath } from "./paths";

type PreviewEntry = { player: Player; start: number; duration: number };

export class ArrangerRealtimePreview {
  private readonly entries: PreviewEntry[] = [];
  private readonly effects: Array<{ disconnect(): void }> = [];
  private readonly nodes: AudioNode[] = [];
  private endEvent: number | null = null;
  private onEnded: (() => void) | null = null;
  readonly skippedClips: SkippedAudioClip[];
  readonly durationSeconds: number;

  private constructor(durationSeconds: number, skippedClips: SkippedAudioClip[]) {
    this.durationSeconds = durationSeconds;
    this.skippedClips = skippedClips;
  }

  get playableClipCount(): number {
    return this.entries.length;
  }

  static async create(projectPath: string, project: GenostProject, onEnded?: () => void): Promise<ArrangerRealtimePreview> {
    await startTone();
    const context = getContext().rawContext as AudioContext;
    const transport = getTransport();
    transport.stop();
    transport.cancel(0);
    transport.bpm.value = project.song.bpm;
    transport.timeSignature = project.song.timeSignature[0];
    transport.swing = Math.max(0, Math.min(1, project.song.swing.ratio - 1));

    const clips = project.arrangement.lanes.flatMap((lane) => lane.clips);
    const skippedClips: SkippedAudioClip[] = [];
    const durationSeconds = getArrangementEndSeconds(project) + getMasterEffectTailSeconds(project.mix);
    const preview = new ArrangerRealtimePreview(durationSeconds, skippedClips);
    preview.onEnded = onEnded ?? null;
    const tuna = new Tuna(context);
    const master = connectMasterMixGraph(context, tuna, project.mix);
    preview.effects.push(...master.effects);
    preview.nodes.push(...master.nodes);

    const blockInputs = new Map<string, AudioNode>();
    for (const clip of clips) {
      const block = project.blocks.find((item) => item.id === clip.blockId);
      const stem = findPlayableStemById(project, clip.stemId);
      const path = resolveProjectAssetPath(projectPath, stem?.filePath);
      if (!block || !stem || !path) {
        skippedClips.push({ clipId: clip.id, blockId: clip.blockId, reason: !block ? "missing block" : "missing playable stem" });
        continue;
      }
      const source = isUriAssetPath(path) ? path : convertFileSrc(path);
      let player: Player | null = null;

      try {
        player = new Player({ url: source, fadeIn: 0.008, fadeOut: 0.008 });
        await player.loaded;
        const requestedDuration = barsToSeconds(clip.bars, project.song.bpm, project.song.timeSignature[0]);
        const playableDuration = Math.min(player.buffer.duration, requestedDuration);

        if (!Number.isFinite(playableDuration) || playableDuration <= 0) {
          player.dispose();
          skippedClips.push({ clipId: clip.id, blockId: clip.blockId, reason: "empty playable stem" });
          continue;
        }

        let input = blockInputs.get(block.id);
        if (!input) {
          const blockGraph = connectBlockMixGraph(context, tuna, block, master);
          input = blockGraph.input;
          blockInputs.set(block.id, input);
          preview.effects.push(...blockGraph.effects);
          preview.nodes.push(...blockGraph.nodes);
        }
        player.connect(input);
        preview.entries.push({
          player,
          start: barsToSeconds(clip.startBar, project.song.bpm, project.song.timeSignature[0]),
          duration: playableDuration,
        });
      } catch (error) {
        player?.dispose();
        skippedClips.push({
          clipId: clip.id,
          blockId: clip.blockId,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return preview;
  }

  play(positionSeconds = getTransport().seconds): boolean {
    const transport = getTransport();
    const position = Math.max(0, Math.min(this.durationSeconds, positionSeconds));
    if (this.entries.length === 0 || this.durationSeconds <= 0 || position >= this.durationSeconds) {
      transport.stop();
      transport.cancel(0);
      transport.seconds = 0;
      return false;
    }

    transport.stop();
    transport.cancel(0);
    this.endEvent = null;
    for (const entry of this.entries) {
      entry.player.stop();
      const end = entry.start + entry.duration;
      if (end <= position) continue;
      const scheduled = Math.max(entry.start, position);
      const offset = Math.max(0, position - entry.start);
      const duration = entry.duration - offset;
      if (duration > 0) {
        transport.schedule((time) => entry.player.start(time, offset, duration), scheduled);
      }
    }
    this.endEvent = transport.scheduleOnce(() => {
      transport.stop();
      transport.seconds = 0;
      this.onEnded?.();
    }, this.durationSeconds);
    transport.start(undefined, position);
    return true;
  }

  pause(): number {
    const transport = getTransport();
    transport.pause();
    for (const entry of this.entries) entry.player.stop();
    return transport.seconds;
  }

  seek(positionSeconds: number, resume: boolean): number {
    const position = Math.max(0, Math.min(this.durationSeconds, positionSeconds));
    this.pause();
    getTransport().seconds = position;
    if (resume) this.play(position);
    return position;
  }

  get positionSeconds(): number {
    return getTransport().seconds;
  }

  dispose(): void {
    const transport = getTransport();
    transport.stop();
    transport.cancel(0);
    if (this.endEvent !== null) transport.clear(this.endEvent);
    for (const entry of this.entries) entry.player.dispose();
    for (const effect of this.effects) effect.disconnect();
    for (const node of this.nodes) node.disconnect();
    this.endEvent = null;
  }
}
