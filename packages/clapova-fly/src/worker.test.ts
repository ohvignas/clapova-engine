import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalStore, keys, type ObjectStore } from "./store.js";
import { runChunkJob } from "./worker.js";

let root: string;
let store: ObjectStore;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "clapova-fly-worker-"));
  store = createLocalStore(join(root, "bucket"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function deps(rendered: number[]) {
  return {
    store,
    tmpRoot: root,
    unpackPlan: async (_t: string, d: string) => {
      mkdirSync(d, { recursive: true });
    },
    renderChunk: async (_p: string, index: number, out: string) => {
      rendered.push(index);
      writeFileSync(out, `chunk${index}`);
      return { sha256: `sha${index}`, framesEncoded: 10 } as any;
    },
  };
}
const job = { planHash: "h", chunkIndices: [0, 1], format: "mp4" as const };

describe("runChunkJob", () => {
  beforeEach(async () => {
    writeFileSync(join(root, "plan.tgz"), "x");
    await store.putFile(keys.plan("h"), join(root, "plan.tgz"));
  });

  it("renders, uploads and marks each chunk", async () => {
    const rendered: number[] = [];
    const markers = await runChunkJob(job, deps(rendered));
    expect(rendered).toEqual([0, 1]);
    expect(markers.map((m) => m.sha256)).toEqual(["sha0", "sha1"]);
    expect(await store.head(keys.chunk("h", 1, ".mp4"))).toBeTruthy();
  });

  it("skips a chunk with a valid marker", async () => {
    await runChunkJob(job, deps([]));
    const rendered: number[] = [];
    await runChunkJob(job, deps(rendered));
    expect(rendered).toEqual([]);
  });

  it("re-renders when the marker exists but the chunk object is missing", async () => {
    await runChunkJob(job, deps([]));
    await store.remove(keys.chunk("h", 0, ".mp4"));
    const rendered: number[] = [];
    await runChunkJob(job, deps(rendered));
    expect(rendered).toEqual([0]);
  });

  it("re-renders when the marker size mismatches or is corrupt", async () => {
    await runChunkJob(job, deps([]));
    await store.putText(keys.chunkDone("h", 0), JSON.stringify({ index: 0, sha256: "s", size: 999, framesEncoded: 1 }));
    await store.putText(keys.chunkDone("h", 1), "{not json");
    const rendered: number[] = [];
    await runChunkJob(job, deps(rendered));
    expect(rendered).toEqual([0, 1]);
  });
});
