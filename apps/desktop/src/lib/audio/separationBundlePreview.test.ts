import { describe, expect, it } from "vitest";
import { decibelsToGain, normalizeSeparationVolumeDb } from "./separationBundlePreview";

describe("separation bundle preview levels", () => {
  it("normalizes persisted fader values to the supported range", () => {
    expect(normalizeSeparationVolumeDb(-100)).toBe(-60);
    expect(normalizeSeparationVolumeDb(2.6)).toBe(3);
    expect(normalizeSeparationVolumeDb(20)).toBe(6);
    expect(normalizeSeparationVolumeDb(Number.NaN)).toBe(0);
  });

  it("converts decibels to linear Web Audio gain", () => {
    expect(decibelsToGain(0)).toBe(1);
    expect(decibelsToGain(-6)).toBeCloseTo(0.501187, 5);
    expect(decibelsToGain(6)).toBeCloseTo(1.995262, 5);
  });
});
