// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
vi.mock("wave-roll", () => ({}));
import { MidiRollPreview } from "./MidiRollPreview";

describe("MidiRollPreview", () => {
  it("renders independent previews and disposes their elements on unmount", () => {
    const view = render(
      <>
        <MidiRollPreview name="one" path="/tmp/one.mid" toAssetUrl={(path) => `asset://${path}`} />
        <MidiRollPreview name="two" path="/tmp/two.mid" toAssetUrl={(path) => `asset://${path}`} />
      </>,
    );
    const previews = view.container.querySelectorAll("wave-roll");
    expect(previews).toHaveLength(2);
    expect(previews[0].getAttribute("files")).toContain("asset:///tmp/one.mid");
    const pause = vi.fn();
    Object.assign(previews[0], { pause });
    view.unmount();
    expect(pause).toHaveBeenCalledOnce();
    expect(view.container.querySelectorAll("wave-roll")).toHaveLength(0);
  });

  it("passes a Tauri asset URL to WaveRoll as a MIDI source", () => {
    const view = render(
      <MidiRollPreview
        name="multi-track"
        path="/Volumes/T7/session/multi.mid"
        toAssetUrl={(path) => `http://asset.localhost/${encodeURIComponent(path)}`}
      />,
    );
    const descriptor = JSON.parse(view.container.querySelector("wave-roll")?.getAttribute("files") ?? "[]");

    expect(descriptor).toEqual([
      {
        path: "http://asset.localhost/%2FVolumes%2FT7%2Fsession%2Fmulti.mid",
        name: "multi-track",
        type: "midi",
        color: "#39ff14",
      },
    ]);
  });

  it("shows empty and corrupt-file states", () => {
    const empty = render(<MidiRollPreview name="none" path={null} toAssetUrl={(path) => path} />);
    expect(screen.getByText("No MIDI file")).toBeTruthy();
    empty.unmount();

    const corrupt = render(<MidiRollPreview name="bad" path="/tmp/bad.mid" toAssetUrl={(path) => path} />);
    fireEvent.error(corrupt.container.querySelector("wave-roll") as HTMLElement);
    expect(screen.getByText("MIDI preview is unavailable for this file.")).toBeTruthy();
  });
});
