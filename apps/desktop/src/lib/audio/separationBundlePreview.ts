import { convertFileSrc } from "@tauri-apps/api/core";
import { isUriAssetPath } from "./paths";

export type SeparationPreviewTrack = {
  id: string;
  path: string;
  volumeDb: number;
};

export function normalizeSeparationVolumeDb(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(6, Math.max(-60, Math.round(value)));
}

export function decibelsToGain(value: number): number {
  return 10 ** (normalizeSeparationVolumeDb(value) / 20);
}

async function decodeTrack(context: AudioContext, track: SeparationPreviewTrack): Promise<AudioBuffer> {
  const source = isUriAssetPath(track.path) ? track.path : convertFileSrc(track.path);
  const response = await fetch(source);
  if (!response.ok) throw new Error(`Could not load ${track.id} (${response.status}).`);
  return context.decodeAudioData(await response.arrayBuffer());
}

export class SeparationBundleLoopPreview {
  private constructor(
    private readonly context: AudioContext,
    private readonly sources: AudioBufferSourceNode[],
    private readonly gains: Map<string, GainNode>,
  ) {}

  static async create(tracks: SeparationPreviewTrack[]): Promise<SeparationBundleLoopPreview> {
    if (tracks.length === 0) throw new Error("This separation bundle has no playable outputs.");

    const context = new AudioContext();
    await context.resume();
    try {
      const buffers = await Promise.all(tracks.map((track) => decodeTrack(context, track)));
      const loopDuration = Math.min(...buffers.map((buffer) => buffer.duration));
      if (!Number.isFinite(loopDuration) || loopDuration <= 0) throw new Error("Separation outputs have no playable duration.");

      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -1;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.12;
      limiter.connect(context.destination);

      const sources: AudioBufferSourceNode[] = [];
      const gains = new Map<string, GainNode>();
      const startAt = context.currentTime + 0.05;
      tracks.forEach((track, index) => {
        const gain = context.createGain();
        gain.gain.value = decibelsToGain(track.volumeDb);
        gain.connect(limiter);
        gains.set(track.id, gain);

        const source = context.createBufferSource();
        source.buffer = buffers[index];
        source.loop = true;
        source.loopEnd = loopDuration;
        source.connect(gain);
        source.start(startAt);
        sources.push(source);
      });
      return new SeparationBundleLoopPreview(context, sources, gains);
    } catch (error) {
      await context.close();
      throw error;
    }
  }

  setVolume(outputId: string, volumeDb: number): void {
    const gain = this.gains.get(outputId);
    if (!gain) return;
    gain.gain.setTargetAtTime(decibelsToGain(volumeDb), this.context.currentTime, 0.015);
  }

  stop(): void {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // A source can already be stopped during WebView teardown.
      }
    }
    void this.context.close();
  }
}
