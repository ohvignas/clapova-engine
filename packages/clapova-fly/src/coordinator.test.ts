import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FlyRenderError, renderOnFly, type CoordinatorPrimitives } from "./coordinator.js";
import { DEFAULT_GUARDS } from "./guards.js";
import type { ChunkJob, MachineLauncher } from "./jobs.js";
import { createLocalStore, keys, type ObjectStore } from "./store.js";
import { runChunkJob } from "./worker.js";

let root: string;
let store: ObjectStore;
const queue = { backlog: 4, oldestWaitMs: 300_000, runningMachines: 0 };
const noSleep = async () => undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "clapova-fly-test-"));
  store = createLocalStore(join(root, "bucket"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function primitives(chunkCount: number): CoordinatorPrimitives & { assembled: string[][] } {
  const assembled: string[][] = [];
  return {
    assembled,
    async plan(_p, _c, planDir) {
      mkdirSync(planDir, { recursive: true });
      writeFileSync(join(planDir, "plan.json"), "{}");
      return { planDir, planHash: "hash1", chunkCount, totalFrames: chunkCount * 10 } as any;
    },
    async assemble(_planDir, chunkPaths, _audio, out) {
      assembled.push([...chunkPaths]);
      writeFileSync(out, chunkPaths.map((p) => readFileSync(p, "utf-8")).join("|"));
      return { framesEncoded: chunkPaths.length * 10, fileSize: 1 } as any;
    },
    resolveAudioPath: () => null,
  };
}

/** Launcher that runs the real worker loop in-process with injectable failures. */
function localLauncher(opts: {
  failOnce?: Set<number>;
  crashAfterUpload?: Set<number>;
  calls?: ChunkJob[];
}): MachineLauncher {
  const failed = new Set<number>();
  return {
    async run(job) {
      opts.calls?.push(job);
      try {
        await runChunkJob(job, {
          store,
          tmpRoot: root,
          unpackPlan: async (_t, dest) => {
            mkdirSync(dest, { recursive: true });
          },
          renderChunk: async (_planDir, index, out) => {
            if (opts.failOnce?.has(index) && !failed.has(index)) {
              failed.add(index);
              throw new Error(`boom ${index}`);
            }
            writeFileSync(out, `c${index}`);
            return { sha256: "", framesEncoded: 10, outputPath: out } as any;
          },
          hashFile: async (p) => (await import("./hash.js")).sha256File(p),
        });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  };
}

const base = (out: string) => ({
  jobId: "job1",
  projectDir: join(root, "project"),
  config: { fps: 30, width: 1920, height: 1080, format: "mp4" as const },
  queue,
  outputPath: out,
  backoffMs: 1,
});

describe("renderOnFly", () => {
  it("skips when SRV2 is not saturated, without planning", async () => {
    let planned = false;
    const prim = primitives(4);
    const plan = prim.plan;
    prim.plan = async (...a) => ((planned = true), plan(...a));
    const res = await renderOnFly(
      { ...base(join(root, "o.mp4")), queue: { backlog: 1, oldestWaitMs: 0, runningMachines: 0 } },
      {
        primitives: prim,
        store,
        launcher: localLauncher({}),
        guards: DEFAULT_GUARDS,
        packPlan: async (_d, t) => writeFileSync(t, "tar"),
      },
    );
    expect(res.status).toBe("skipped");
    expect(planned).toBe(false);
  });

  it("renders in parallel, assembles chunks in index order, cleans up", async () => {
    const calls: ChunkJob[] = [];
    const prim = primitives(5);
    const out = join(root, "o.mp4");
    const res = await renderOnFly(base(out), {
      primitives: prim,
      store,
      launcher: localLauncher({ calls }),
      guards: DEFAULT_GUARDS,
      packPlan: async (_d, t) => writeFileSync(t, "tar"),
      sleep: noSleep,
    });
    expect(res).toMatchObject({
      status: "done",
      chunkCount: 5,
      machinesUsed: 3,
      rounds: 1,
      resumedChunks: 0,
    });
    expect(calls).toHaveLength(3);
    expect(calls.flatMap((c) => c.chunkIndices).sort()).toEqual([0, 1, 2, 3, 4]);
    expect(readFileSync(out, "utf-8")).toBe("c0|c1|c2|c3|c4");
    expect(prim.assembled[0]!.map((p) => p.split("/").pop())).toEqual(
      ["00000", "00001", "00002", "00003", "00004"].map((n) => `${n}.mp4`),
    );
    expect(await store.head(keys.plan("hash1"))).toBeNull();
    expect(await store.head(keys.chunk("hash1", 0, ".mp4"))).toBeNull();
  });

  it("never starts more machines than the guards allow", async () => {
    const calls: ChunkJob[] = [];
    await renderOnFly(
      { ...base(join(root, "o.mp4")), queue: { ...queue, runningMachines: 2 } },
      {
        primitives: primitives(6),
        store,
        launcher: localLauncher({ calls }),
        guards: DEFAULT_GUARDS,
        packPlan: async (_d, t) => writeFileSync(t, "tar"),
        sleep: noSleep,
      },
    );
    expect(calls).toHaveLength(1);
  });

  it("retries only the failed chunks in a second round", async () => {
    const calls: ChunkJob[] = [];
    const res = await renderOnFly(base(join(root, "o.mp4")), {
      primitives: primitives(4),
      store,
      launcher: localLauncher({ failOnce: new Set([2]), calls }),
      guards: DEFAULT_GUARDS,
      packPlan: async (_d, t) => writeFileSync(t, "tar"),
      sleep: noSleep,
    });
    expect(res).toMatchObject({ status: "done", rounds: 2 });
    const round2 = calls.slice(-1)[0]!;
    expect(round2.chunkIndices).toEqual([2]);
  });

  it("fails with a resumable error, then a rerun resumes from the markers", async () => {
    const out = join(root, "o.mp4");
    const deps = (launcher: MachineLauncher) => ({
      primitives: primitives(4),
      store,
      launcher,
      guards: DEFAULT_GUARDS,
      packPlan: async (_d: string, t: string) => writeFileSync(t, "tar"),
      sleep: noSleep,
      cleanup: undefined,
    });
    const alwaysFailChunk3: MachineLauncher = {
      async run(job) {
        const inner = localLauncher({});
        const ok = job.chunkIndices.filter((i) => i !== 3);
        if (ok.length) await inner.run({ ...job, chunkIndices: ok });
        return { ok: false, error: "oom" };
      },
    };
    const err = await renderOnFly({ ...base(out), maxAttempts: 2 }, deps(alwaysFailChunk3)).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(FlyRenderError);
    expect(err.missingChunks).toEqual([3]);
    expect(existsSync(out)).toBe(false);

    const calls: ChunkJob[] = [];
    const res = await renderOnFly(base(out), deps(localLauncher({ calls })));
    expect(res).toMatchObject({ status: "done", resumedChunks: 3 });
    expect(calls.flatMap((c) => c.chunkIndices)).toEqual([3]);
    expect(readFileSync(out, "utf-8")).toBe("c0|c1|c2|c3");
  });

  it("detects a corrupted chunk, drops its marker and reports it", async () => {
    const out = join(root, "o.mp4");
    const launcher = localLauncher({});
    const corrupting: MachineLauncher = {
      async run(job) {
        const r = await launcher.run(job);
        // Same size, different bytes: only the digest can catch it.
        await store.putText(keys.chunk("hash1", 1, ".mp4"), "XX");
        return r;
      },
    };
    const err = await renderOnFly(base(out), {
      primitives: primitives(3),
      store,
      launcher: corrupting,
      guards: DEFAULT_GUARDS,
      packPlan: async (_d, t) => writeFileSync(t, "tar"),
      sleep: noSleep,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(FlyRenderError);
    expect(err.missingChunks).toEqual([1]);
    expect(await store.getText(keys.chunkDone("hash1", 1))).toBeNull();
  });
});

describe("plan stability", () => {
  it("passes the same maxParallelChunks whatever the running machines count", async () => {
    const seen: (number | undefined)[] = [];
    for (const runningMachines of [0, 1]) {
      const p = primitives(2);
      const orig = p.plan;
      p.plan = async (a, c, d) => {
        seen.push(c.maxParallelChunks);
        return orig(a, c, d);
      };
      try {
        await renderOnFly(
          {
            projectDir: "p",
            config: { fps: 30, format: "mp4" } as any,
            queue: { ...queue, runningMachines },
            backoffMs: 0,
            maxAttempts: 1,
          } as any,
          {
            store,
            guards: DEFAULT_GUARDS,
            primitives: p,
            launcher: { run: async () => ({ ok: false }) },
            sleep: noSleep,
            tmpRoot: root,
          } as any,
        );
      } catch {}
    }
    expect(seen[0]).toBe(seen[1]);
  });
});
