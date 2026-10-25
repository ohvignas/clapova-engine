import { describe, expect, it } from "vitest";
import { checkComposition } from "./check.js";
import type { EngineLintFinding, LintApi } from "./engine.js";

function fakeLint(findings: EngineLintFinding[], calls: unknown[][] = []): LintApi {
  return {
    async lintProject(...args) {
      calls.push(args);
      return {
        results: [{ file: "index.html", result: { findings } }],
        totalErrors: findings.filter((f) => f.severity === "error").length,
        totalWarnings: findings.filter((f) => f.severity === "warning").length,
        totalInfos: 0,
      };
    },
  };
}

describe("checkComposition", () => {
  it("sorts by severity, maps clip ids and keeps hints", async () => {
    const lint = fakeLint([
      { code: "w1", severity: "warning", message: "warn" },
      {
        code: "e1",
        severity: "error",
        message: "err",
        elementId: "c-clip2-l",
        fixHint: "add class clip",
      },
      { code: "i1", severity: "info", message: "info" },
    ]);
    const res = await checkComposition({
      projectDir: "/p",
      mode: "lint",
      lint,
      clipIds: ["clip2"],
    });
    expect(res.issues.map((i) => i.code)).toEqual(["e1", "w1", "i1"]);
    expect(res.issues[0]).toMatchObject({
      clipId: "clip2",
      hint: "add class clip",
      file: "index.html",
    });
    expect(res).toMatchObject({
      blocking: true,
      errorCount: 1,
      warningCount: 1,
      infoCount: 1,
      truncated: false,
    });
  });

  it("blocks on warnings only in strict mode", async () => {
    const lint = fakeLint([{ code: "w1", severity: "warning", message: "warn" }]);
    expect((await checkComposition({ projectDir: "/p", mode: "lint", lint })).blocking).toBe(false);
    expect(
      (await checkComposition({ projectDir: "/p", mode: "lint", lint, strict: true })).blocking,
    ).toBe(true);
  });

  it("caps issues at 20", async () => {
    const lint = fakeLint(
      Array.from({ length: 30 }, (_, i) => ({
        code: `e${i}`,
        severity: "error" as const,
        message: "x",
      })),
    );
    const res = await checkComposition({ projectDir: "/p", mode: "lint", lint, maxIssues: 100 });
    expect(res.issues).toHaveLength(20);
    expect(res.truncated).toBe(true);
    expect(res.errorCount).toBe(30);
  });

  it("merges preflight errors first, with media details", async () => {
    const lint = fakeLint([{ code: "w1", severity: "warning", message: "warn" }]);
    const preflight = async () => {
      const err = Object.assign(new Error("mismatch"), {
        code: "ASSET_MEDIA_TYPE_MISMATCH",
        owner: "user",
        retryable: false,
        mismatches: [],
      });
      Object.defineProperty(err, "details", {
        value: [{ expected: "video", detected: "image", elementId: "c-v1", src: "v.mp4" }],
      });
      throw err;
    };
    const res = await checkComposition({
      projectDir: "/p",
      mode: "lint",
      lint,
      preflight,
      clipIds: ["v1"],
    });
    expect(res.issues[0]).toMatchObject({
      code: "ASSET_MEDIA_TYPE_MISMATCH",
      clipId: "v1",
      src: "v.mp4",
    });
    expect(res.blocking).toBe(true);
  });

  it("passes the entry file as a path inside the project", async () => {
    const calls: unknown[][] = [];
    await checkComposition({
      projectDir: "/p",
      mode: "lint",
      entryFile: "main.html",
      lint: fakeLint([], calls),
    });
    expect(calls[0]).toEqual(["/p", "/p/main.html"]);
  });
});
