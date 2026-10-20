import { describe, expect, it } from "vitest";
import { clipDomId, createClipIdResolver } from "./clipIds.js";

describe("createClipIdResolver", () => {
  it("maps dom ids and derived ids back to known clip ids", () => {
    const resolve = createClipIdResolver(["a", "a-b", "x.y"]);
    expect(resolve("c-a")).toBe("a");
    expect(resolve("c-a-b-l")).toBe("a-b");
    expect(resolve("c-a-km")).toBe("a");
    expect(resolve(clipDomId("x.y"))).toBe("x.y");
    expect(resolve("root")).toBeUndefined();
    expect(resolve(undefined)).toBeUndefined();
  });

  it("falls back to the naming heuristic without a timeline", () => {
    const resolve = createClipIdResolver();
    expect(resolve("c-clip1")).toBe("clip1");
    expect(resolve("c-clip1-l")).toBe("clip1");
    expect(resolve("title")).toBeUndefined();
  });
});
