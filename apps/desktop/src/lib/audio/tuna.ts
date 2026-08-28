// Original GENOST implementation of the narrow Tuna-style API used by mixdown.
// No upstream TUNA source is vendored here.

type EffectTarget = AudioNode;

export type TunaEffect = {
  input: AudioNode;
  output: AudioNode;
  connect(target: EffectTarget): AudioNode;
  disconnect(): void;
};

type GainOptions = {
  gain?: number;
  bypass?: boolean;
};

type CompressorOptions = {
  threshold?: number;
  ratio?: number;
  attack?: number;
  release?: number;
  makeupGain?: number;
  automakeup?: boolean;
  bypass?: boolean;
};

type DelayOptions = {
  delayTime?: number;
  feedback?: number;
  cutoff?: number;
  dryLevel?: number;
  wetLevel?: number;
  bypass?: boolean;
};

type ConvolverOptions = {
  dryLevel?: number;
  wetLevel?: number;
  level?: number;
  bypass?: boolean;
};

class BaseEffect implements TunaEffect {
  constructor(
    readonly input: AudioNode,
    readonly output: AudioNode,
  ) {}

  connect(target: EffectTarget): AudioNode {
    return this.output.connect(target);
  }

  disconnect(): void {
    this.output.disconnect();
  }
}

class GainEffect extends BaseEffect {
  constructor(context: BaseAudioContext, options: GainOptions = {}) {
    const gain = context.createGain();
    gain.gain.value = options.bypass ? 1 : options.gain ?? 1;
    super(gain, gain);
  }
}

class CompressorEffect extends BaseEffect {
  constructor(context: BaseAudioContext, options: CompressorOptions = {}) {
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = options.threshold ?? -24;
    compressor.ratio.value = options.bypass ? 1 : options.ratio ?? 12;
    compressor.attack.value = millisecondsToSeconds(options.attack ?? 3);
    compressor.release.value = millisecondsToSeconds(options.release ?? 250);

    const makeup = context.createGain();
    makeup.gain.value = options.bypass ? 1 : dbToGain(options.makeupGain ?? 0);
    compressor.connect(makeup);
    super(compressor, makeup);
  }
}

class DelayEffect extends BaseEffect {
  constructor(context: BaseAudioContext, options: DelayOptions = {}) {
    const input = context.createGain();
    const output = context.createGain();
    const dry = context.createGain();
    const delay = context.createDelay(4);
    const feedback = context.createGain();
    const filter = context.createBiquadFilter();
    const wet = context.createGain();
    const bypass = Boolean(options.bypass);

    delay.delayTime.value = millisecondsToSeconds(options.delayTime ?? 250);
    feedback.gain.value = bypass ? 0 : clamp(options.feedback ?? 0.2, 0, 0.95);
    filter.type = "lowpass";
    filter.frequency.value = options.cutoff ?? 8000;
    dry.gain.value = bypass ? 1 : options.dryLevel ?? 1;
    wet.gain.value = bypass ? 0 : options.wetLevel ?? 0.5;

    input.connect(dry);
    dry.connect(output);
    input.connect(delay);
    delay.connect(filter);
    filter.connect(wet);
    wet.connect(output);
    filter.connect(feedback);
    feedback.connect(delay);
    super(input, output);
  }
}

class ConvolverEffect extends BaseEffect {
  readonly convolver: ConvolverNode;

  constructor(context: BaseAudioContext, options: ConvolverOptions = {}) {
    const input = context.createGain();
    const output = context.createGain();
    const dry = context.createGain();
    const convolver = context.createConvolver();
    const wet = context.createGain();
    const bypass = Boolean(options.bypass);

    dry.gain.value = bypass ? 1 : options.dryLevel ?? 1;
    wet.gain.value = bypass ? 0 : (options.wetLevel ?? 0.5) * (options.level ?? 1);

    input.connect(dry);
    dry.connect(output);
    input.connect(convolver);
    convolver.connect(wet);
    wet.connect(output);
    super(input, output);
    this.convolver = convolver;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

function millisecondsToSeconds(milliseconds: number): number {
  return milliseconds / 1000;
}

export default class Tuna {
  Gain: new (options?: GainOptions) => TunaEffect;
  Compressor: new (options?: CompressorOptions) => TunaEffect;
  Delay: new (options?: DelayOptions) => TunaEffect;
  Convolver: new (options?: ConvolverOptions) => TunaEffect & { convolver: ConvolverNode };

  constructor(context: BaseAudioContext) {
    this.Gain = class extends GainEffect {
      constructor(options?: GainOptions) {
        super(context, options);
      }
    };
    this.Compressor = class extends CompressorEffect {
      constructor(options?: CompressorOptions) {
        super(context, options);
      }
    };
    this.Delay = class extends DelayEffect {
      constructor(options?: DelayOptions) {
        super(context, options);
      }
    };
    this.Convolver = class extends ConvolverEffect {
      constructor(options?: ConvolverOptions) {
        super(context, options);
      }
    };
  }
}
