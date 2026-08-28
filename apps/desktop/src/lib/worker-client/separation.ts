import { waitForWorker } from "./render";

const WORKER_URL = "http://127.0.0.1:8765";

export type SeparationWorkerOutput = {
  label: "bass" | "drums" | "guitar" | "piano" | "vocals" | "other";
  file_name: string;
  file_path: string;
  duration_seconds: number;
  peak: number;
};

export type SeparationWorkerResponse = {
  bundle_id: string;
  status: "ready" | "failed";
  model: string | null;
  raw_stem_path: string | null;
  bundle_path: string | null;
  outputs: SeparationWorkerOutput[];
  error_code: string | null;
  error: string | null;
};

export async function separateStem(request: {
  bundle_id: string;
  source_stem_path: string;
  bundle_path: string;
  model?: string;
  model_cache_path?: string | null;
}): Promise<SeparationWorkerResponse> {
  await waitForWorker();
  const response = await fetch(`${WORKER_URL}/separate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error(`Separator worker returned HTTP ${response.status}.`);
  return (await response.json()) as SeparationWorkerResponse;
}

export type SeparationMergeWorkerResponse = {
  merge_id: string;
  status: "ready" | "failed";
  file_name: string | null;
  file_path: string | null;
  duration_seconds: number | null;
  peak: number | null;
  error_code: string | null;
  error: string | null;
};

export async function mergeSeparationOutputs(request: {
  merge_id: string;
  output_paths: string[];
  input_gains_db: number[];
  destination_path: string;
}): Promise<SeparationMergeWorkerResponse> {
  await waitForWorker();
  const response = await fetch(`${WORKER_URL}/separation-merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error(`Separation merge worker returned HTTP ${response.status}.`);
  return (await response.json()) as SeparationMergeWorkerResponse;
}
