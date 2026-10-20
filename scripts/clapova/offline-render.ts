// Zero-network render check (roadmap 5.4). Renders a local composition and
// fails if the network is reachable, so a pass proves the render needs none.
// Run in the Dockerfile.test image with `docker run --network none` (see
// .github/workflows/clapova-offline.yml). Outside a sandbox, set
// CLAPOVA_ALLOW_NETWORK=1 to skip the "network is really cut" guard.
import { existsSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createRenderJob,
  executeRenderJob,
} from "../../packages/producer/src/services/renderOrchestrator.js";

const fixtureDir = resolve(import.meta.dirname, "fixtures/offline-render");

// Telemetry must stay off even if the image sets nothing.
process.env.HYPERFRAMES_NO_TELEMETRY = "1";
process.env.DO_NOT_TRACK = "1";

async function networkIsReachable(): Promise<boolean> {
  try {
    await fetch("https://example.com", { signal: AbortSignal.timeout(4000) });
    return true;
  } catch {
    return false;
  }
}

if (process.env.CLAPOVA_ALLOW_NETWORK !== "1" && (await networkIsReachable())) {
  console.error("offline-render: network is reachable, run with --network none");
  process.exit(2);
}

const outputPath = join(mkdtempSync(join(tmpdir(), "clapova-offline-")), "out.mp4");
const job = createRenderJob({
  fps: 30,
  quality: "draft",
  format: "mp4",
  workers: 1,
  useGpu: false,
  debug: false,
});
await executeRenderJob(job, fixtureDir, outputPath);

if (!existsSync(outputPath) || statSync(outputPath).size === 0) {
  console.error("offline-render: no output produced");
  process.exit(1);
}
console.log(`offline-render: ok (${statSync(outputPath).size} bytes, no network)`);
