/**
 * Structural view of the engine surface this SDK consumes.
 *
 * These types mirror `@hyperframes/producer` and `@hyperframes/lint` exports
 * on purpose instead of importing them: the SDK stays buildable without the
 * monorepo install, tests inject fakes, and a contract test
 * (`engine.contract.test.ts`) checks the real exports still exist.
 */

export type EngineQuality = "draft" | "standard" | "high";
export type EngineFormat = "mp4" | "webm" | "mov" | "gif" | "png-sequence";

export interface EngineRenderSettings {
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
}

export interface EngineRenderConfigInput extends EngineRenderSettings {
  fps: number | { num: number; den: number };
  quality: EngineQuality;
  logger?: unknown;
}

export interface EngineStageProgress {
  code: string;
  done?: number;
  total?: number;
}

export interface EngineRenderJob {
  id: string;
  status: string;
  progress: number;
  currentStage: string;
  stageProgress?: EngineStageProgress;
  outcome?: "completed" | "completed_with_warnings" | "failed" | "cancelled";
  warnings: Array<{ code: string; message: string; stage?: string }>;
  error?: string;
  failedStage?: string;
  outputPath?: string;
  duration?: number;
  totalFrames?: number;
  framesRendered?: number;
}

export interface ProducerApi {
  createRenderJob(config: EngineRenderConfigInput): EngineRenderJob;
  executeRenderJob(
    job: EngineRenderJob,
    projectDir: string,
    outputPath: string,
    progressSink?: (job: EngineRenderJob, message: string) => void | Promise<void>,
    abortSignal?: AbortSignal,
  ): Promise<void>;
}

export interface EngineLintFinding {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  file?: string;
  line?: number;
  column?: number;
  selector?: string;
  elementId?: string;
  fixHint?: string;
}

export interface EngineProjectLintResult {
  results: Array<{ file: string; result: { findings: EngineLintFinding[] } }>;
  totalErrors: number;
  totalWarnings: number;
  totalInfos: number;
}

export interface LintApi {
  lintProject(projectDir: string, entryFile?: string): Promise<EngineProjectLintResult>;
}

// Specifiers held in variables: the SDK typechecks and builds without the
// engine installed, and the bundler leaves these imports to the runtime.
const PRODUCER_MODULE = "@hyperframes/producer";
const LINT_MODULE = "@hyperframes/lint";

let producerPromise: Promise<ProducerApi> | null = null;
let lintPromise: Promise<LintApi> | null = null;

/** Lazy-load the real producer. Kept dynamic so importing the SDK never boots Chrome tooling. */
export function loadProducer(): Promise<ProducerApi> {
  producerPromise ??= import(PRODUCER_MODULE).then((mod) => mod as unknown as ProducerApi);
  return producerPromise;
}

export function loadLint(): Promise<LintApi> {
  lintPromise ??= import(LINT_MODULE).then((mod) => mod as unknown as LintApi);
  return lintPromise;
}
