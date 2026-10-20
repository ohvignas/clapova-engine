import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProducerApi } from "./engine.js";
import { ClapovaRenderError, INVALID_INPUT, PREVIEW_EXTRACT_FAILED } from "./errors.js";
import { type RenderProgress, renderTimeline } from "./render.js";

export const MAX_PREVIEW_FRAMES = 12;

export interface ExtractFrameRequest {
  videoPath: string;
  timeSeconds: number;
  outputPath: string;
  maxHeight: number;
  signal?: AbortSignal;
}

export type FrameExtractor = (request: ExtractFrameRequest) => Promise<void>;

export interface PreviewFramesOptions {
  projectDir: string;
  /** Composition times in seconds. At most MAX_PREVIEW_FRAMES. */
  times: readonly number[];
  /** Where the PNG frames are written (created if missing). */
  outDir: string;
  fps?: number;
  /** Frame height cap; width keeps the aspect ratio. Defaults to 540. */
  maxHeight?: number;
  entryFile?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  onProgress?: (progress: RenderProgress) => void;
  clipIds?: readonly string[];
  producer?: ProducerApi;
  /** Inject the frame extractor (tests). Defaults to ffmpeg. */
  extractFrame?: FrameExtractor;
  ffmpegPath?: string;
}

export interface PreviewFrame {
  timeSeconds: number;
  path: string;
}

/**
 * Preview frames that match the final export exactly: the composition is
 * rendered once in draft quality (same engine, same media handling) and the
 * requested frames are pulled from that file.
 *
 * TODO(roadmap 3.5 / 5.5): switch to a warm browser pool and seek-capture
 * only the requested frames once `browserLeasePool` is wired.
 */
export async function previewFrames(options: PreviewFramesOptions): Promise<PreviewFrame[]> {
  const times = [...options.times];
  if (times.length === 0 || times.length > MAX_PREVIEW_FRAMES) {
    throw new ClapovaRenderError({
      code: INVALID_INPUT,
      owner: "user",
      retryable: false,
      message: `times must hold 1 to ${MAX_PREVIEW_FRAMES} values (got ${times.length})`,
      stage: "input",
    });
  }
  if (times.some((t) => !Number.isFinite(t) || t < 0)) {
    throw new ClapovaRenderError({
      code: INVALID_INPUT,
      owner: "user",
      retryable: false,
      message: "times must be finite, non-negative seconds",
      stage: "input",
    });
  }

  mkdirSync(options.outDir, { recursive: true });
  const workDir = mkdtempSync(join(tmpdir(), "clapova-preview-"));
  const videoPath = join(workDir, "preview.mp4");
  const fps = options.fps ?? 30;
  try {
    const result = await renderTimeline({
      projectDir: options.projectDir,
      outputPath: videoPath,
      fps,
      quality: "draft",
      format: "mp4",
      entryFile: options.entryFile,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      onProgress: options.onProgress,
      clipIds: options.clipIds,
      producer: options.producer,
    });
    const extract = options.extractFrame ?? createFfmpegExtractor(options.ffmpegPath);
    // Last decodable frame starts one frame before the end.
    const lastFrameTime =
      result.durationSeconds !== undefined
        ? Math.max(0, result.durationSeconds - 1 / fps)
        : Number.POSITIVE_INFINITY;
    const frames: PreviewFrame[] = [];
    for (const [index, requested] of times.entries()) {
      const timeSeconds = Math.min(requested, lastFrameTime);
      const path = join(options.outDir, `frame-${String(index).padStart(2, "0")}.png`);
      await extract({
        videoPath: result.outputPath,
        timeSeconds,
        outputPath: path,
        maxHeight: options.maxHeight ?? 540,
        signal: options.signal,
      });
      frames.push({ timeSeconds, path });
    }
    return frames;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

export function createFfmpegExtractor(ffmpegPath?: string): FrameExtractor {
  const bin = ffmpegPath ?? process.env.FFMPEG_PATH ?? "ffmpeg";
  return (request) =>
    new Promise<void>((resolve, reject) => {
      const args = [
        "-v",
        "error",
        "-y",
        "-ss",
        request.timeSeconds.toFixed(3),
        "-i",
        request.videoPath,
        "-frames:v",
        "1",
        "-vf",
        `scale=-2:'min(${request.maxHeight},ih)'`,
        request.outputPath,
      ];
      const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"], signal: request.signal });
      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-2_000);
      });
      child.on("error", (error) =>
        reject(
          new ClapovaRenderError({
            code: PREVIEW_EXTRACT_FAILED,
            owner: "system",
            retryable: true,
            message: `ffmpeg could not start: ${error.message}`,
            stage: "preview_extract",
            cause: error,
          }),
        ),
      );
      child.on("close", (code) => {
        if (code === 0) return resolve();
        reject(
          new ClapovaRenderError({
            code: PREVIEW_EXTRACT_FAILED,
            owner: "system",
            retryable: true,
            message: `ffmpeg exited with ${code} at t=${request.timeSeconds}s: ${stderr.trim()}`,
            stage: "preview_extract",
          }),
        );
      });
    });
}
