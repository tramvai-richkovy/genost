import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "../project/format";
import { getArrangementEndSeconds, getMasterEffectTailSeconds } from "./audioGraph";
import { ArrangerRealtimePreview } from "./realtimePreview";
import type { ArrangementClip, GenostStem } from "../schema/project";

const toneMocks = vi.hoisted(() => {
  type ScheduledEvent = { callback: (time: number) => void; time: number };

  class FakeAudioNode {
    readonly gain = { value: 1 };
    readonly delayTime = { value: 0 };
    readonly threshold = { value: 0 };
    readonly ratio = { value: 0 };
    readonly attack = { value: 0 };
    readonly release = { value: 0 };
    readonly frequency = { value: 0 };
    type = "";
    buffer: unknown = null;
    connections: unknown[] = [];

    connect(target: unknown): unknown {
      this.connections.push(target);
      return target;
    }

    disconnect(): void {
      this.connections = [];
    }
  }

  function createFakeAudioContext(): AudioContext {
    return {
      sampleRate: 32000,
      destination: new FakeAudioNode(),
      createGain: () => new FakeAudioNode(),
      createDelay: () => new FakeAudioNode(),
      createBiquadFilter: () => new FakeAudioNode(),
      createConvolver: () => new FakeAudioNode(),
      createDynamicsCompressor: () => new FakeAudioNode(),
      createBuffer: (channels: number, length: number, sampleRate: number) => ({
        numberOfChannels: channels,
        length,
        sampleRate,
        getChannelData: () => new Float32Array(length),
      }),
    } as unknown as AudioContext;
  }

  const players: Array<{
    url: string;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }> = [];
  const scheduled: ScheduledEvent[] = [];
  const scheduledOnce: ScheduledEvent[] = [];

  class MockPlayer {
    readonly url: string;
    readonly loaded: Promise<void>;
    readonly buffer: { duration: number };
    readonly connect = vi.fn();
    readonly start = vi.fn();
    readonly stop = vi.fn();
    readonly dispose = vi.fn();

    constructor(options: { url: string }) {
      this.url = options.url;
      this.loaded = options.url.includes("bad") ? Promise.reject(new Error("decode failed")) : Promise.resolve();
      this.buffer = { duration: options.url.includes("empty") ? 0 : 4 };
      players.push(this);
    }
  }

  const transport = {
    bpm: { value: 0 },
    timeSignature: 0,
    swing: 0,
    seconds: 0,
    stop: vi.fn(),
    cancel: vi.fn(),
    clear: vi.fn(),
    pause: vi.fn(),
    start: vi.fn((_time?: unknown, offset?: number) => {
      transport.seconds = offset ?? transport.seconds;
    }),
    schedule: vi.fn((callback: (time: number) => void, time: number) => {
      scheduled.push({ callback, time });
      return scheduled.length;
    }),
    scheduleOnce: vi.fn((callback: (time: number) => void, time: number) => {
      scheduledOnce.push({ callback, time });
      return 100 + scheduledOnce.length;
    }),
  };

  return {
    createFakeAudioContext,
    MockPlayer,
    players,
    scheduled,
    scheduledOnce,
    startTone: vi.fn(() => Promise.resolve()),
    transport,
  };
});

vi.mock("tone", () => ({
  Player: toneMocks.MockPlayer,
  getContext: () => ({ rawContext: toneMocks.createFakeAudioContext() }),
  getTransport: () => toneMocks.transport,
  start: toneMocks.startTone,
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

function readyStem(overrides: Partial<GenostStem>): GenostStem {
  return {
    id: "stem_ready",
    blockId: "block",
    variation: 1,
    inputStemId: null,
    model: "facebook/musicgen-medium",
    promptHash: "abc123",
    seed: 1,
    durationSeconds: 4,
    status: "ready",
    queueOrder: null,
    fileName: "ready.wav",
    filePath: "STEMS/ready.wav",
    archivePath: null,
    revisionOfStemId: null,
    staleReason: null,
    error: null,
    renderMetadata: null,
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  toneMocks.players.length = 0;
  toneMocks.scheduled.length = 0;
  toneMocks.scheduledOnce.length = 0;
  toneMocks.startTone.mockClear();
  toneMocks.transport.bpm.value = 0;
  toneMocks.transport.timeSignature = 0;
  toneMocks.transport.swing = 0;
  toneMocks.transport.seconds = 0;
  toneMocks.transport.stop.mockClear();
  toneMocks.transport.cancel.mockClear();
  toneMocks.transport.clear.mockClear();
  toneMocks.transport.pause.mockClear();
  toneMocks.transport.start.mockClear();
  toneMocks.transport.schedule.mockClear();
  toneMocks.transport.scheduleOnce.mockClear();
});

describe("ArrangerRealtimePreview", () => {
  it("loads playable stems and reports missing preview clips", async () => {
    const project = createEmptyProject("Realtime Preview");
    const block = project.blocks[0];
    const playableClip = { ...project.arrangement.lanes[0].clips[0], id: "clip_playable", stemId: "stem_ready" };
    const missingClip: ArrangementClip = {
      ...playableClip,
      id: "clip_missing",
      startBar: playableClip.startBar + playableClip.bars,
      stemId: null,
    };
    const unreadableClip: ArrangementClip = {
      ...playableClip,
      id: "clip_unreadable",
      startBar: missingClip.startBar + missingClip.bars,
      stemId: "stem_bad",
    };
    const emptyClip: ArrangementClip = {
      ...playableClip,
      id: "clip_empty",
      startBar: unreadableClip.startBar + unreadableClip.bars,
      stemId: "stem_empty",
    };
    project.arrangement.lanes[0].clips = [playableClip, missingClip, unreadableClip, emptyClip];
    project.stems = [
      readyStem({ blockId: block.id }),
      readyStem({ id: "stem_bad", blockId: block.id, fileName: "bad.wav", filePath: "STEMS/bad.wav" }),
      readyStem({ id: "stem_empty", blockId: block.id, fileName: "empty.wav", filePath: "STEMS/empty.wav" }),
    ];

    const preview = await ArrangerRealtimePreview.create("/project", project);

    expect(toneMocks.startTone).toHaveBeenCalledOnce();
    expect(toneMocks.transport.bpm.value).toBe(project.song.bpm);
    expect(toneMocks.transport.timeSignature).toBe(project.song.timeSignature[0]);
    expect(preview.durationSeconds).toBeCloseTo(getArrangementEndSeconds(project) + getMasterEffectTailSeconds(project.mix), 5);
    expect(preview.playableClipCount).toBe(1);
    expect(preview.skippedClips).toEqual([
      { clipId: "clip_missing", blockId: block.id, reason: "missing playable stem" },
      { clipId: "clip_unreadable", blockId: block.id, reason: "decode failed" },
      { clipId: "clip_empty", blockId: block.id, reason: "empty playable stem" },
    ]);
    expect(toneMocks.players[0].url).toBe("asset:///project/STEMS/ready.wav");

    preview.dispose();
  });

  it("starts an active clip from the requested seek offset", async () => {
    const project = createEmptyProject("Realtime Seek");
    const block = project.blocks[0];
    project.arrangement.lanes[0].clips = [{ ...project.arrangement.lanes[0].clips[0], id: "clip_playable", stemId: "stem_ready" }];
    project.stems = [readyStem({ blockId: block.id })];
    const preview = await ArrangerRealtimePreview.create("/project", project);

    expect(preview.play(1)).toBe(true);
    expect(toneMocks.transport.start).toHaveBeenCalledWith(undefined, 1);
    expect(toneMocks.scheduled[0].time).toBe(1);

    toneMocks.scheduled[0].callback(20);

    expect(toneMocks.players[0].start).toHaveBeenCalledWith(20, 1, 3);

    preview.dispose();
  });

  it("does not start transport when no stems are playable", async () => {
    const project = createEmptyProject("Realtime Empty");
    project.arrangement.lanes[0].clips = [{ ...project.arrangement.lanes[0].clips[0], id: "clip_missing", stemId: null }];

    const preview = await ArrangerRealtimePreview.create("/project", project);

    expect(preview.playableClipCount).toBe(0);
    expect(preview.play()).toBe(false);
    expect(toneMocks.transport.start).not.toHaveBeenCalled();
    expect(toneMocks.transport.seconds).toBe(0);

    preview.dispose();
  });
});
