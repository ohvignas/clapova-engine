import { describe, expect, it } from "vitest";
import { DEFAULT_GUARDS, decideMachineBudget, readGuardsFromEnv } from "./guards.js";

describe("readGuardsFromEnv", () => {
  it("falls back to Clapova defaults", () => {
    expect(readGuardsFromEnv({})).toEqual({ minBacklog: 3, minWaitMs: 180_000, maxMachines: 3 });
  });
  it("reads overrides and ignores garbage", () => {
    expect(
      readGuardsFromEnv({ FLY_MIN_BACKLOG: "5", FLY_MIN_WAIT_MS: "x", FLY_MAX_MACHINES: "2" }),
    ).toEqual({ minBacklog: 5, minWaitMs: 180_000, maxMachines: 2 });
  });
});

describe("decideMachineBudget", () => {
  const g = DEFAULT_GUARDS;
  it("refuses when the queue is short", () => {
    expect(decideMachineBudget({ backlog: 2, oldestWaitMs: 999_999, runningMachines: 0 }, g).allowed).toBe(false);
  });
  it("refuses when the oldest job has not waited long enough", () => {
    expect(decideMachineBudget({ backlog: 5, oldestWaitMs: 60_000, runningMachines: 0 }, g).allowed).toBe(false);
  });
  it("allows the remaining room when saturated", () => {
    const b = decideMachineBudget({ backlog: 3, oldestWaitMs: 180_000, runningMachines: 1 }, g);
    expect(b).toMatchObject({ allowed: true, machines: 2 });
  });
  it("refuses at FLY_MAX_MACHINES", () => {
    const b = decideMachineBudget({ backlog: 9, oldestWaitMs: 999_999, runningMachines: 3 }, g);
    expect(b).toMatchObject({ allowed: false, machines: 0 });
  });
  it("lets an explicit srv2Saturated flag decide", () => {
    expect(decideMachineBudget({ backlog: 0, oldestWaitMs: 0, runningMachines: 0, srv2Saturated: true }, g).allowed).toBe(true);
    expect(decideMachineBudget({ backlog: 9, oldestWaitMs: 999_999, runningMachines: 0, srv2Saturated: false }, g).allowed).toBe(false);
  });
});
