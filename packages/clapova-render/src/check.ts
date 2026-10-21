import { join } from "node:path";
import { createClipIdResolver } from "./clipIds.js";
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
}

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

  // Stable sort keeps the engine's order inside one severity.
  issues.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  const count = (s: ClapovaRenderIssue["severity"]) => issues.filter((i) => i.severity === s).length;
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
  };
}
