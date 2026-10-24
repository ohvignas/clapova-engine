import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkComposition } from "./check.js";
import { reviewSheets } from "./review.js";

// Real CLI + Chrome. Opt-in: CLAPOVA_E2E=1 (needs a built @hyperframes/cli and a browser).
const e2e = process.env["CLAPOVA_E2E"] === "1" ? describe : describe.skip;

const HTML = `<!DOCTYPE html><html><head><style>
body { margin: 0; background: #0a0a0f; width: 1920px; height: 1080px; color: #e0e0e0; font-family: sans-serif; }
.stage { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
.tiny { font-size: 14px; }
</style></head><body>
<div id="root" data-composition-id="craft" data-width="1920" data-height="1080" data-start="0" data-duration="4" data-no-timeline>
  <div id="late" class="stage clip" data-start="1" data-duration="3"><p class="tiny">This caption is far too small for any phone screen to read</p></div>
</div>
<script>window.__timelines = window.__timelines || {};</script>
</body></html>`;

e2e("real CLI", () => {
  const dir = mkdtempSync(join(tmpdir(), "clapova-craft-"));
  writeFileSync(join(dir, "index.html"), HTML);

  it("craft audit flags tiny text and an empty frame 0", async () => {
    const res = await checkComposition({ projectDir: dir });
    const codes = res.issues.map((i) => i.code);
    expect(codes).toContain("text_below_floor");
    expect(codes).toContain("first_frame_empty");
    expect(res.sections?.craft?.warningCount).toBeGreaterThanOrEqual(2);
  }, 240_000);

  it("writes review sheets", async () => {
    const res = await reviewSheets({ projectDir: dir });
    expect(res.sheets.beats.length).toBeGreaterThan(0);
    for (const sheet of [...res.sheets.beats, ...res.sheets.seams, ...res.sheets.phone])
      expect(existsSync(sheet)).toBe(true);
  }, 240_000);
});
