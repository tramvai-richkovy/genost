import "wave-roll";
import { createElement, useEffect, useMemo, useRef, useState } from "react";

type WaveRollElementApi = HTMLElement & { pause?: () => void };

export function MidiRollPreview({
  path,
  name,
  toAssetUrl,
}: {
  path: string | null;
  name: string;
  toAssetUrl: (path: string) => string;
}) {
  const elementRef = useRef<WaveRollElementApi | null>(null);
  const [error, setError] = useState<string | null>(null);
  const files = useMemo(
    () =>
      path
        ? JSON.stringify([{ path: toAssetUrl(path), name, type: "midi", color: "#39ff14" }])
        : "[]",
    [name, path, toAssetUrl],
  );

  useEffect(() => {
    setError(null);
    const element = elementRef.current;
    if (!element) return;
    const onError = () => setError("MIDI preview is unavailable for this file.");
    element.addEventListener("error", onError);
    return () => {
      element.removeEventListener("error", onError);
      element.pause?.();
    };
  }, [path]);

  if (!path) return <div className="midi-preview-empty">No MIDI file</div>;
  if (error) return <div className="midi-preview-empty">{error}</div>;

  return (
    <div className="midi-preview-shell">
      {createElement("wave-roll", {
        files,
        key: path,
        readonly: true,
        ref: (element: WaveRollElementApi | null) => {
          elementRef.current = element;
        },
        style: { width: "100%", height: "260px" },
      })}
    </div>
  );
}
