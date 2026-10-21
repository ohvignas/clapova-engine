import { describe, expect, it, vi } from "vitest";
import { ClapovaRenderError } from "./errors.js";
import { renderTimeline } from "./render.js";
import { fakeProducer } from "./testing.js";

const base = { projectDir: "/p", outputPath: "/o/out.mp4" };

describe("renderTimeline", () => {
  it("passes config through and returns the result", async () => {
    const { api, calls } = fakeProducer();
    const res = await renderTimeline({ ...base, producer: api, fps: 25, quality: "high", crf: 18 });
    expect(calls[0]).toMatchObject({ projectDir: "/p", outputPath: "/o/out.mp4", config: { fps: 25, quality: "high", crf: 18 } });
    expect(res).toMatchObject({ outcome: "completed", outputPath: "/o/out.mp4", durationSeconds: 2, totalFrames: 60 });
  });

  it("defaults to 30 fps, standard quality", async () => {
    const { api, calls } = fakeProducer();
    await renderTimeline({ ...base, producer: api });
    expect(calls[0]?.config).toMatchObject({ fps: 30, quality: "standard" });
  });

  it("reports monotonic progress with the stage code", async () => {
    const { api } = fakeProducer(async (_job, report) => {
      report(10, "compile");
      report(40, "capture");
      report(30, "capture");
      report(90, "encode");
    });
    const seen: number[] = [];
    const stages: Array<string | undefined> = [];
    await renderTimeline({ ...base, producer: api, onProgress: (p) => { seen.push(p.percent); stages.push(p.stage); } });
    expect(seen).toEqual([10, 40, 40, 90]);
    expect(stages).toEqual(["compile", "capture", "capture", "encode"]);
  });

  it("does not fail when the progress consumer throws", async () => {
    const { api } = fakeProducer(async (_j, report) => report(50, "capture"));
    await expect(renderTimeline({ ...base, producer: api, onProgress: () => { throw new Error("x"); } })).resolves.toBeTruthy();
  });

  it("rejects invalid input before touching the engine", async () => {
    const { api, calls } = fakeProducer();
    await expect(renderTimeline({ ...base, producer: api, fps: 29 })).rejects.toMatchObject({ code: "INVALID_INPUT", owner: "user" });
    await expect(renderTimeline({ ...base, producer: api, crf: 18, videoBitrate: "8M" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(calls).toHaveLength(0);
  });

  it("refuses an already aborted signal", async () => {
    const { api, calls } = fakeProducer();
    const ac = new AbortController();
    ac.abort();
    await expect(renderTimeline({ ...base, producer: api, signal: ac.signal })).rejects.toMatchObject({ code: "RENDER_CANCELLED" });
    expect(calls).toHaveLength(0);
  });

  it("forwards the abort signal and maps the engine cancel", async () => {
    const ac = new AbortController();
    const { api } = fakeProducer(async (_job, _report, signal) => {
      expect(signal).toBeDefined();
      ac.abort();
      throw Object.assign(new Error("render_cancelled"), { name: "RenderCancelledError", reason: "user_cancelled" });
    });
    await expect(renderTimeline({ ...base, producer: api, signal: ac.signal })).rejects.toMatchObject({ code: "RENDER_CANCELLED", retryable: false });
  });

  it("turns a timeout into a retryable RENDER_TIMEOUT", async () => {
    const { api } = fakeProducer(
      (_job, _report, signal) =>
        new Promise((_, reject) => {
          signal!.addEventListener("abort", () =>
            reject(Object.assign(new Error("render_cancelled"), { name: "RenderCancelledError" })),
          );
        }),
    );
    await expect(renderTimeline({ ...base, producer: api, timeoutMs: 20 })).rejects.toMatchObject({ code: "RENDER_TIMEOUT", owner: "system", retryable: true });
  });

  it("maps engine errors with the failing stage and clip ids", async () => {
    const { api } = fakeProducer(async (job) => {
      job.failedStage = "compile";
      const err = Object.assign(new Error("mismatch"), { code: "ASSET_MEDIA_TYPE_MISMATCH", owner: "user", retryable: false, mismatches: [] });
      Object.defineProperty(err, "details", { value: [{ expected: "audio", detected: "video", elementId: "c-m1", src: "a.mp4" }] });
      throw err;
    });
    const err = await renderTimeline({ ...base, producer: api, clipIds: ["m1"] }).catch((e) => e);
    expect(err).toBeInstanceOf(ClapovaRenderError);
    expect(err).toMatchObject({ code: "ASSET_MEDIA_TYPE_MISMATCH", stage: "compile" });
    expect(err.issues[0]).toMatchObject({ clipId: "m1", src: "a.mp4", expected: "audio", detected: "video" });
  });

  it("returns warnings for completed_with_warnings", async () => {
    const { api } = fakeProducer(async (job) => {
      job.warnings.push({ code: "font_fallback", message: "fallback font" });
    });
    const res = await renderTimeline({ ...base, producer: api });
    expect(res.outcome).toBe("completed_with_warnings");
    expect(res.warnings).toEqual([{ code: "font_fallback", message: "fallback font" }]);
  });

  it("lazy-loads nothing when a producer is injected", async () => {
    const spy = vi.fn();
    const { api } = fakeProducer(async () => spy());
    await renderTimeline({ ...base, producer: api });
    expect(spy).toHaveBeenCalledOnce();
  });
});

describe("renderTimeline review fixes", () => {
  it("sets outcome on success", async () => {
    const { api } = fakeProducer();
    await expect(renderTimeline({ ...base, producer: api })).resolves.toMatchObject({ outcome: "completed" });
  });

  it("keeps a real engine error raised once the timeout has fired", async () => {
    const { api } = fakeProducer(async (_j, _r, signal) => {
      await new Promise((r) => setTimeout(r, 30));
      expect(signal?.aborted).toBe(true);
      throw Object.assign(new Error("chrome crashed"), { name: "Error" });
    });
    const err = await renderTimeline({ ...base, producer: api, timeoutMs: 5 }).catch((e) => e);
    expect(err.code).not.toBe("RENDER_TIMEOUT");
  });

  it("maps an engine timeout abort to RENDER_TIMEOUT (retryable)", async () => {
    const { api } = fakeProducer(async (_j, _r, signal) => {
      await new Promise((r) => setTimeout(r, 30));
      throw Object.assign(new Error("render_cancelled"), { name: "RenderCancelledError", reason: "timeout" });
    });
    await expect(renderTimeline({ ...base, producer: api, timeoutMs: 5 })).rejects.toMatchObject({
      code: "RENDER_TIMEOUT",
      retryable: true,
    });
  });

  it("maps a user cancel to RENDER_CANCELLED (not retryable), even with a timeout set", async () => {
    const controller = new AbortController();
    const { api } = fakeProducer(async (_j, _r, signal) => {
      controller.abort();
      expect(signal?.aborted).toBe(true);
      throw Object.assign(new Error("render_cancelled"), { name: "RenderCancelledError", reason: "user_cancelled" });
    });
    await expect(
      renderTimeline({ ...base, producer: api, signal: controller.signal, timeoutMs: 60_000 }),
    ).rejects.toMatchObject({ code: "RENDER_CANCELLED", retryable: false });
  });

  it("combines signal and timeout without AbortSignal.any (Node < 20.3)", async () => {
    const original = AbortSignal.any;
    // @ts-expect-error simulate an older runtime
    AbortSignal.any = undefined;
    try {
      const controller = new AbortController();
      const { api } = fakeProducer(async (_j, _r, signal) => {
        controller.abort();
        expect(signal?.aborted).toBe(true);
        throw Object.assign(new Error("x"), { name: "RenderCancelledError", reason: "user_cancelled" });
      });
      await expect(
        renderTimeline({ ...base, producer: api, signal: controller.signal, timeoutMs: 60_000 }),
      ).rejects.toMatchObject({ code: "RENDER_CANCELLED" });
    } finally {
      AbortSignal.any = original;
    }
  });
});
