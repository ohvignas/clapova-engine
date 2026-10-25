import { type CliRunner, parseJsonEnvelope, runHyperframesCli } from "./cli.js";
import { ClapovaRenderError, INVALID_INPUT } from "./errors.js";

export const REVIEW_FAILED = "REVIEW_FAILED";

export interface ReviewSheetsOptions {
  projectDir: string;
  /** Sub-composition to review instead of the whole film (`snapshot --composition`). */
  composition?: string;
  /** Directory for the stills and sheets (default: the project's snapshot artifacts). */
  outputDir?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  cli?: CliRunner;
}

export interface ReviewStill {
  time: number;
  label: string;
  path: string;
}

export interface ReviewSeamSheet {
  time: number;
  from: string | null;
  to: string | null;
  times: number[];
  paths: string[];
  sheet?: string;
}

export interface ReviewSheetsResult {
  outputDir: string;
  /** JPEG sheets: one beat sheet per scene beat set, one per seam (transition), one phone-width sheet. */
  sheets: { beats: string[]; seams: string[]; phone: string[] };
  window: [number, number];
  scenes: Array<{ id: string; start: number; end: number }>;
  beats: ReviewStill[];
  seams: ReviewSeamSheet[];
}

/** `hyperframes snapshot --review` contact sheets; never `--describe` (network). */
export async function reviewSheets(options: ReviewSheetsOptions): Promise<ReviewSheetsResult> {
  if (!options.projectDir) {
    throw new ClapovaRenderError({
      code: INVALID_INPUT,
      owner: "system",
      retryable: false,
      message: "projectDir is required",
    });
  }
  const args = [
    "snapshot",
    "--review",
    "--json",
    ...(options.composition ? ["--composition", options.composition] : []),
    ...(options.outputDir ? ["--output", options.outputDir] : []),
    options.projectDir,
  ];
  const run = options.cli ?? runHyperframesCli;
  let stdout: string;
  let stderr: string;
  try {
    ({ stdout, stderr } = await run(args, {
      cwd: options.projectDir,
      signal: options.signal,
      timeoutMs: options.timeoutMs ?? 180_000,
    }));
  } catch (error) {
    throw new ClapovaRenderError({
      code: REVIEW_FAILED,
      owner: "system",
      retryable: !options.signal?.aborted,
      stage: "review",
      message: `Review sheets failed: ${error instanceof Error ? error.message : String(error)}`,
      cause: error,
    });
  }
  const envelope = parseJsonEnvelope(stdout);
  const review = envelope?.["review"] as Record<string, unknown> | undefined;
  if (!envelope || envelope["ok"] === false || !review) {
    const detail =
      (envelope?.["error"] as { message?: string } | undefined)?.message ??
      (stderr.trim().split("\n").slice(-3).join(" ") || "no review in the snapshot report");
    throw new ClapovaRenderError({
      code: REVIEW_FAILED,
      owner: "user",
      retryable: false,
      stage: "review",
      message: `Review sheets failed: ${detail}`,
    });
  }
  const sheets = (review["sheets"] ?? {}) as Partial<ReviewSheetsResult["sheets"]>;
  return {
    outputDir: String(envelope["outputDir"] ?? ""),
    sheets: { beats: sheets.beats ?? [], seams: sheets.seams ?? [], phone: sheets.phone ?? [] },
    window: (review["window"] as [number, number]) ?? [0, 0],
    scenes: (review["scenes"] as ReviewSheetsResult["scenes"]) ?? [],
    beats: (review["beats"] as ReviewStill[]) ?? [],
    seams: (review["seams"] as ReviewSeamSheet[]) ?? [],
  };
}
