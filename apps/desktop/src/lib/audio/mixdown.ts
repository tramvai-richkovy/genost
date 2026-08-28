import { convertFileSrc } from "@tauri-apps/api/core";
import { exists, mkdir, writeFile } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import Tuna from "./tuna";
import { barsToSeconds, nowIso } from "../project/format";
import { writeStemSidecar } from "../project/storage";
import type { GenostBlock, GenostProject, GenostStem } from "../schema/project";
import { isUriAssetPath, resolveProjectAssetPath } from "./paths";

export type SkippedMixClip = { clipId: string; blockId: string; reason: string };
export type MixBuildResult = {
  absolutePath: string;
  relativePath: string;
  durationSeconds: number;
  peak: number;
  loudnessDb: number;
  normalizationGainDb: number;
  skippedClips: SkippedMixClip[];
};

function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

function stemForClip(project: GenostProject, stemId: string | null): GenostStem | null {
  if (!stemId) return null;
  return project.stems.find((stem) => stem.id === stemId && ["ready", "stale"].includes(stem.status)) ?? null;
}

async function decodeStem(context: BaseAudioContext, path: string): Promise<AudioBuffer> {
  const source = isUriAssetPath(path) ? path : convertFileSrc(path);
  const response = await fetch(source);
  if (!response.ok) throw new Error(`Could not read stem audio (${response.status}): ${path}`);
  return context.decodeAudioData(await response.arrayBuffer());
}

function makeImpulse(context: BaseAudioContext, seconds: number, dampeningHz: number): AudioBuffer {
  const length = Math.max(1, Math.ceil(seconds * context.sampleRate));
  const impulse = context.createBuffer(2, length, context.sampleRate);
  const damping = Math.max(0.4, Math.min(8, dampeningHz / 2200));
  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let index = 0; index < length; index += 1) {
      const time = index / length;
      data[index] = (Math.random() * 2 - 1) * (1 - time) ** damping;
    }
  }
  return impulse;
}

function connectBlockGraph(
  context: OfflineAudioContext,
  tuna: Tuna,
  block: GenostBlock,
  masterInput: AudioNode,
  delayInput: AudioNode | null,
  reverbInput: AudioNode | null,
): AudioNode {
  const gain = new tuna.Gain({ gain: dbToGain(block.volumeDb), bypass: false });
  let output: AudioNode = gain.output;
  if (block.compressorEnabled) {
    const compressor = new tuna.Compressor({
      threshold: -18,
      ratio: 4,
      attack: 8,
      release: 180,
      makeupGain: 0,
      automakeup: false,
      bypass: false,
    });
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

function peakOf(buffer: AudioBuffer): number {
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) peak = Math.max(peak, Math.abs(data[index]));
  }
  return peak;
}

export function normalizeMixLoudness(buffer: AudioBuffer, targetDb = -14, peakCeilingDb = -1): {
  peak: number;
  loudnessDb: number;
  gainDb: number;
} {
  let sumSquares = 0;
  let sampleCount = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) {
      sumSquares += data[index] ** 2;
      sampleCount += 1;
    }
  }
  const rms = Math.sqrt(sumSquares / Math.max(1, sampleCount));
  const loudnessDbBefore = rms > 0 ? 20 * Math.log10(rms) : -96;
  const peakBefore = peakOf(buffer);
  const loudnessGainDb = targetDb - loudnessDbBefore;
  const peakGainDb = peakBefore > 0 ? peakCeilingDb - 20 * Math.log10(peakBefore) : 0;
  const gainDb = Math.min(loudnessGainDb, peakGainDb);
  const gain = dbToGain(gainDb);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) data[index] *= gain;
  }
  return { peak: peakOf(buffer), loudnessDb: loudnessDbBefore + gainDb, gainDb };
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}

function encodePcm24Wav(buffer: AudioBuffer): Uint8Array {
  const channels = Math.min(2, buffer.numberOfChannels);
  const bytesPerSample = 3;
  const dataLength = buffer.length * channels * bytesPerSample;
  const bytes = new Uint8Array(44 + dataLength);
  const view = new DataView(bytes.buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(view, 8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 24, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataLength, true);
  const channelData = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
  let offset = 44;
  for (let frame = 0; frame < buffer.length; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channelData[channel][frame]));
      const integer = Math.round(sample * (sample < 0 ? 0x800000 : 0x7fffff));
      view.setUint8(offset, integer & 0xff);
      view.setUint8(offset + 1, (integer >> 8) & 0xff);
      view.setUint8(offset + 2, (integer >> 16) & 0xff);
      offset += 3;
    }
  }
  return bytes;
}

export async function buildArrangerMix(projectPath: string, project: GenostProject): Promise<MixBuildResult> {
  const clips = project.arrangement.lanes.flatMap((lane) => lane.clips);
  const endSeconds = Math.max(
    1,
    ...clips.map((clip) =>
      barsToSeconds(clip.startBar + clip.bars, project.song.bpm, project.song.timeSignature[0]),
    ),
  );
  const effectTail = Math.max(
    project.mix.masterReverbEnabled ? project.mix.masterReverbDecaySeconds : 0,
    project.mix.masterDelayEnabled ? (project.mix.masterDelayTimeMs / 1000) * 4 : 0,
  );
  const durationSeconds = endSeconds + effectTail;
  const context = new OfflineAudioContext(2, Math.ceil(durationSeconds * project.song.sampleRate), project.song.sampleRate);
  const tuna = new Tuna(context);
  const masterInput = context.createGain();
  const masterDry = context.createGain();
  masterInput.connect(masterDry);

  const delay = project.mix.masterDelayEnabled
    ? new tuna.Delay({
        delayTime: project.mix.masterDelayTimeMs,
        feedback: project.mix.masterDelayFeedback,
        cutoff: project.mix.masterDelayFilterHz,
        dryLevel: 0,
        wetLevel: project.mix.masterDelay,
        bypass: false,
      })
    : null;
  const reverb = project.mix.masterReverbEnabled
    ? new tuna.Convolver({ dryLevel: 0, wetLevel: project.mix.masterReverb, level: 1, bypass: false })
    : null;
  if (reverb) {
    const convolver = (reverb as unknown as { convolver: ConvolverNode }).convolver;
    convolver.buffer = makeImpulse(context, project.mix.masterReverbDecaySeconds, project.mix.masterReverbDampeningHz);
  }

  const limiter = new tuna.Compressor({
    threshold: project.mix.masterLimiter ? project.mix.masterLimiterThresholdDb : 0,
    ratio: project.mix.masterLimiter ? 20 : 1,
    attack: 1,
    release: project.mix.masterLimiterReleaseMs,
    makeupGain: 0,
    automakeup: false,
    bypass: !project.mix.masterLimiter,
  });
  const output = context.createGain();
  output.gain.value = dbToGain(project.mix.outputGainDb);
  masterDry.connect(limiter.input);
  delay?.connect(limiter.input);
  reverb?.connect(limiter.input);
  limiter.connect(output);
  output.connect(context.destination);

  const blockInputs = new Map<string, AudioNode>();
  const skippedClips: SkippedMixClip[] = [];
  for (const clip of clips) {
    const block = project.blocks.find((item) => item.id === clip.blockId);
    const stem = stemForClip(project, clip.stemId);
    const absolutePath = resolveProjectAssetPath(projectPath, stem?.filePath);
    if (!block || !stem || !absolutePath) {
      skippedClips.push({ clipId: clip.id, blockId: clip.blockId, reason: !block ? "missing block" : "missing playable stem" });
      continue;
    }
    try {
      const buffer = await decodeStem(context, absolutePath);
      const input = blockInputs.get(block.id) ?? connectBlockGraph(
        context,
        tuna,
        block,
        masterInput,
        delay?.input ?? null,
        reverb?.input ?? null,
      );
      blockInputs.set(block.id, input);
      const source = context.createBufferSource();
      const clipGain = context.createGain();
      source.buffer = buffer;
      source.connect(clipGain);
      clipGain.connect(input);
      const start = barsToSeconds(clip.startBar, project.song.bpm, project.song.timeSignature[0]);
      const requestedDuration = barsToSeconds(clip.bars, project.song.bpm, project.song.timeSignature[0]);
      const playDuration = Math.min(buffer.duration, requestedDuration);
      const fade = Math.min(0.008, playDuration / 4);
      clipGain.gain.setValueAtTime(0, start);
      clipGain.gain.linearRampToValueAtTime(1, start + fade);
      clipGain.gain.setValueAtTime(1, Math.max(start + fade, start + playDuration - fade));
      clipGain.gain.linearRampToValueAtTime(0, start + playDuration);
      source.start(start, 0, playDuration);
    } catch (error) {
      skippedClips.push({
        clipId: clip.id,
        blockId: clip.blockId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const rendered = await context.startRendering();
  const normalized = normalizeMixLoudness(rendered);
  const peak = normalized.peak;
  const timestamp = nowIso().replace(/[:.]/g, "-");
  const fileName = `${project.title.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "GENOST"}_${timestamp}.wav`;
  const mixesPath = await join(projectPath, "MIXES");
  if (!(await exists(mixesPath))) await mkdir(mixesPath, { recursive: true });
  const absolutePath = await join(mixesPath, fileName);
  await writeFile(absolutePath, encodePcm24Wav(rendered));
  await writeStemSidecar(absolutePath, {
    schemaVersion: 1,
    type: "arranger_mix",
    projectId: project.id,
    sampleRate: rendered.sampleRate,
    channels: rendered.numberOfChannels,
    bitDepth: 24,
    durationSeconds: rendered.duration,
    peak,
    loudnessDb: normalized.loudnessDb,
    normalizationGainDb: normalized.gainDb,
    clipped: peak > 1,
    skippedClips,
    builtAt: nowIso(),
    settings: project.mix,
  });
  return {
    absolutePath,
    relativePath: `MIXES/${fileName}`,
    durationSeconds: rendered.duration,
    peak,
    loudnessDb: normalized.loudnessDb,
    normalizationGainDb: normalized.gainDb,
    skippedClips,
  };
}
