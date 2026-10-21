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

describe("previewFrames cancellation during extraction", () => {
  const abortable = (r: ExtractFrameRequest) =>
    new Promise<void>((_resolve, reject) => {
      const fail = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      if (r.signal?.aborted) return fail();
      r.signal?.addEventListener("abort", fail, { once: true });
    });

  it("reports a user cancel as RENDER_CANCELLED, not retryable", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "cr-test-"));
    dirs.push(outDir);
    const controller = new AbortController();
    const { api } = fakeProducer();
    const promise = previewFrames({
      projectDir: "/p",
      times: [0],
      outDir,
      producer: api,
      signal: controller.signal,
      extractFrame: (r) => {
        setTimeout(() => controller.abort(), 5);
        return abortable(r);
      },
    });
    await expect(promise).rejects.toMatchObject({ code: "RENDER_CANCELLED", retryable: false });
  });

  it("bounds a hung extraction with timeoutMs", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "cr-test-"));
    dirs.push(outDir);
    const { api } = fakeProducer();
    await expect(
      previewFrames({ projectDir: "/p", times: [0], outDir, producer: api, timeoutMs: 50, extractFrame: abortable }),
    ).rejects.toMatchObject({ code: "RENDER_TIMEOUT", retryable: true });
  });

  it("ffmpeg extractor reports an abort as RENDER_CANCELLED", async () => {
    const { createFfmpegExtractor } = await import("./preview.js");
    const controller = new AbortController();
    controller.abort();
    await expect(
      createFfmpegExtractor(process.execPath)({
        videoPath: "/nope.mp4",
        timeSeconds: 0,
        outputPath: join(tmpdir(), "never.png"),
        maxHeight: 10,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "RENDER_CANCELLED", retryable: false });
  });
});
