import { describe, expect, it } from "vitest";
import { createClipIdResolver } from "./clipIds.js";
import { ClapovaRenderError, normalizeEngineError } from "./errors.js";

// Same shape as producer's AssetMediaTypeMismatchError (feat/erreur-media-detaillee).
function mediaMismatch(details?: unknown[]) {
  const err = new Error("1 composition asset(s) do not match") as Error & Record<string, unknown>;
  Object.assign(err, {
    name: "AssetMediaTypeMismatchError",
    code: "ASSET_MEDIA_TYPE_MISMATCH",
    owner: "user",
    retryable: false,
    mismatches: [{ expected: "video", detected: "image", elementFingerprint: "abcd" }],
  });
  Object.defineProperty(err, "details", {
    enumerable: false,
    value: details ?? [
      {
        expected: "video",
        detected: "image",
        elementFingerprint: "abcd",
        elementId: "c-clip7",
        src: "media/photo.mp4",
      },
    ],
  });
  err.describeForAuthor = () => '1 asset(s) do not match: element "c-clip7"';
  return err;
}

describe("normalizeEngineError", () => {
  it("maps a detailed media mismatch to clipId, src, expected and detected", () => {
    const out = normalizeEngineError(mediaMismatch(), {
      stage: "compile",
      resolveClipId: createClipIdResolver(["clip7"]),
    });
    expect(out).toBeInstanceOf(ClapovaRenderError);
    expect(out.code).toBe("ASSET_MEDIA_TYPE_MISMATCH");
    expect(out.owner).toBe("user");
    expect(out.retryable).toBe(false);
    expect(out.message).toContain("c-clip7");
    expect(out.issues).toEqual([
      expect.objectContaining({
        clipId: "clip7",
        elementId: "c-clip7",
        src: "media/photo.mp4",
        expected: "video",
        detected: "image",
        severity: "error",
      }),
    ]);
    const json = JSON.parse(JSON.stringify(out));
    expect(json).toMatchObject({ code: "ASSET_MEDIA_TYPE_MISMATCH", stage: "compile" });
    expect(json.issues[0].clipId).toBe("clip7");
  });

  it("falls back to fingerprints for an upstream error without details", () => {
    const err = mediaMismatch([]);
    const out = normalizeEngineError(err);
    expect(out.issues[0]).toMatchObject({ expected: "video", detected: "image" });
    expect(out.issues[0]?.clipId).toBeUndefined();
  });

  it("maps cancellation, quality, typed and unknown errors", () => {
    const cancelled = Object.assign(new Error("render_cancelled"), {
      name: "RenderCancelledError",
      reason: "user_cancelled",
    });
    expect(normalizeEngineError(cancelled)).toMatchObject({
      code: "RENDER_CANCELLED",
      retryable: false,
    });

    const quality = Object.assign(new Error("blocked"), {
      name: "RenderQualityError",
      warnings: [{ code: "sub_timeline_script_failure", message: "script threw" }],
    });
    const q = normalizeEngineError(quality);
    expect(q.code).toBe("RENDER_QUALITY_BLOCKED");
    expect(q.issues[0]?.code).toBe("sub_timeline_script_failure");

    const typed = Object.assign(new Error("encoder died"), {
      code: "ENCODER_INTERRUPTED",
      owner: "system",
      retryable: true,
    });
    expect(normalizeEngineError(typed)).toMatchObject({
      code: "ENCODER_INTERRUPTED",
      owner: "system",
      retryable: true,
    });

    const notMedia = Object.assign(new Error("text doc"), {
      code: "NOT_MEDIA_PAYLOAD",
      owner: "user",
      retryable: false,
      elementFingerprints: ["f1", "f2"],
    });
    expect(normalizeEngineError(notMedia).issues).toHaveLength(2);

    expect(normalizeEngineError(new Error("boom"))).toMatchObject({
      code: "RENDER_FAILED",
      owner: "system",
      retryable: true,
    });
    expect(normalizeEngineError("plain")).toMatchObject({
      code: "RENDER_FAILED",
      message: "plain",
    });
  });

  it("caps issues and message length", () => {
    const err = mediaMismatch(
      Array.from({ length: 50 }, (_, i) => ({
        expected: "audio",
        detected: "unknown",
        elementId: `c-${i}`,
        src: "x".repeat(1000),
      })),
    );
    const out = normalizeEngineError(err);
    expect(out.issues).toHaveLength(20);
    expect(out.issues[0]!.src!.length).toBeLessThanOrEqual(301);
  });
});
