/** Job contract between the coordinator and a chunk Machine. */

import type { MachineSpec, FlyMachinesClient } from "./machines.js";

export type FlyFormat = "mp4" | "webm" | "mov";

export const FORMAT_EXT: Record<FlyFormat, string> = { mp4: ".mp4", webm: ".webm", mov: ".mov" };

export interface ChunkJob {
  planHash: string;
  chunkIndices: number[];
  format: FlyFormat;
}

export const JOB_ENV = "CLAPOVA_FLY_JOB";

export function encodeJob(job: ChunkJob): string {
  return Buffer.from(JSON.stringify(job), "utf-8").toString("base64");
}

export function decodeJob(raw: string): ChunkJob {
  const job = JSON.parse(Buffer.from(raw, "base64").toString("utf-8")) as ChunkJob;
  if (
    typeof job.planHash !== "string" ||
    !Array.isArray(job.chunkIndices) ||
    !job.chunkIndices.every((i) => Number.isInteger(i) && i >= 0) ||
    !(job.format in FORMAT_EXT)
  ) {
    throw new Error("[clapova-fly] invalid chunk job");
  }
  return job;
}

export interface LaunchResult {
  ok: boolean;
  error?: string;
}

/** Runs one chunk job on a Machine and reports whether it exited cleanly. */
export interface MachineLauncher {
  run(job: ChunkJob, signal?: AbortSignal): Promise<LaunchResult>;
}

export interface FlyLauncherOptions {
  client: FlyMachinesClient;
  spec: Omit<MachineSpec, "env"> & { env?: Record<string, string> };
  timeoutMs: number;
}

export function createFlyLauncher(opts: FlyLauncherOptions): MachineLauncher {
  return {
    async run(job, signal) {
      let id: string | undefined;
      const onAbort = () => {
        if (id) void opts.client.destroy(id).catch(() => undefined);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        if (signal?.aborted) return { ok: false, error: "aborted" };
        const created = await opts.client.create({
          ...opts.spec,
          env: { ...(opts.spec.env ?? {}), [JOB_ENV]: encodeJob(job) },
        });
        id = created.id;
        if (signal?.aborted) onAbort();
        const exit = await opts.client.waitForExit(id, opts.timeoutMs);
        // auto_destroy can hide the exit event: success is decided by markers anyway.
        return exit.exitCode === 0 || exit.exitCode === null
          ? { ok: true }
          : { ok: false, error: `exit code ${exit.exitCode}` };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      } finally {
        signal?.removeEventListener("abort", onAbort);
        if (id) await opts.client.destroy(id).catch(() => undefined);
      }
    },
  };
}
