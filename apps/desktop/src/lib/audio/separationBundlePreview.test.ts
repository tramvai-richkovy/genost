import { afterEach, describe, expect, it, vi } from "vitest";
import { decibelsToGain, normalizeSeparationVolumeDb, SeparationBundleLoopPreview } from "./separationBundlePreview";

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it("starts every output together and loops to the shortest decoded output", async () => {
    const starts = [vi.fn(), vi.fn()];
    const stops = [vi.fn(), vi.fn()];
    const gainTargets = [vi.fn(), vi.fn()];
    let sourceIndex = 0;
    let gainIndex = 0;
    const close = vi.fn().mockResolvedValue(undefined);
    const context = {
      currentTime: 4,
      destination: {},
      resume: vi.fn().mockResolvedValue(undefined),
      close,
      decodeAudioData: vi.fn()
        .mockResolvedValueOnce({ duration: 8 })
        .mockResolvedValueOnce({ duration: 5 }),
      createDynamicsCompressor: vi.fn(() => ({
        threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 }, attack: { value: 0 }, release: { value: 0 }, connect: vi.fn(),
      })),
      createGain: vi.fn(() => {
        const index = gainIndex++;
        return { gain: { value: 0, setTargetAtTime: gainTargets[index] }, connect: vi.fn() };
      }),
      createBufferSource: vi.fn(() => {
        const index = sourceIndex++;
        return { buffer: null, loop: false, loopEnd: 0, connect: vi.fn(), start: starts[index], stop: stops[index] };
      }),
    };
    class MockAudioContext {
      constructor() {
        return context;
      }
    }
    vi.stubGlobal("AudioContext", MockAudioContext);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1)) }));

    const preview = await SeparationBundleLoopPreview.create([
      { id: "bass", path: "asset://bass.wav", volumeDb: -6 },
      { id: "piano", path: "asset://piano.wav", volumeDb: 3 },
    ]);

    expect(starts[0]).toHaveBeenCalledWith(4.05);
    expect(starts[1]).toHaveBeenCalledWith(4.05);
    const sources = context.createBufferSource.mock.results.map((result) => result.value);
    expect(sources.map((source) => source.loopEnd)).toEqual([5, 5]);

    preview.setVolume("piano", -12);
    expect(gainTargets[1]).toHaveBeenCalledWith(decibelsToGain(-12), 4, 0.015);
    preview.stop();
    expect(stops[0]).toHaveBeenCalledOnce();
    expect(stops[1]).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes the audio context when an output cannot be decoded", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const context = {
      currentTime: 0,
      destination: {},
      resume: vi.fn().mockResolvedValue(undefined),
      close,
      decodeAudioData: vi.fn().mockRejectedValue(new Error("decode failed")),
      createDynamicsCompressor: vi.fn(),
      createGain: vi.fn(),
      createBufferSource: vi.fn(),
    };
    class MockAudioContext {
      constructor() {
        return context;
      }
    }
    vi.stubGlobal("AudioContext", MockAudioContext);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1)) }));

    await expect(SeparationBundleLoopPreview.create([
      { id: "other", path: "asset://other.wav", volumeDb: 0 },
    ])).rejects.toThrow("decode failed");
    expect(close).toHaveBeenCalledOnce();
  });
});
