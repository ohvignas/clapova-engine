/**
 * Coordinator: plan locally, publish the plan to storage, fan chunks out to
 * Fly Machines, resume from done markers after failures, then assemble.
 *
 * The producer primitives, storage and Machine launcher are injected, so the
 * whole flow is unit-testable without Chrome, ffmpeg, R2 or Fly.
 */

import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AssembleResult,
  DistributedRenderConfig,
  PlanResult,
} from "@hyperframes/producer/distributed";
import { sha256File } from "./hash.js";
import { decideMachineBudget, type FlyGuards, type QueueSnapshot } from "./guards.js";
import { FORMAT_EXT, type ChunkJob, type FlyFormat, type MachineLauncher } from "./jobs.js";
import { assignChunksToMachines, sizeSegments } from "./segments.js";
import { keys, type ChunkDoneMarker, type ObjectStore } from "./store.js";

export interface CoordinatorPrimitives {
  plan(projectDir: string, config: DistributedRenderConfig, planDir: string): Promise<PlanResult>;
  assemble(
    planDir: string,
    chunkPaths: readonly string[],
    audioPath: string | null,
    outputPath: string,
    options?: { cfr?: boolean },
  ): Promise<AssembleResult>;
  /** Locates the plan's mixed audio (producer: `resolvePlanAudioPath`). */
  resolveAudioPath(planDir: string): string | null;
}

export interface CoordinatorDeps {
  primitives: CoordinatorPrimitives;
  store: ObjectStore;
  launcher: MachineLauncher;
  guards: FlyGuards;
  /** Overridable for tests. */
  packPlan?: (planDir: string, tarball: string) => Promise<void>;
  hashFile?: (path: string) => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  tmpRoot?: string;
  log?: (event: string, data?: Record<string, unknown>) => void;
}

export interface FlyRenderInput {
  jobId: string;
  projectDir: string;
  config: Omit<DistributedRenderConfig, "format"> & { format: FlyFormat };
  queue: QueueSnapshot;
  outputPath: string;
  /** Attempts per chunk before giving up. Default 3. */
  maxAttempts?: number;
  /** Backoff base between rounds, ms. Default 2000, doubled each round. */
  backoffMs?: number;
  chunksPerMachine?: number;
  /** Delete plan and chunk objects once assembled. Default true. */
  cleanup?: boolean;
  cfr?: boolean;
  signal?: AbortSignal;
}

export type FlyRenderResult =
  | { status: "skipped"; reason: string }
  | {
      status: "done";
      outputPath: string;
      planHash: string;
      chunkCount: number;
      machinesUsed: number;
      rounds: number;
      resumedChunks: number;
      fileSize: number;
    };

export class FlyRenderError extends Error {
  constructor(
    message: string,
    readonly missingChunks: number[],
    readonly planHash: string,
  ) {
    super(message);
    this.name = "FlyRenderError";
  }
}

const noop = () => undefined;
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function renderOnFly(
  input: FlyRenderInput,
  deps: CoordinatorDeps,
): Promise<FlyRenderResult> {
  const log = deps.log ?? noop;
  const sleep = deps.sleep ?? defaultSleep;
  const budget = decideMachineBudget(input.queue, deps.guards);
  if (!budget.allowed) return { status: "skipped", reason: budget.reason };

  const maxAttempts = Math.max(1, input.maxAttempts ?? 3);
  const ext = FORMAT_EXT[input.config.format];
  if (ext === undefined) throw new Error(`[clapova-fly] unsupported format ${input.config.format}`);
  const work = mkdtempSync(join(deps.tmpRoot ?? tmpdir(), "clapova-fly-coord-"));
  const hash = deps.hashFile ?? sha256File;
  const pack =
    deps.packPlan ?? (async (d: string, t: string) => (await import("./archive.js")).tarDirectory(d, t));
  const store = deps.store;

  try {
    // 1. Plan. Segment count is capped by the machine budget.
    const planDir = join(work, "plan");
    const pre = input.config.maxParallelChunks;
    const config: DistributedRenderConfig = {
      ...input.config,
      maxParallelChunks: Math.min(
        pre ?? Number.MAX_SAFE_INTEGER,
        // Static cap (not the live budget): the plan hash must not change with the
        // number of Machines currently running, or a retry could not resume.
        deps.guards.maxMachines * Math.max(1, input.chunksPerMachine ?? 1),
      ),
    };
    const planned = await deps.primitives.plan(input.projectDir, config, planDir);
    const { planHash, chunkCount } = planned;
    log("planned", { planHash, chunkCount, totalFrames: planned.totalFrames });

    // 2. Publish the plan once per hash (a rerun of the same plan reuses it).
    if (!(await store.head(keys.plan(planHash)))) {
      const tarball = join(work, "plan.tar.gz");
      await pack(planDir, tarball);
      await store.putFile(keys.plan(planHash), tarball);
    }

    // 3. Fan out, with resume: only chunks without a valid marker are rendered.
    const readMarkers = async (): Promise<Map<number, ChunkDoneMarker>> => {
      const found = new Map<number, ChunkDoneMarker>();
      for (let i = 0; i < chunkCount; i++) {
        const raw = await store.getText(keys.chunkDone(planHash, i));
        if (!raw) continue;
        try {
          const marker = JSON.parse(raw) as ChunkDoneMarker;
          // The chunk object must still exist with the recorded size.
          const head = await store.head(keys.chunk(planHash, i, ext));
          if (head && head.size === marker.size) found.set(i, marker);
        } catch {
          // Corrupt marker: treat as not done.
        }
      }
      return found;
    };

    let done = await readMarkers();
    const resumedChunks = done.size;
    let rounds = 0;
    let machinesUsed = 0;
    for (let attempt = 1; attempt <= maxAttempts && done.size < chunkCount; attempt++) {
      if (input.signal?.aborted) throw new Error("[clapova-fly] aborted");
      if (attempt > 1) await sleep((input.backoffMs ?? 2000) * 2 ** (attempt - 2));
      const groups = assignChunksToMachines(chunkCount, budget.machines, new Set(done.keys()));
      rounds++;
      machinesUsed += groups.length;
      log("round", { attempt, groups });
      const results = await Promise.all(
        groups.map((chunkIndices) => {
          const job: ChunkJob = { planHash, chunkIndices, format: input.config.format };
          return deps.launcher.run(job, input.signal);
        }),
      );
      results.forEach((r, g) => {
        if (!r.ok) log("machine_failed", { group: groups[g], error: r.error });
      });
      // Markers, not exit codes, are the source of truth: a Machine can die
      // after uploading some chunks.
      done = await readMarkers();
    }

    if (input.signal?.aborted) throw new Error("[clapova-fly] aborted");
    if (done.size < chunkCount) {
      const missing = [...Array(chunkCount).keys()].filter((i) => !done.has(i));
      throw new FlyRenderError(
        `[clapova-fly] ${missing.length}/${chunkCount} chunks missing after ${maxAttempts} attempts (resumable)`,
        missing,
        planHash,
      );
    }

    // 4. Download and verify every chunk against its marker digest.
    const chunkPaths: string[] = [];
    const chunkDir = join(work, "chunks");
    mkdirSync(chunkDir, { recursive: true });
    for (let i = 0; i < chunkCount; i++) {
      const dest = join(chunkDir, `${String(i).padStart(5, "0")}${ext}`);
      await store.getFile(keys.chunk(planHash, i, ext), dest);
      const actual = await hash(dest);
      if (actual !== done.get(i)!.sha256) {
        // Drop the marker so the next run re-renders this chunk.
        await store.remove(keys.chunkDone(planHash, i));
        throw new FlyRenderError(
          `[clapova-fly] chunk ${i} digest mismatch, marker removed (resumable)`,
          [i],
          planHash,
        );
      }
      chunkPaths.push(dest);
    }

    // 5. Assemble and publish.
    const audioPath = deps.primitives.resolveAudioPath(planDir);
    const result = await deps.primitives.assemble(planDir, chunkPaths, audioPath, input.outputPath, {
      cfr: input.cfr === true,
    });

    if (input.cleanup !== false) {
      const removals = [keys.plan(planHash)];
      for (let i = 0; i < chunkCount; i++) {
        removals.push(keys.chunk(planHash, i, ext), keys.chunkDone(planHash, i));
      }
      await Promise.all(removals.map((k) => store.remove(k).catch(() => undefined)));
    }

    return {
      status: "done",
      outputPath: input.outputPath,
      planHash,
      chunkCount,
      machinesUsed,
      rounds,
      resumedChunks,
      fileSize: result.fileSize ?? statSync(input.outputPath).size,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export { sizeSegments };
