import { describe, expect, it } from "vitest";
import { summarizeWaveform } from "./WaveformPreview";

function makeBuffer(channels: number[][]): AudioBuffer {
  return {
    length: channels[0]?.length ?? 0,
    numberOfChannels: channels.length,
    getChannelData: (channel: number) => Float32Array.from(channels[channel]),
  } as unknown as AudioBuffer;
}

describe("summarizeWaveform", () => {
  it("takes the absolute peak across every channel in each bucket", () => {
    const buffer = makeBuffer([
      [0.1, -0.4, 0.2, 0.3],
      [0.7, 0.1, -0.8, 0.2],
    ]);

    expect(summarizeWaveform(buffer, 2)).toEqual([expect.closeTo(0.7), expect.closeTo(0.8)]);
  });

  it("supports previews with more buckets than source frames", () => {
    const buffer = makeBuffer([[0.25, -0.5]]);

    expect(summarizeWaveform(buffer, 4)).toEqual([
      expect.closeTo(0.25),
      expect.closeTo(0.25),
      expect.closeTo(0.5),
      expect.closeTo(0.5),
    ]);
  });

  it("rejects invalid bucket counts", () => {
    expect(() => summarizeWaveform(makeBuffer([[0.1]]), 0)).toThrow("positive integer");
  });
});
