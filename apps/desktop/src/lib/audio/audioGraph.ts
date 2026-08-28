import Tuna, { type TunaEffect } from "./tuna";
import { barsToSeconds } from "../project/format";
import type { GenostBlock, GenostProject, GenostStem } from "../schema/project";

export type SkippedAudioClip = { clipId: string; blockId: string; reason: string };

export type MasterMixGraph = {
  masterInput: AudioNode;
  delayInput: AudioNode | null;
  reverbInput: AudioNode | null;
  effects: TunaEffect[];
  nodes: AudioNode[];
};

export type BlockMixGraph = {
  input: AudioNode;
  effects: TunaEffect[];
  nodes: AudioNode[];
};

const PLAYABLE_STEM_STATUSES = new Set<GenostStem["status"]>(["ready", "stale"]);

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

export function findPlayableStemById(project: GenostProject, stemId: string | null | undefined): GenostStem | null {
  if (!stemId) {
    return null;
  }

  const stem = project.stems.find((item) => item.id === stemId);
  return stem && PLAYABLE_STEM_STATUSES.has(stem.status) ? stem : null;
}

export function getArrangementEndSeconds(project: GenostProject): number {
  return Math.max(
    0,
    ...project.arrangement.lanes.flatMap((lane) =>
      lane.clips.map((clip) =>
        barsToSeconds(clip.startBar + clip.bars, project.song.bpm, project.song.timeSignature[0]),
      ),
    ),
  );
}

export function getMasterEffectTailSeconds(mix: GenostProject["mix"]): number {
  return Math.max(
    mix.masterReverbEnabled ? mix.masterReverbDecaySeconds + mix.masterReverbPreDelayMs / 1000 : 0,
    mix.masterDelayEnabled ? (mix.masterDelayTimeMs / 1000) * 4 : 0,
  );
}

export function makeImpulse(context: BaseAudioContext, seconds: number, dampeningHz: number): AudioBuffer {
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

export function connectMasterMixGraph(
  context: BaseAudioContext,
  tuna: Tuna,
  mix: GenostProject["mix"],
  destination: AudioNode = context.destination,
): MasterMixGraph {
  const masterInput = context.createGain();
  const masterDry = context.createGain();
  masterInput.connect(masterDry);

  const delay = mix.masterDelayEnabled
    ? new tuna.Delay({
        delayTime: mix.masterDelayTimeMs,
        feedback: mix.masterDelayFeedback,
        cutoff: mix.masterDelayFilterHz,
        dryLevel: 0,
        wetLevel: mix.masterDelay,
        bypass: false,
      })
    : null;
  const reverb = mix.masterReverbEnabled
    ? new tuna.Convolver({ dryLevel: 0, wetLevel: mix.masterReverb, level: 1, bypass: false })
    : null;
  const nodes: AudioNode[] = [masterInput, masterDry];
  let reverbInput = reverb?.input ?? null;

  if (reverb) {
    reverb.convolver.buffer = makeImpulse(context, mix.masterReverbDecaySeconds, mix.masterReverbDampeningHz);
    if (mix.masterReverbPreDelayMs > 0) {
      const preDelay = context.createDelay(Math.max(0.001, mix.masterReverbPreDelayMs / 1000));
      preDelay.delayTime.value = mix.masterReverbPreDelayMs / 1000;
      preDelay.connect(reverb.input);
      reverbInput = preDelay;
      nodes.push(preDelay);
    }
  }

  const limiter = new tuna.Compressor({
    threshold: mix.masterLimiter ? mix.masterLimiterThresholdDb : 0,
    ratio: mix.masterLimiter ? 20 : 1,
    attack: 1,
    release: mix.masterLimiterReleaseMs,
    makeupGain: 0,
    automakeup: false,
    bypass: !mix.masterLimiter,
  });
  const output = context.createGain();
  output.gain.value = dbToGain(mix.outputGainDb);

  masterDry.connect(limiter.input);
  delay?.connect(limiter.input);
  reverb?.connect(limiter.input);
  limiter.connect(output);
  output.connect(destination);
  nodes.push(output);

  return {
    masterInput,
    delayInput: delay?.input ?? null,
    reverbInput,
    effects: [delay, reverb, limiter].filter((effect): effect is TunaEffect => Boolean(effect)),
    nodes,
  };
}

export function connectBlockMixGraph(
  context: BaseAudioContext,
  tuna: Tuna,
  block: GenostBlock,
  master: Pick<MasterMixGraph, "masterInput" | "delayInput" | "reverbInput">,
): BlockMixGraph {
  const gain = new tuna.Gain({ gain: dbToGain(block.volumeDb), bypass: false });
  const effects: TunaEffect[] = [gain];
  const nodes: AudioNode[] = [];
  let output = gain.output;

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
    effects.push(compressor);
  }

  output.connect(master.masterInput);
  if (master.delayInput && block.delaySend > 0) {
    const send = context.createGain();
    send.gain.value = block.delaySend;
    output.connect(send);
    send.connect(master.delayInput);
    nodes.push(send);
  }
  if (master.reverbInput && block.reverbSend > 0) {
    const send = context.createGain();
    send.gain.value = block.reverbSend;
    output.connect(send);
    send.connect(master.reverbInput);
    nodes.push(send);
  }

  return { input: gain.input, effects, nodes };
}
