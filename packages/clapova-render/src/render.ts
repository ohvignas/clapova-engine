import { createClipIdResolver } from "./clipIds.js";
import {
  type EngineFormat,
  type EngineQuality,
  type EngineRenderConfigInput,
  type EngineRenderJob,
  type ProducerApi,
  loadProducer,
} from "./engine.js";
import { ClapovaRenderError, INVALID_INPUT, normalizeEngineError, RENDER_FAILED } from "./errors.js";

export interface RenderProgress {
  /** 0..100, never decreases within one render. */
  percent: number;
  /** Engine stage code (compile, extract_video, process_audio, capture, encode, assemble…). */
  stage?: string;
  done?: number;
  total?: number;
  message: string;
}

export interface RenderTimelineOptions {
  /** Directory holding the composed index.html and its assets. */
  projectDir: string;
  outputPath: string;
  fps?: number;
  quality?: EngineQuality;
  format?: EngineFormat;
  workers?: number;
  useGpu?: boolean;
  strictness?: "strict" | "best-effort";
  entryFile?: string;
  crf?: number;
  videoBitrate?: string;
  hdrMode?: "auto" | "force-hdr" | "force-sdr";
  variables?: Record<string, unknown>;
  resumeSegments?: boolean;
  /** Cancels the render; the engine stops its browsers and encoders. */
  signal?: AbortSignal;
  /** Hard wall-clock limit, enforced through the same abort path. */
  timeoutMs?: number;
  onProgress?: (progress: RenderProgress) => void;
  /** Timeline clip ids, used to map engine element ids back to clips in errors. */
  clipIds?: readonly string[];
  /** Inject a producer (tests, alternate builds). Defaults to @hyperframes/producer. */
  producer?: ProducerApi;
  logger?: unknown;
}

export interface RenderTimelineResult {
  jobId: string;
  outcome: "completed" | "completed_with_warnings";
  outputPath: string;
  durationSeconds?: number;
  totalFrames?: number;
  warnings: Array<{ code: string; message: string }>;
}

const SUPPORTED_FPS = new Set([24, 25, 30, 50, 60]);

function validate(options: RenderTimelineOptions): void {
  const problems: string[] = [];
  if (!options.projectDir) problems.push("projectDir is required");
  if (!options.outputPath) problems.push("outputPath is required");
  if (options.fps !== undefined && !SUPPORTED_FPS.has(options.fps)) {
    problems.push(`fps ${options.fps} is not one of ${[...SUPPORTED_FPS].join(", ")}`);
  }
  if (options.crf !== undefined && options.videoBitrate !== undefined) {
    problems.push("crf and videoBitrate are mutually exclusive");
  }
  if (options.timeoutMs !== undefined && !(options.timeoutMs > 0)) {
    problems.push("timeoutMs must be positive");
  }
  if (problems.length > 0) {
    throw new ClapovaRenderError({
      code: INVALID_INPUT,
      owner: "user",
      retryable: false,
      message: problems.join("; "),
      stage: "input",
    });
  }
}

/** Combine the caller's signal and the timeout into one engine signal. */
function engineSignal(signal?: AbortSignal, timeoutMs?: number): AbortSignal | undefined {
  const signals = [signal, timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined].filter(
    (s): s is AbortSignal => s !== undefined,
  );
  if (signals.length === 0) return undefined;
  if (signals.length === 1) return signals[0];
  return AbortSignal.any(signals);
}

export function createMonotonicProgress(
  onProgress?: (progress: RenderProgress) => void,
): (job: EngineRenderJob, message: string) => void {
  let last = 0;
  return (job, message) => {
    if (!onProgress) return;
    const raw = Number.isFinite(job.progress) ? job.progress : 0;
    last = Math.max(last, Math.min(100, Math.max(0, raw)));
    try {
      onProgress({
        percent: last,
        stage: job.stageProgress?.code,
        done: job.stageProgress?.done,
        total: job.stageProgress?.total,
        message,
      });
    } catch {
      // A failing progress consumer must never fail the render.
    }
  };
}

export async function renderTimeline(options: RenderTimelineOptions): Promise<RenderTimelineResult> {
  validate(options);
  const resolveClipId = createClipIdResolver(options.clipIds);
  const signal = engineSignal(options.signal, options.timeoutMs);
  if (signal?.aborted) {
    throw normalizeEngineError({ name: "RenderCancelledError", reason: "aborted" }, { stage: "input" });
  }

  const producer = options.producer ?? (await loadProducer());
  const config: EngineRenderConfigInput = {
    fps: options.fps ?? 30,
    quality: options.quality ?? "standard",
    ...(options.format ? { format: options.format } : {}),
    ...(options.workers !== undefined ? { workers: options.workers } : {}),
    ...(options.useGpu !== undefined ? { useGpu: options.useGpu } : {}),
    ...(options.strictness ? { strictness: options.strictness } : {}),
    ...(options.entryFile ? { entryFile: options.entryFile } : {}),
    ...(options.crf !== undefined ? { crf: options.crf } : {}),
    ...(options.videoBitrate ? { videoBitrate: options.videoBitrate } : {}),
    ...(options.hdrMode ? { hdrMode: options.hdrMode } : {}),
    ...(options.variables ? { variables: options.variables } : {}),
    ...(options.resumeSegments !== undefined ? { resumeSegments: options.resumeSegments } : {}),
    ...(options.logger ? { logger: options.logger } : {}),
  };

  const job = producer.createRenderJob(config);
  try {
    await producer.executeRenderJob(
      job,
      options.projectDir,
      options.outputPath,
      createMonotonicProgress(options.onProgress),
      signal,
    );
  } catch (error) {
    // Timeout surfaces as an abort; report it as retryable system failure, not a user cancel.
    if (signal?.aborted && !options.signal?.aborted && options.timeoutMs) {
      throw new ClapovaRenderError({
        code: "RENDER_TIMEOUT",
        owner: "system",
        retryable: true,
        message: `render exceeded ${options.timeoutMs} ms`,
        stage: job.stageProgress?.code ?? job.currentStage,
        cause: error,
      });
    }
    throw normalizeEngineError(error, {
      stage: job.failedStage ?? job.stageProgress?.code ?? job.currentStage,
      resolveClipId,
    });
  }

  if (job.outcome !== "completed" && job.outcome !== "completed_with_warnings") {
    throw new ClapovaRenderError({
      code: RENDER_FAILED,
      owner: "system",
      retryable: true,
      message: job.error ?? `render ended with outcome ${job.outcome ?? job.status}`,
      stage: job.failedStage ?? job.currentStage,
    });
  }

  return {
    jobId: job.id,
    outcome: job.outcome,
    outputPath: job.outputPath ?? options.outputPath,
    durationSeconds: job.duration,
    totalFrames: job.totalFrames,
    warnings: job.warnings.map((w) => ({ code: w.code, message: w.message })),
  };
}
