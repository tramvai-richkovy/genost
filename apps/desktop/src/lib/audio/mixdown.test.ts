import { describe, expect, it } from "vitest";
import { normalizeMixLoudness } from "./mixdown";

describe("normalizeMixLoudness", () => {
  it("raises quiet audio toward the target without crossing the peak ceiling", () => {
    const samples = new Float32Array([0.01, -0.01, 0.01, -0.01]);
    const buffer = {
      numberOfChannels: 1,
      getChannelData: () => samples,
    } as unknown as AudioBuffer;

    const result = normalizeMixLoudness(buffer);

    expect(result.loudnessDb).toBeCloseTo(-14, 1);
    expect(result.peak).toBeLessThanOrEqual(10 ** (-1 / 20));
    expect(result.gainDb).toBeGreaterThan(0);
  });

  it("uses the peak ceiling when loudness gain would clip", () => {
    const samples = new Float32Array(100);
    samples[0] = 0.9;
    const buffer = {
      numberOfChannels: 1,
      getChannelData: () => samples,
    } as unknown as AudioBuffer;

    const result = normalizeMixLoudness(buffer);

    expect(result.peak).toBeCloseTo(10 ** (-1 / 20), 4);
  });
});
