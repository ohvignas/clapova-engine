import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type ExtractFrameRequest, previewFrames } from "./preview.js";
import { fakeProducer } from "./testing.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("previewFrames", () => {
  it("renders once in draft and extracts each requested time, clamped to the end", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "cr-test-"));
    dirs.push(outDir);
    const { api, calls } = fakeProducer();
    const requests: ExtractFrameRequest[] = [];
    const frames = await previewFrames({
      projectDir: "/p",
      times: [0, 1, 5],
      outDir,
      producer: api,
      extractFrame: async (r) => { requests.push(r); },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.config).toMatchObject({ quality: "draft", format: "mp4" });
    expect(frames.map((f) => f.timeSeconds)).toEqual([0, 1, 2 - 1 / 30]);
    expect(frames[2]?.path).toBe(join(outDir, "frame-02.png"));
    expect(requests[0]?.maxHeight).toBe(540);
    // The temporary draft video is cleaned up.
    expect(existsSync(requests[0]!.videoPath)).toBe(false);
  });

  it("rejects empty, oversized or negative time lists", async () => {
    const { api } = fakeProducer();
    const opts = { projectDir: "/p", outDir: tmpdir(), producer: api, extractFrame: async () => {} };
    await expect(previewFrames({ ...opts, times: [] })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(previewFrames({ ...opts, times: Array(13).fill(0) })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(previewFrames({ ...opts, times: [-1] })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
