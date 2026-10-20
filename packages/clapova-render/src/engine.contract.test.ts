import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Contract guard (roadmap 5.2 step 5): the engine exports this SDK relies on
// must still exist after an upstream merge. Reads sources so it runs without
// a full monorepo install.
const packages = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(packages, p), "utf8");

describe("engine contract", () => {
  it("producer exports createRenderJob and executeRenderJob", () => {
    const index = read("producer/src/index.ts");
    expect(index).toMatch(/\bcreateRenderJob\b/);
    expect(index).toMatch(/\bexecuteRenderJob\b/);
    const orchestrator = read("producer/src/services/renderOrchestrator.ts");
    expect(orchestrator).toMatch(
      /export async function executeRenderJob\(\s*job: RenderJob,\s*projectDir: string,\s*outputPath: string,\s*progressSink\?: ProgressCallback,\s*abortSignal\?: AbortSignal,/,
    );
    expect(orchestrator).toMatch(/class RenderCancelledError/);
    expect(orchestrator).toMatch(/class RenderQualityError/);
  });

  it("lint exports lintProject", () => {
    expect(read("lint/src/index.ts")).toMatch(/\blintProject\b/);
  });

  it("media mismatch error keeps its detailed shape", () => {
    const src = read("producer/src/services/assetMediaType.ts");
    expect(src).toMatch(/ASSET_MEDIA_TYPE_MISMATCH = "ASSET_MEDIA_TYPE_MISMATCH"/);
    expect(src).toMatch(/elementId: string;\s*src: string;/);
    expect(src).toMatch(/describeForAuthor\(\): string/);
  });
});
