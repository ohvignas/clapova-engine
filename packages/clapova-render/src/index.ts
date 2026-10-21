/**
 * @clapova/render: in-process render API for the Clapova worker.
 *
 * Replaces spawning the HyperFrames CLI: progress comes from the producer's
 * typed stage progress, cancellation goes through AbortSignal, and every
 * failure is a ClapovaRenderError with code / owner / retryable / issues.
 */
export {
  renderTimeline,
  createMonotonicProgress,
  type RenderTimelineOptions,
  type RenderTimelineResult,
  type RenderProgress,
} from "./render.js";
export {
  previewFrames,
  createFfmpegExtractor,
  MAX_PREVIEW_FRAMES,
  type PreviewFramesOptions,
  type PreviewFrame,
  type FrameExtractor,
  type ExtractFrameRequest,
} from "./preview.js";
export {
  checkComposition,
  type CheckCompositionOptions,
  type CheckCompositionResult,
  type PreflightHook,
} from "./check.js";
export {
  ClapovaRenderError,
  isClapovaRenderError,
  normalizeEngineError,
  MAX_ISSUES,
  RENDER_CANCELLED,
  RENDER_FAILED,
  RENDER_QUALITY_BLOCKED,
  COMPOSITION_BLOCKED,
  PREVIEW_EXTRACT_FAILED,
  INVALID_INPUT,
  type ClapovaRenderIssue,
  type ClapovaRenderErrorJSON,
  type ErrorOwner,
} from "./errors.js";
export { clipDomId, createClipIdResolver, type ClipIdResolver } from "./clipIds.js";
export type {
  ProducerApi,
  LintApi,
  EngineRenderJob,
  EngineQuality,
  EngineFormat,
  EngineLintFinding,
} from "./engine.js";
