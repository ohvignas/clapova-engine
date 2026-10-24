import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * Runs the HyperFrames CLI (`@hyperframes/cli`) as a child process and returns its stdout.
 *
 * `check` and `snapshot --review` live in the CLI only (craftAudit, contrast, layout,
 * review sheets); they are not part of a library export. Calling the built binary keeps
 * every upstream file untouched. The Clapova fork's CLI has telemetry and update checks off.
 */
export interface CliRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CliRunOptions {
  cwd?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type CliRunner = (args: readonly string[], options: CliRunOptions) => Promise<CliRunResult>;

const CLI_MODULE = "@hyperframes/cli/package.json";
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

export function resolveCliBin(): string {
  const fromEnv = process.env["CLAPOVA_HYPERFRAMES_BIN"];
  if (fromEnv) return fromEnv;
  const require = createRequire(import.meta.url);
  const bin = join(dirname(require.resolve(CLI_MODULE)), "bin", "hyperframes.mjs");
  if (!existsSync(bin)) throw new Error(`HyperFrames CLI not found at ${bin}`);
  return bin;
}

export const runHyperframesCli: CliRunner = (args, options) =>
  new Promise((resolve, reject) => {
    let bin: string;
    try {
      bin = resolveCliBin();
    } catch (error) {
      reject(error);
      return;
    }
    if (options.signal?.aborted) {
      reject(abortError(options.signal));
      return;
    }
    const child = spawn(process.execPath, [bin, ...args], {
      cwd: options.cwd,
      env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1", DO_NOT_TRACK: "1", NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let size = 0;
    const collect = (sink: Buffer[]) => (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) child.kill("SIGKILL");
      else sink.push(chunk);
    };
    child.stdout.on("data", collect(out));
    child.stderr.on("data", collect(err));
    let failure: Error | undefined;
    const onAbort = () => {
      failure = abortError(options.signal);
      child.kill("SIGKILL");
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const timer =
      options.timeoutMs !== undefined
        ? setTimeout(() => {
            failure = new Error(
              `hyperframes ${args[0] ?? ""} timed out after ${options.timeoutMs} ms`,
            );
            child.kill("SIGKILL");
          }, options.timeoutMs)
        : undefined;
    child.on("error", (error) => {
      failure ??= error;
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      if (failure) reject(failure);
      else
        resolve({
          exitCode: code ?? 1,
          stdout: Buffer.concat(out).toString("utf8"),
          stderr: Buffer.concat(err).toString("utf8"),
        });
    });
  });

function abortError(signal?: AbortSignal): Error {
  const error = new Error("hyperframes CLI call aborted", { cause: signal?.reason });
  error.name = "AbortError";
  return error;
}

/** The CLI prints one JSON envelope on stdout under --json; parse it or return null. */
export function parseJsonEnvelope(stdout: string): Record<string, unknown> | null {
  const start = stdout.indexOf("{");
  if (start < 0) return null;
  try {
    const value: unknown = JSON.parse(stdout.slice(start));
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
