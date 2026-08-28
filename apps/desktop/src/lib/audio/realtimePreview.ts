import { convertFileSrc } from "@tauri-apps/api/core";
import { Player, getContext, getTransport, start as startTone } from "tone";
import Tuna, { type TunaEffect } from "./tuna";
import { barsToSeconds } from "../project/format";
import type { GenostBlock, GenostProject } from "../schema/project";
import { isUriAssetPath, resolveProjectAssetPath } from "./paths";

type PreviewEntry = { player: Player; start: number; duration: number };

function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

function makeImpulse(context: BaseAudioContext, seconds: number, dampeningHz: number): AudioBuffer {
  const length = Math.max(1, Math.ceil(seconds * context.sampleRate));
  const impulse = context.createBuffer(2, length, context.sampleRate);
  const damping = Math.max(0.4, Math.min(8, dampeningHz / 2200));
  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let index = 0; index < length; index += 1) {
      const progress = index / length;
      data[index] = (Math.random() * 2 - 1) * (1 - progress) ** damping;
    }
  }
  return impulse;
}

function connectBlockGraph(
  context: BaseAudioContext,
  tuna: Tuna,
  block: GenostBlock,
  masterInput: AudioNode,
  delayInput: AudioNode | null,
  reverbInput: AudioNode | null,
): AudioNode {
  const gain = new tuna.Gain({ gain: dbToGain(block.volumeDb), bypass: false });
  let output = gain.output;
  if (block.compressorEnabled) {
    const compressor = new tuna.Compressor({ threshold: -18, ratio: 4, attack: 8, release: 180 });
    gain.connect(compressor.input);
    output = compressor.output;
  }
  output.connect(masterInput);
  if (delayInput && block.delaySend > 0) {
    const send = context.createGain();
    send.gain.value = block.delaySend;
    output.connect(send);
    send.connect(delayInput);
  }
  if (reverbInput && block.reverbSend > 0) {
    const send = context.createGain();
    send.gain.value = block.reverbSend;
    output.connect(send);
    send.connect(reverbInput);
  }
  return gain.input;
}

export class ArrangerRealtimePreview {
  private readonly entries: PreviewEntry[] = [];
  private readonly effects: TunaEffect[] = [];
  private readonly nodes: AudioNode[] = [];
  private endEvent: number | null = null;
  private onEnded: (() => void) | null = null;
  readonly durationSeconds: number;

  private constructor(durationSeconds: number) {
    this.durationSeconds = durationSeconds;
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
    const durationSeconds = Math.max(
      0,
      ...clips.map((clip) => barsToSeconds(clip.startBar + clip.bars, project.song.bpm, project.song.timeSignature[0])),
    );
    const preview = new ArrangerRealtimePreview(durationSeconds);
    preview.onEnded = onEnded ?? null;
    const tuna = new Tuna(context);
    const masterInput = context.createGain();
    const masterDry = context.createGain();
    masterInput.connect(masterDry);
    preview.nodes.push(masterInput, masterDry);

    const delay = project.mix.masterDelayEnabled
      ? new tuna.Delay({
          delayTime: project.mix.masterDelayTimeMs,
          feedback: project.mix.masterDelayFeedback,
          cutoff: project.mix.masterDelayFilterHz,
          dryLevel: 0,
          wetLevel: project.mix.masterDelay,
        })
      : null;
    const reverb = project.mix.masterReverbEnabled
      ? new tuna.Convolver({ dryLevel: 0, wetLevel: project.mix.masterReverb, level: 1 })
      : null;
    if (reverb) reverb.convolver.buffer = makeImpulse(context, project.mix.masterReverbDecaySeconds, project.mix.masterReverbDampeningHz);
    const limiter = new tuna.Compressor({
      threshold: project.mix.masterLimiter ? project.mix.masterLimiterThresholdDb : 0,
      ratio: project.mix.masterLimiter ? 20 : 1,
      attack: 1,
      release: project.mix.masterLimiterReleaseMs,
      bypass: !project.mix.masterLimiter,
    });
    const output = context.createGain();
    output.gain.value = dbToGain(project.mix.outputGainDb);
    masterDry.connect(limiter.input);
    delay?.connect(limiter.input);
    reverb?.connect(limiter.input);
    limiter.connect(output);
    output.connect(context.destination);
    preview.effects.push(...[delay, reverb, limiter].filter((effect): effect is TunaEffect => Boolean(effect)));
    preview.nodes.push(output);

    const blockInputs = new Map<string, AudioNode>();
    for (const clip of clips) {
      const block = project.blocks.find((item) => item.id === clip.blockId);
      const stem = project.stems.find((item) => item.id === clip.stemId && ["ready", "stale"].includes(item.status));
      const path = resolveProjectAssetPath(projectPath, stem?.filePath);
      if (!block || !path) continue;
      const source = isUriAssetPath(path) ? path : convertFileSrc(path);
      const player = new Player({ url: source, fadeIn: 0.008, fadeOut: 0.008 });
      await player.loaded;
      const input = blockInputs.get(block.id) ?? connectBlockGraph(
        context,
        tuna,
        block,
        masterInput,
        delay?.input ?? null,
        reverb?.input ?? null,
      );
      blockInputs.set(block.id, input);
      player.connect(input);
      preview.entries.push({
        player,
        start: barsToSeconds(clip.startBar, project.song.bpm, project.song.timeSignature[0]),
        duration: Math.min(player.buffer.duration, barsToSeconds(clip.bars, project.song.bpm, project.song.timeSignature[0])),
      });
    }
    return preview;
  }

  play(positionSeconds = getTransport().seconds): void {
    const transport = getTransport();
    const position = Math.max(0, Math.min(this.durationSeconds, positionSeconds));
    transport.stop();
    transport.cancel(0);
    for (const entry of this.entries) {
      entry.player.stop();
      const end = entry.start + entry.duration;
      if (end <= position) continue;
      const scheduled = Math.max(entry.start, position);
      const offset = Math.max(0, position - entry.start);
      transport.schedule((time) => entry.player.start(time, offset, entry.duration - offset), scheduled);
    }
    this.endEvent = transport.scheduleOnce(() => {
      transport.stop();
      transport.seconds = 0;
      this.onEnded?.();
    }, this.durationSeconds);
    transport.seconds = position;
    transport.start();
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
  }
}
