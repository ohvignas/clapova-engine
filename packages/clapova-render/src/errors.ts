import type { ClipIdResolver } from "./clipIds.js";

export type ErrorOwner = "user" | "system";

/**
 * One actionable problem, shaped for Convex and the agent:
 * which clip, which authored src, what was expected and what was detected.
 */
export interface ClapovaRenderIssue {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  clipId?: string;
  elementId?: string;
  src?: string;
  expected?: string;
  detected?: string;
  hint?: string;
  file?: string;
  line?: number;
}

export interface ClapovaRenderErrorJSON {
  name: "ClapovaRenderError";
  code: string;
  owner: ErrorOwner;
  retryable: boolean;
  stage?: string;
  message: string;
  issues: ClapovaRenderIssue[];
}

export const RENDER_CANCELLED = "RENDER_CANCELLED";
export const RENDER_FAILED = "RENDER_FAILED";
export const RENDER_QUALITY_BLOCKED = "RENDER_QUALITY_BLOCKED";
export const COMPOSITION_BLOCKED = "COMPOSITION_BLOCKED";
export const PREVIEW_EXTRACT_FAILED = "PREVIEW_EXTRACT_FAILED";
export const INVALID_INPUT = "INVALID_INPUT";

const ASSET_MEDIA_TYPE_MISMATCH = "ASSET_MEDIA_TYPE_MISMATCH";
const NOT_MEDIA_PAYLOAD = "NOT_MEDIA_PAYLOAD";

/** Hard caps so a pathological composition never floods Convex or the agent context. */
export const MAX_ISSUES = 20;
const MAX_MESSAGE_LENGTH = 2_000;
const MAX_FIELD_LENGTH = 300;

function bound(value: string, max = MAX_FIELD_LENGTH): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export class ClapovaRenderError extends Error {
  readonly code: string;
  readonly owner: ErrorOwner;
  readonly retryable: boolean;
  readonly stage?: string;
  readonly issues: readonly ClapovaRenderIssue[];

  constructor(init: {
    code: string;
    owner: ErrorOwner;
    retryable: boolean;
    message: string;
    stage?: string;
    issues?: readonly ClapovaRenderIssue[];
    cause?: unknown;
  }) {
    super(bound(init.message, MAX_MESSAGE_LENGTH), { cause: init.cause });
    this.name = "ClapovaRenderError";
    this.code = init.code;
    this.owner = init.owner;
    this.retryable = init.retryable;
    this.stage = init.stage;
    this.issues = (init.issues ?? []).slice(0, MAX_ISSUES);
  }

  toJSON(): ClapovaRenderErrorJSON {
    return {
      name: "ClapovaRenderError",
      code: this.code,
      owner: this.owner,
      retryable: this.retryable,
      ...(this.stage ? { stage: this.stage } : {}),
      message: this.message,
      issues: [...this.issues],
    };
  }
}

export function isClapovaRenderError(value: unknown): value is ClapovaRenderError {
  return value instanceof ClapovaRenderError;
}

type Loose = Record<string, unknown>;

function asRecord(value: unknown): Loose | null {
  return value !== null && typeof value === "object" ? (value as Loose) : null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? bound(value) : undefined;
}

function hintFor(expected?: string, detected?: string): string | undefined {
  if (!expected || !detected) return undefined;
  if (detected === "unknown") return "the file has no usable audio or visual stream; replace it";
  const tag = detected === "image" ? "img" : detected;
  return `use a <${tag}> clip for this file, or point the clip at a ${expected} file`;
}

/** Issues for `AssetMediaTypeMismatchError` (feat/erreur-media-detaillee). */
function mediaMismatchIssues(err: Loose, resolveClipId: ClipIdResolver): ClapovaRenderIssue[] {
  // `details` is non-enumerable on the producer error; read it directly.
  const details = Array.isArray(err.details) ? (err.details as unknown[]) : [];
  if (details.length > 0) {
    return details.flatMap((raw) => {
      const d = asRecord(raw);
      if (!d) return [];
      const elementId = str(d.elementId);
      const expected = str(d.expected);
      const detected = str(d.detected);
      return [
        {
          code: ASSET_MEDIA_TYPE_MISMATCH,
          severity: "error" as const,
          message: `expected ${expected ?? "?"}, detected ${detected ?? "?"}`,
          clipId: resolveClipId(elementId),
          elementId,
          src: str(d.src),
          expected,
          detected,
          hint: hintFor(expected, detected),
        },
      ];
    });
  }
  // Upstream error without details: only hashed fingerprints are available.
  const mismatches = Array.isArray(err.mismatches) ? (err.mismatches as unknown[]) : [];
  return mismatches.flatMap((raw) => {
    const m = asRecord(raw);
    if (!m) return [];
    const expected = str(m.expected);
    const detected = str(m.detected);
    return [
      {
        code: ASSET_MEDIA_TYPE_MISMATCH,
        severity: "error" as const,
        message: `expected ${expected ?? "?"}, detected ${detected ?? "?"} (element fingerprint ${str(m.elementFingerprint) ?? "?"})`,
        expected,
        detected,
        hint: hintFor(expected, detected),
      },
    ];
  });
}

/**
 * Turn anything thrown by the engine into a ClapovaRenderError.
 * Recognizes producer errors by shape (code / name), not by class identity,
 * so it keeps working across duplicated module instances.
 */
export function normalizeEngineError(
  error: unknown,
  options: { stage?: string; resolveClipId?: ClipIdResolver } = {},
): ClapovaRenderError {
  if (error instanceof ClapovaRenderError) return error;
  const resolveClipId = options.resolveClipId ?? (() => undefined);
  const stage = options.stage;
  const err = asRecord(error) ?? {};
  const name = typeof err.name === "string" ? err.name : "";
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "render failed";
  const code = typeof err.code === "string" ? err.code : undefined;

  if (name === "RenderCancelledError" || name === "AbortError") {
    return new ClapovaRenderError({
      code: RENDER_CANCELLED,
      owner: "system",
      retryable: false,
      message: `render cancelled (${typeof err.reason === "string" ? err.reason : "aborted"})`,
      stage,
      cause: error,
    });
  }

  if (code === ASSET_MEDIA_TYPE_MISMATCH) {
    const describe = typeof err.describeForAuthor === "function" ? err.describeForAuthor : null;
    return new ClapovaRenderError({
      code: ASSET_MEDIA_TYPE_MISMATCH,
      owner: "user",
      retryable: false,
      message: describe ? String(describe.call(error)) : message,
      stage,
      issues: mediaMismatchIssues(err, resolveClipId),
      cause: error,
    });
  }

  if (code === NOT_MEDIA_PAYLOAD) {
    const fingerprints = Array.isArray(err.elementFingerprints)
      ? (err.elementFingerprints as unknown[]).flatMap((f) => (typeof f === "string" ? [f] : []))
      : [];
    return new ClapovaRenderError({
      code: NOT_MEDIA_PAYLOAD,
      owner: "user",
      retryable: false,
      message,
      stage,
      issues: fingerprints.map((fp) => ({
        code: NOT_MEDIA_PAYLOAD,
        severity: "error" as const,
        message: `media source is a text document, not a media file (element fingerprint ${fp})`,
        expected: "media",
        detected: "document",
        hint: "re-upload the media file; the stored URL answers with an HTML/JSON page",
      })),
      cause: error,
    });
  }

  if (name === "RenderQualityError" && Array.isArray(err.warnings)) {
    const warnings = (err.warnings as unknown[]).flatMap((w) => {
      const r = asRecord(w);
      return r ? [r] : [];
    });
    return new ClapovaRenderError({
      code: RENDER_QUALITY_BLOCKED,
      owner: "user",
      retryable: false,
      message,
      stage,
      issues: warnings.map((w) => ({
        code: str(w.code) ?? "render_warning",
        severity: "error" as const,
        message: str(w.message) ?? "correctness warning",
      })),
      cause: error,
    });
  }

  // Any other typed engine error: keep its own code/owner/retryable.
  if (code && (err.owner === "user" || err.owner === "system")) {
    return new ClapovaRenderError({
      code,
      owner: err.owner,
      retryable: err.retryable === true,
      message,
      stage,
      cause: error,
    });
  }

  return new ClapovaRenderError({
    code: RENDER_FAILED,
    owner: "system",
    retryable: true,
    message,
    stage,
    cause: error,
  });
}
