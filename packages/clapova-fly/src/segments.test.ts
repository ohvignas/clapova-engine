import { describe, expect, it } from "vitest";
import { assignChunksToMachines, sizeSegments, splitFrames } from "./segments.js";

describe("splitFrames", () => {
  it("covers every frame exactly once with a short last segment", () => {
    const segs = splitFrames(1000, 240);
    expect(segs.map((s) => s.frames)).toEqual([240, 240, 240, 240, 40]);
    expect(segs[0]).toEqual({ index: 0, startFrame: 0, endFrame: 240, frames: 240 });
    expect(segs.at(-1)!.endFrame).toBe(1000);
    for (let i = 1; i < segs.length; i++) expect(segs[i]!.startFrame).toBe(segs[i - 1]!.endFrame);
  });
  it("handles exact multiples, zero and tiny inputs", () => {
    expect(splitFrames(480, 240)).toHaveLength(2);
    expect(splitFrames(0, 240)).toEqual([]);
    expect(splitFrames(5, 240)).toHaveLength(1);
  });
  it("rejects invalid arguments", () => {
    expect(() => splitFrames(-1, 10)).toThrow(RangeError);
    expect(() => splitFrames(10, 0)).toThrow(RangeError);
    expect(() => splitFrames(10.5, 10)).toThrow(RangeError);
  });
});

describe("sizeSegments", () => {
  it("spreads a 5 min 30 fps render over 8 chunks", () => {
    const s = sizeSegments({ totalFrames: 9000, machines: 8 });
    expect(s.segmentFrames).toBe(1125);
    expect(s.segmentCount).toBe(8);
    expect(s.maxParallelChunks).toBe(8);
  });
  it("respects chunksPerMachine", () => {
    const s = sizeSegments({ totalFrames: 9000, machines: 3, chunksPerMachine: 2 });
    expect(s.maxParallelChunks).toBe(6);
    expect(s.segmentCount).toBe(6);
  });
  it("never goes below the minimum segment size", () => {
    const s = sizeSegments({ totalFrames: 30, machines: 3 });
    expect(s.segmentFrames).toBe(10);
    expect(s.segmentCount).toBe(3);
    const tiny = sizeSegments({ totalFrames: 12, machines: 3 });
    expect(tiny.segmentFrames).toBe(10);
    expect(tiny.segmentCount).toBe(2);
  });
  it("rejects zero machines or frames", () => {
    expect(() => sizeSegments({ totalFrames: 100, machines: 0 })).toThrow();
    expect(() => sizeSegments({ totalFrames: 0, machines: 1 })).toThrow();
  });
});

describe("assignChunksToMachines", () => {
  it("balances contiguous groups", () => {
    expect(assignChunksToMachines(8, 3)).toEqual([
      [0, 1, 2],
      [3, 4, 5],
      [6, 7],
    ]);
  });
  it("never creates empty groups when machines exceed chunks", () => {
    expect(assignChunksToMachines(2, 5)).toEqual([[0], [1]]);
  });
  it("skips chunks already done", () => {
    expect(assignChunksToMachines(6, 2, new Set([0, 1, 4]))).toEqual([[2, 3], [5]]);
  });
  it("returns nothing when all done", () => {
    expect(assignChunksToMachines(3, 2, new Set([0, 1, 2]))).toEqual([]);
  });
  it("rejects zero machines", () => {
    expect(() => assignChunksToMachines(3, 0)).toThrow(RangeError);
  });
});
