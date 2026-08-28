import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { isUriAssetPath } from "./paths";

type WaveformPreviewProps = {
  path: string | null;
  className?: string;
  playhead?: number;
  label?: string;
};

const waveformCache = new Map<string, number[]>();

export function summarizeWaveform(buffer: AudioBuffer, buckets = 240): number[] {
  if (!Number.isInteger(buckets) || buckets < 1) {
    throw new Error("Waveform bucket count must be a positive integer");
  }

  return Array.from({ length: buckets }, (_, bucket) => {
    const start = Math.floor((bucket / buckets) * buffer.length);
    const end = Math.max(start + 1, Math.floor(((bucket + 1) / buckets) * buffer.length));
    let peak = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const samples = buffer.getChannelData(channel);
      for (let index = start; index < Math.min(end, samples.length); index += 1) {
        peak = Math.max(peak, Math.abs(samples[index]));
      }
    }
    return peak;
  });
}

async function readWaveform(path: string, buckets = 240): Promise<number[]> {
  const cached = waveformCache.get(path);
  if (cached) return cached;

  const source = isUriAssetPath(path) ? path : convertFileSrc(path);
  const response = await fetch(source);
  if (!response.ok) throw new Error(`Waveform unavailable (${response.status})`);
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await response.arrayBuffer());
    const values = summarizeWaveform(buffer, buckets);
    waveformCache.set(path, values);
    return values;
  } finally {
    void context.close();
  }
}

export function WaveformPreview({ path, className = "", playhead = 0, label = "Audio waveform" }: WaveformPreviewProps) {
  const [values, setValues] = useState<number[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    setValues([]);
    setError(false);
    if (!path) return () => undefined;
    void readWaveform(path)
      .then((next) => {
        if (active) setValues(next);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [path]);

  const points = useMemo(() => {
    if (values.length === 0) return "";
    const width = 1000;
    const center = 50;
    return values
      .map((value, index) => `${(index / Math.max(1, values.length - 1)) * width},${center - value * 46}`)
      .join(" ");
  }, [values]);

  return (
    <div aria-label={label} className={`waveform-preview ${className}`} role="img">
      {values.length > 0 ? (
        <svg aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 1000 100">
          <polyline points={points} />
          <polyline points={points} transform="translate(0 100) scale(1 -1)" />
        </svg>
      ) : (
        <span>{error ? "Waveform unavailable" : path ? "Reading waveform…" : "No audio"}</span>
      )}
      <i style={{ left: `${Math.max(0, Math.min(1, playhead)) * 100}%` }} />
    </div>
  );
}
