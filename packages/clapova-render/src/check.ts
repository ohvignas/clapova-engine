import { join } from "node:path";
import { createClipIdResolver } from "./clipIds.js";
import { type CliRunner, parseJsonEnvelope, runHyperframesCli } from "./cli.js";
import { type LintApi, loadLint } from "./engine.js";
import { type ClapovaRenderIssue, MAX_ISSUES, normalizeEngineError } from "./errors.js";

/**
 * Optional asset preflight. Clapova's own preflight (feat/preflight-assets,
 * roadmap 1.3) plugs in here: it should throw an engine-shaped error
 * (`code`, `owner`, `retryable`, optional `details`) or a ClapovaRenderError.
 */
export type PreflightHook = (projectDir: string, signal?: AbortSignal) => Promise<void>;

export interface CheckCompositionOptions {
  projectDir: string;
  entryFile?: string;
  clipIds?: readonly string[];
  /** Block on warnings too (strict mode), not only errors. */
  strict?: boolean;
  maxIssues?: number;
  preflight?: PreflightHook;
  signal?: AbortSignal;
  lint?: LintApi;
  /**
   * "full" (default): the CLI's complete gate, `hyperframes check --json` (lint, runtime,
   * layout, motion, contrast, craft audit: first_frame_empty, text_below_floor, line_unread,
   * dead_stretch, film_silent, ...). Needs Chrome. "lint": static lint only, no browser.
   */
  mode?: "full" | "lint";
  /** Timeout of the full check in ms (default 180 000). */
  timeoutMs?: number;
  /** Test seam: replaces the CLI child process. */
  cli?: CliRunner;
}

/** Counts per section of the full check (lint, runtime, layout, motion, contrast, craft, ...). */
export interface CheckSectionSummary {
  ok: boolean;
  errorCount: number;
  warningCount: number;
  infoCount: number;
}

export interface CheckCompositionResult {
  /** True when a render should not be started. */
  blocking: boolean;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  /** Sorted error, warning, info; capped at maxIssues. */
  issues: ClapovaRenderIssue[];
  truncated: boolean;
  mode: "full" | "lint";
  /** Full mode only: per-section counts as reported by the CLI. */
  sections?: Record<string, CheckSectionSummary>;
  /** Full mode only: true when lint errors stopped the check before the browser audits. */
  browserSkipped?: boolean;
}

export const CHECK_FAILED = "CHECK_FAILED";
const DEFAULT_CHECK_TIMEOUT_MS = 180_000;

const SEVERITY_RANK: Record<ClapovaRenderIssue["severity"], number> = {
  error: 0,
  warning: 1,
  info: 2,
};

export async function checkComposition(
  options: CheckCompositionOptions,
): Promise<CheckCompositionResult> {
  const resolveClipId = createClipIdResolver(options.clipIds);
  const issues: ClapovaRenderIssue[] = [];

  if (options.preflight) {
    try {
      await options.preflight(options.projectDir, options.signal);
    } catch (error) {
      const normalized = normalizeEngineError(error, { stage: "preflight", resolveClipId });
      if (normalized.issues.length > 0) issues.push(...normalized.issues);
      else
        issues.push({
          code: normalized.code,
          severity: "error",
          message: normalized.message,
        });
    }
  }

  const mode = options.mode ?? "full";
  let sections: Record<string, CheckSectionSummary> | undefined;
  let browserSkipped: boolean | undefined;
  if (mode === "full") {
    const full = await runFullCheck(options, resolveClipId);
    issues.push(...full.issues);
    sections = full.sections;
    browserSkipped = full.browserSkipped;
  } else {
    issues.push(...(await runLintOnly(options, resolveClipId)));
  }

  // Stable sort keeps the engine's order inside one severity.
  issues.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  const count = (s: ClapovaRenderIssue["severity"]) =>
    issues.filter((i) => i.severity === s).length;
  const errorCount = count("error");
  const warningCount = count("warning");
  const cap = Math.max(1, Math.min(options.maxIssues ?? MAX_ISSUES, MAX_ISSUES));
  return {
    blocking: errorCount > 0 || (options.strict === true && warningCount > 0),
    errorCount,
    warningCount,
    infoCount: count("info"),
    issues: issues.slice(0, cap),
    truncated: issues.length > cap,
    mode,
    ...(sections ? { sections } : {}),
    ...(browserSkipped !== undefined ? { browserSkipped } : {}),
  };
}

async function runLintOnly(
  options: CheckCompositionOptions,
  resolveClipId: ReturnType<typeof createClipIdResolver>,
): Promise<ClapovaRenderIssue[]> {
  const issues: ClapovaRenderIssue[] = [];
  const lint = options.lint ?? (await loadLint());
  const result = await lint.lintProject(
    options.projectDir,
    options.entryFile ? join(options.projectDir, options.entryFile) : undefined,
  );
  for (const { file, result: fileResult } of result.results) {
    for (const finding of fileResult.findings) {
      issues.push({
        code: finding.code,
        severity: finding.severity,
        message: finding.message,
        clipId: resolveClipId(finding.elementId),
        ...(finding.elementId ? { elementId: finding.elementId } : {}),
        ...(finding.fixHint ? { hint: finding.fixHint } : {}),
        file: finding.file ?? file,
        ...(finding.line !== undefined ? { line: finding.line } : {}),
      });
    }
  }
  return issues;
}

interface CliFinding {
  code?: unknown;
  severity?: unknown;
  message?: unknown;
  selector?: unknown;
  elementId?: unknown;
  sourceFile?: unknown;
  file?: unknown;
  line?: unknown;
  time?: unknown;
  fixHint?: unknown;
}

const SEVERITIES = new Set(["error", "warning", "info"]);

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function elementIdOf(finding: CliFinding): string | undefined {
  const explicit = str(finding.elementId);
  if (explicit) return explicit;
  const match = /^#([A-Za-z][\w-]*)$/.exec(str(finding.selector) ?? "");
  return match?.[1];
}

/** Maps one `hyperframes check --json` envelope to issues and per-section counts. */
export function issuesFromCheckReport(
  report: Record<string, unknown>,
  resolveClipId: ReturnType<typeof createClipIdResolver> = createClipIdResolver(),
  projectDir?: string,
): { issues: ClapovaRenderIssue[]; sections: Record<string, CheckSectionSummary> } {
  const issues: ClapovaRenderIssue[] = [];
  const sections: Record<string, CheckSectionSummary> = {};
  for (const [name, value] of Object.entries(report)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const section = value as Record<string, unknown>;
    if (!Array.isArray(section["findings"])) continue;
    sections[name] = {
      ok: section["ok"] !== false,
      errorCount: Number(section["errorCount"] ?? 0),
      warningCount: Number(section["warningCount"] ?? 0),
      infoCount: Number(section["infoCount"] ?? 0),
    };
    for (const raw of section["findings"] as CliFinding[]) {
      const code = str(raw.code) ?? `${name}_finding`;
      const severity = SEVERITIES.has(String(raw.severity))
        ? (raw.severity as ClapovaRenderIssue["severity"])
        : "warning";
      const elementId = elementIdOf(raw);
      let file = str(raw.sourceFile) ?? str(raw.file);
      if (file && projectDir && file.startsWith(`${projectDir}/`))
        file = file.slice(projectDir.length + 1);
      const time = typeof raw.time === "number" && name !== "lint" ? ` (t=${raw.time}s)` : "";
      issues.push({
        code,
        severity,
        message: `${str(raw.message) ?? code}${time}`,
        clipId: resolveClipId(elementId),
        ...(elementId ? { elementId } : {}),
        ...(str(raw.fixHint) ? { hint: str(raw.fixHint) } : {}),
        ...(file ? { file } : {}),
        ...(typeof raw.line === "number" ? { line: raw.line } : {}),
      });
    }
  }
  return { issues, sections };
}

async function runFullCheck(
  options: CheckCompositionOptions,
  resolveClipId: ReturnType<typeof createClipIdResolver>,
): Promise<{
  issues: ClapovaRenderIssue[];
  sections?: Record<string, CheckSectionSummary>;
  browserSkipped?: boolean;
}> {
  const run = options.cli ?? runHyperframesCli;
  const args = ["check", "--json", ...(options.strict ? ["--strict"] : []), options.projectDir];
  let stdout = "";
  let stderr = "";
  try {
    ({ stdout, stderr } = await run(args, {
      cwd: options.projectDir,
      signal: options.signal,
      timeoutMs: options.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS,
    }));
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return { issues: [checkFailed(error instanceof Error ? error.message : String(error))] };
  }
  const report = parseJsonEnvelope(stdout);
  if (!report)
    return {
      issues: [checkFailed(stderr.trim().split("\n").slice(-3).join(" ") || "no JSON report")],
    };
  const { issues, sections } = issuesFromCheckReport(report, resolveClipId, options.projectDir);
  // A runtime failure of the check itself surfaces as `error` in the envelope.
  const failure = report["error"];
  if (failure && typeof failure === "object" && issues.every((i) => i.severity !== "error")) {
    const f = failure as Record<string, unknown>;
    issues.push({
      code: str(f["code"]) ?? CHECK_FAILED,
      severity: "error",
      message: str(f["message"]) ?? "check failed",
    });
  }
  return { issues, sections, browserSkipped: report["browserSkipped"] === true };
}

function checkFailed(detail: string): ClapovaRenderIssue {
  return {
    code: CHECK_FAILED,
    severity: "error",
    message: `The full composition check could not run: ${detail}`.slice(0, 2000),
    hint: 'Retry, or run checkComposition with mode: "lint" for a static check only.',
  };
}
