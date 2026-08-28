export type AudioContentCategory = "generic" | "bass_drone" | "rhythm" | "melody";

export type WorkerRenderRequest = {
  job_id: string;
  kind: "text" | "conditioned" | "continuation" | "fixture";
  prompt: string;
  output_path: string;
  duration_seconds: number;
  model_name: string;
  reference_audio_path: string | null;
  seed: number;
  model_cache_path: string | null;
  backend: "auto" | "audiocraft" | "mlx";
  audio_validation_profile: "music";
  audio_content_category: AudioContentCategory;
};

export type WorkerRenderResponse = {
  job_id: string;
  status: "ready" | "failed";
  output_path: string | null;
  sample_rate: number | null;
  backend: string | null;
  device: string | null;
  model: string | null;
  generation_seconds: number | null;
  validation_metrics: Record<string, number> | null;
  error_code: string | null;
  error: string | null;
};

export type WorkerRenderSubmission = {
  job_id: string;
  status: "queued" | "rendering" | "ready" | "failed" | "canceled";
  message: string;
};

export type WorkerJobStatus = {
  job_id: string;
  status: "queued" | "rendering" | "ready" | "failed" | "canceled";
  message: string;
  details: WorkerRenderResponse | null;
  progress: number;
  cancel_requested: boolean;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

const WORKER_URL = "http://127.0.0.1:8765";
const WORKER_START_ATTEMPTS = 120;
const WORKER_START_DELAY_MS = 250;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function workerIsReady(): Promise<boolean> {
  try {
    const response = await fetch(`${WORKER_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

export type WorkerHealth = {
  ok: boolean;
  python: string;
  torch_available: boolean;
  mps_available: boolean;
  audiocraft_available: boolean;
  torchaudio_available: boolean;
  ffmpeg_available: boolean;
  mlx_available: boolean;
  generation_backend: string;
  device: string;
  cache_paths: string[];
  medium_model_available: boolean;
  melody_model_available: boolean;
  preflight: {
    ok: boolean;
    backend: string;
    device: string;
    cache_paths: string[];
    models: Record<
      string,
      {
        name: string;
        available: boolean;
        cache_paths: string[];
        error: string | null;
        download_hint: string;
      }
    >;
    cache_writable: boolean;
    capabilities: Record<
      string,
      {
        available: boolean;
        detail: string;
        error: string | null;
        setup_hint: string | null;
      }
    >;
    errors: string[];
  };
};

export async function getWorkerHealth(): Promise<WorkerHealth> {
  const response = await fetch(`${WORKER_URL}/health`);
  if (!response.ok) throw new Error(`Backend validation returned HTTP ${response.status}.`);
  return (await response.json()) as WorkerHealth;
}

export async function runWorkerPreflight(request: {
  model_cache_path?: string | null;
  hf_home?: string | null;
  backend?: "auto" | "audiocraft" | "mlx";
  device?: string | null;
}): Promise<WorkerHealth["preflight"]> {
  await waitForWorker();
  const response = await fetch(`${WORKER_URL}/preflight`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error(`Model preflight returned HTTP ${response.status}.`);
  return (await response.json()) as WorkerHealth["preflight"];
}

export async function waitForWorker(): Promise<void> {
  for (let attempt = 0; attempt < WORKER_START_ATTEMPTS; attempt += 1) {
    if (await workerIsReady()) {
      return;
    }
    await delay(WORKER_START_DELAY_MS);
  }

  throw new Error(
    "The local MusicGen worker did not start on 127.0.0.1:8765. Check that the repository .venv is installed, then restart GENOST.",
  );
}

export class WorkerRenderCanceledError extends Error {
  constructor(message = "MusicGen render canceled.") {
    super(message);
    this.name = "WorkerRenderCanceledError";
  }
}

export class WorkerRenderFailedError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WorkerRenderFailedError";
  }
}

export async function submitRender(request: WorkerRenderRequest): Promise<WorkerRenderSubmission> {
  await waitForWorker();
  const response = await fetch(`${WORKER_URL}/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`MusicGen worker returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }

  return (await response.json()) as WorkerRenderSubmission;
}

export async function getWorkerJob(jobId: string): Promise<WorkerJobStatus | null> {
  await waitForWorker();
  const response = await fetch(`${WORKER_URL}/jobs/${encodeURIComponent(jobId)}`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`MusicGen worker job lookup returned HTTP ${response.status}.`);
  }
  return (await response.json()) as WorkerJobStatus;
}

export async function renderStem(
  request: WorkerRenderRequest,
  onJobUpdate?: (job: WorkerJobStatus) => void,
): Promise<WorkerRenderResponse> {
  await submitRender(request);

  while (true) {
    const job = await getWorkerJob(request.job_id);
    if (!job) {
      throw new Error(`MusicGen worker lost render job ${request.job_id}.`);
    }
    onJobUpdate?.(job);

    if (job.status === "ready") {
      if (!job.details?.output_path) {
        throw new Error("MusicGen worker reported success without output metadata.");
      }
      return job.details;
    }
    if (job.status === "failed") {
      throw new WorkerRenderFailedError(
        job.details?.error_code || "generation_failed",
        job.details?.error || job.message || "MusicGen worker failed without an error message.",
      );
    }
    if (job.status === "canceled") {
      throw new WorkerRenderCanceledError(job.message);
    }

    await delay(750);
  }
}

export async function cancelWorkerJob(jobId: string): Promise<WorkerJobStatus | null> {
  await waitForWorker();
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await fetch(`${WORKER_URL}/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
    if (response.ok) {
      return (await response.json()) as WorkerJobStatus;
    }
    if (response.status !== 404) {
      throw new Error(`MusicGen worker cancellation returned HTTP ${response.status}.`);
    }
    if (attempt < 11) {
      await delay(250);
    }
  }
  return null;
}

export type TextToMidiResponse = {
  status: "ready" | "failed";
  outputs: Array<{ file_name: string; file_path: string; seed: number | null }>;
  model: string | null;
  model_version: string | null;
  generation_seconds: number | null;
  error_code: string | null;
  error: string | null;
};

export async function generateMidiFromText(request: {
  prompt: string;
  output_directory: string;
  quantity: number;
  model_repo_path?: string | null;
  python_executable?: string | null;
}): Promise<TextToMidiResponse> {
  await waitForWorker();
  const response = await fetch(`${WORKER_URL}/midi/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error(`MIDI worker returned HTTP ${response.status}.`);
  return (await response.json()) as TextToMidiResponse;
}

export type MidiGuideWavResponse = {
  status: "ready" | "failed";
  file_name: string | null;
  file_path: string | null;
  sample_rate: number | null;
  duration_seconds: number | null;
  error_code: string | null;
  error: string | null;
};

export async function renderMidiGuideWav(request: {
  midi_path: string;
  output_wav_path: string;
  sample_rate?: number;
}): Promise<MidiGuideWavResponse> {
  await waitForWorker();
  const response = await fetch(`${WORKER_URL}/midi/guide-wav`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error(`MIDI guide worker returned HTTP ${response.status}.`);
  return (await response.json()) as MidiGuideWavResponse;
}

export type AudioToMidiResponse = {
  status: "ready" | "failed";
  file_name: string | null;
  file_path: string | null;
  mode: "melodic" | "drum";
  error_code: string | null;
  error: string | null;
};

export async function convertAudioToMidi(request: {
  source_audio_path: string;
  output_midi_path: string;
  mode: "melodic" | "drum";
}): Promise<AudioToMidiResponse> {
  await waitForWorker();
  const response = await fetch(`${WORKER_URL}/midi/from-audio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error(`Audio-to-MIDI worker returned HTTP ${response.status}.`);
  return (await response.json()) as AudioToMidiResponse;
}
