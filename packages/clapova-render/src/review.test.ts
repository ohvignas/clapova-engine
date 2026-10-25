import { describe, expect, it } from "vitest";
import type { CliRunner } from "./cli.js";
import { REVIEW_FAILED, reviewSheets } from "./review.js";

const envelope = {
  ok: true,
  outputDir: "/proj/out",
  frames: [],
  contactSheets: ["/proj/out/review-beats.jpg"],
  review: {
    window: [0, 4],
    scenes: [{ id: "late", start: 1, end: 4 }],
    beats: [{ time: 0.4, label: "t=0.4", path: "/proj/out/beat-01-at-0.4s.png" }],
    seams: [
      {
        time: 1,
        from: null,
        to: "late",
        times: [0.8, 1, 1.2],
        paths: ["a", "b", "c"],
        sheet: "/proj/out/review-seam-01.jpg",
      },
    ],
    sheets: {
      beats: ["/proj/out/review-beats.jpg"],
      seams: ["/proj/out/review-seam-01.jpg"],
      phone: ["/proj/out/review-phone.jpg"],
    },
  },
};

describe("reviewSheets", () => {
  it("runs snapshot --review --json and returns the sheets", async () => {
    const calls: Array<readonly string[]> = [];
    const cli: CliRunner = async (args) => {
      calls.push(args);
      return { exitCode: 0, stdout: JSON.stringify(envelope), stderr: "" };
    };
    const res = await reviewSheets({
      projectDir: "/proj",
      composition: "late",
      outputDir: "/proj/out",
      cli,
    });
    expect(calls[0]).toEqual([
      "snapshot",
      "--review",
      "--json",
      "--composition",
      "late",
      "--output",
      "/proj/out",
      "/proj",
    ]);
    expect(calls[0]).not.toContain("--describe");
    expect(res.sheets.phone).toEqual(["/proj/out/review-phone.jpg"]);
    expect(res.seams[0]?.sheet).toBe("/proj/out/review-seam-01.jpg");
    expect(res).toMatchObject({ outputDir: "/proj/out", window: [0, 4], scenes: [{ id: "late" }] });
  });

  it("throws REVIEW_FAILED on a failed snapshot", async () => {
    const cli: CliRunner = async () => ({
      exitCode: 1,
      stdout: JSON.stringify({ ok: false, error: { message: "no composition" } }),
      stderr: "",
    });
    await expect(reviewSheets({ projectDir: "/proj", cli })).rejects.toMatchObject({
      code: REVIEW_FAILED,
      message: expect.stringContaining("no composition"),
    });
  });

  it("throws REVIEW_FAILED when the CLI cannot run", async () => {
    const cli: CliRunner = async () => {
      throw new Error("timed out");
    };
    await expect(reviewSheets({ projectDir: "/proj", cli })).rejects.toMatchObject({
      code: REVIEW_FAILED,
      retryable: true,
    });
  });
});
