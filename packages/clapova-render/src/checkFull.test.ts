import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHECK_FAILED, checkComposition } from "./check.js";
import type { CliRunner } from "./cli.js";

// Real `hyperframes check --json` output on a project with a 14 px line and an empty frame 0.
const report = readFileSync(join(import.meta.dirname, "fixtures", "check-report.json"), "utf8");

function fakeCli(stdout: string, calls: Array<readonly string[]> = [], exitCode = 0): CliRunner {
  return async (args) => {
    calls.push(args);
    return { exitCode, stdout, stderr: "" };
  };
}

describe("checkComposition full mode", () => {
  it("runs the full CLI check by default and maps craft findings", async () => {
    const calls: Array<readonly string[]> = [];
    const res = await checkComposition({
      projectDir: "/proj",
      cli: fakeCli(report, calls),
      clipIds: ["late"],
    });
    expect(calls[0]).toEqual(["check", "--json", "/proj"]);
    expect(res.mode).toBe("full");
    const codes = res.issues.map((i) => i.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "first_frame_empty",
        "text_below_floor",
        "nested_structure_needs_subcomposition",
      ]),
    );
    expect(res.sections?.craft).toEqual({ ok: true, errorCount: 0, warningCount: 2, infoCount: 0 });
    expect(Object.keys(res.sections ?? {})).toEqual([
      "lint",
      "runtime",
      "layout",
      "motion",
      "contrast",
      "craft",
    ]);
    const lint = res.issues.find((i) => i.code === "nested_structure_needs_subcomposition");
    expect(lint).toMatchObject({
      elementId: "late",
      file: "index.html",
      hint: expect.stringContaining("sub-composition"),
    });
    expect(res.issues.find((i) => i.code === "text_below_floor")?.message).toMatch(/14 px/);
    expect(res).toMatchObject({
      blocking: false,
      errorCount: 0,
      warningCount: 3,
      browserSkipped: false,
    });
  });

  it("passes --strict and blocks on warnings", async () => {
    const calls: Array<readonly string[]> = [];
    const res = await checkComposition({
      projectDir: "/proj",
      strict: true,
      cli: fakeCli(report, calls, 1),
    });
    expect(calls[0]).toContain("--strict");
    expect(res.blocking).toBe(true);
  });

  it("reports CHECK_FAILED when the CLI prints no JSON", async () => {
    const res = await checkComposition({ projectDir: "/proj", cli: fakeCli("boom") });
    expect(res.issues[0]).toMatchObject({ code: CHECK_FAILED, severity: "error" });
    expect(res.blocking).toBe(true);
  });

  it("reports CHECK_FAILED when the CLI cannot start", async () => {
    const cli: CliRunner = async () => {
      throw new Error("spawn ENOENT");
    };
    const res = await checkComposition({ projectDir: "/proj", cli });
    expect(res.issues[0]?.message).toMatch(/ENOENT/);
  });

  it("rethrows when aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const cli: CliRunner = async () => {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    };
    await expect(
      checkComposition({ projectDir: "/proj", cli, signal: controller.signal }),
    ).rejects.toThrow("aborted");
  });

  it("keeps preflight issues ahead of the CLI findings of the same severity", async () => {
    const preflight = async () => {
      throw Object.assign(new Error("missing"), {
        code: "ASSET_MISSING",
        owner: "user",
        retryable: false,
      });
    };
    const res = await checkComposition({ projectDir: "/proj", cli: fakeCli(report), preflight });
    expect(res.issues[0]?.code).toBe("ASSET_MISSING");
  });
});
