/**
 * Machine entrypoint. Reads the job from CLAPOVA_FLY_JOB, fetches the plan
 * from storage, renders its chunks one by one and writes a done marker after
 * each upload (marker last, so a crash never leaves a marker without data).
 */

import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChunkRenderer } from "@hyperframes/producer/distributed";
import { sha256File } from "./hash.js";
import { decodeJob, FORMAT_EXT, JOB_ENV, type ChunkJob } from "./jobs.js";
import { keys, type ChunkDoneMarker, type ObjectStore } from "./store.js";

export interface WorkerDeps {
  store: ObjectStore;
  renderChunk: ChunkRenderer;
  /** Defaults to the tar helper; injectable for tests. */
  unpackPlan?: (tarball: string, dest: string) => Promise<void>;
  hashFile?: (path: string) => Promise<string>;
  tmpRoot?: string;
}

async function readValidMarker(
  store: ObjectStore,
  planHash: string,
  index: number,
  ext: string,
): Promise<ChunkDoneMarker | null> {
  const raw = await store.getText(keys.chunkDone(planHash, index));
  if (!raw) return null;
  try {
    const marker = JSON.parse(raw) as ChunkDoneMarker;
    const head = await store.head(keys.chunk(planHash, index, ext));
    return head && head.size === marker.size ? marker : null;
  } catch {
    return null;
  }
}

export async function runChunkJob(job: ChunkJob, deps: WorkerDeps): Promise<ChunkDoneMarker[]> {
  const work = mkdtempSync(join(deps.tmpRoot ?? tmpdir(), "clapova-fly-chunk-"));
  const unpack =
    deps.unpackPlan ?? (async (t: string, d: string) => (await import("./archive.js")).untarDirectory(t, d));
  const hash = deps.hashFile ?? sha256File;
  const ext = FORMAT_EXT[job.format];
  try {
    const tarball = join(work, "plan.tar.gz");
    const planDir = join(work, "plan");
    await deps.store.getFile(keys.plan(job.planHash), tarball);
    await unpack(tarball, planDir);

    const markers: ChunkDoneMarker[] = [];
    for (const index of job.chunkIndices) {
      // Skip chunks a previous attempt already finished.
      // Only trust a marker whose chunk object still exists with the recorded size
      // (same rule as the coordinator); otherwise re-render.
      const prior = await readValidMarker(deps.store, job.planHash, index, ext);
      if (prior) {
        markers.push(prior);
        continue;
      }
      const out = join(work, `chunk-${index}${ext}`);
      const result = await deps.renderChunk(planDir, index, out);
      const sha256 = result.sha256 || (await hash(out));
      await deps.store.putFile(keys.chunk(job.planHash, index, ext), out);
      const marker: ChunkDoneMarker = {
        index,
        sha256,
        size: statSync(out).size,
        framesEncoded: result.framesEncoded,
      };
      await deps.store.putText(keys.chunkDone(job.planHash, index), JSON.stringify(marker));
      markers.push(marker);
      rmSync(out, { force: true });
    }
    return markers;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Process entrypoint: `node dist/worker.js` inside the Machine image. */
export async function main(env: Record<string, string | undefined> = process.env): Promise<void> {
  const raw = env[JOB_ENV];
  if (!raw) throw new Error(`[clapova-fly] ${JOB_ENV} is not set`);
  const [{ createS3Store, readS3OptionsFromEnv }, producer] = await Promise.all([
    import("./store.js"),
    import("@hyperframes/producer/distributed"),
  ]);
  const store = await createS3Store(readS3OptionsFromEnv(env));
  await runChunkJob(decodeJob(raw), { store, renderChunk: producer.renderChunk });
}
