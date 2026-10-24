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
    // Reasons the SDK maps to RENDER_TIMEOUT / RENDER_CANCELLED.
    expect(orchestrator).toMatch(/reason: "user_cancelled" \| "timeout" \| "aborted"/);
  });

  it("producer sets job.outcome when a render finishes", () => {
    expect(read("producer/src/services/render/shared.ts")).toMatch(/job\.outcome\s*=/);
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

  it("cli check runs the craft audit and snapshot has --review", () => {
    const pipeline = read("cli/src/utils/checkPipeline.ts");
    expect(pipeline).toMatch(/\bcraft\b/);
    const craft = read("cli/src/utils/craftAudit.ts");
    for (const code of ["first_frame_empty", "text_below_floor", "film_silent"])
      expect(craft).toContain(code);
    expect(read("cli/src/commands/check.ts")).toMatch(/json: \{ type: "boolean"/);
    const snapshot = read("cli/src/commands/snapshot.ts");
    expect(snapshot).toMatch(/review: \{/);
    expect(snapshot).toMatch(/composition: \{/);
    expect(read("cli/src/commands/snapshotReview.ts")).toMatch(
      /export async function writeReviewSheets/,
    );
    expect(read("cli/package.json")).toMatch(/"hyperframes": "\.\/bin\/hyperframes\.mjs"/);
  });
});
