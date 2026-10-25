// Rend les compositions de .build/ avec le producer du dépôt (même chemin que
// regression-harness.ts : createRenderJob + executeRenderJob, qualité max, SDR).
// Usage : bunx tsx tests/clapova-golden/render.ts <sortie> <id>...
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRenderJob, executeRenderJob } from "../../packages/producer/src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const [outDir, ...ids] = process.argv.slice(2);
if (!outDir || ids.length === 0) {
  console.error("usage : render.ts <dossier-sortie> <id>...");
  process.exit(2);
}
await mkdir(outDir, { recursive: true });
for (const id of ids) {
  const job = createRenderJob({
    fps: 30,
    quality: "high",
    format: "mp4",
    useGpu: false,
    debug: false,
    hdrMode: "force-sdr",
  });
  await executeRenderJob(job, join(here, ".build", id), join(outDir, `${id}.mp4`));
  console.log(`rendu ${id}`);
}
