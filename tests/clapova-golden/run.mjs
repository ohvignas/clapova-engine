#!/usr/bin/env node
// Suite golden Clapova : génère les compositions, les rend, compare aux références.
//
//   node tests/clapova-golden/run.mjs [id...]              build + rendu + comparaison
//   node tests/clapova-golden/run.mjs --update [id...]     réécrit les références
//   node tests/clapova-golden/run.mjs --skip-render DIR    compare des MP4 déjà rendus (DIR/<id>.mp4)
//
// À lancer dans l'image Dockerfile.test (Chrome et ffmpeg épinglés), jamais sur
// l'hôte : les références sont liées aux versions de Chrome et de ffmpeg.
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "./build.mjs";
import { compareResult } from "./lib/compare.mjs";
import { COMPOSITIONS } from "./lib/compositions.mjs";
import { extractFrame, loudness, probe, ssim } from "./lib/metrics.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const REFS = join(here, "references");
const frameName = (t) => `frame-${String(t).replace(".", "_")}s.png`;

const args = process.argv.slice(2);
const update = args.includes("--update");
const skipIdx = args.indexOf("--skip-render");
const skipDir = skipIdx >= 0 ? resolve(args[skipIdx + 1] ?? "") : null;
const ids = args.filter((a, i) => !a.startsWith("--") && i !== skipIdx + 1);
const specs = COMPOSITIONS.filter((c) => ids.length === 0 || ids.includes(c.id));
if (specs.length === 0) {
  console.error(`aucune composition pour : ${ids.join(", ")}`);
  process.exit(2);
}

const work = await mkdtemp(join(tmpdir(), "clapova-golden-"));
let renders = skipDir;
if (!renders) {
  await build(specs.map((s) => s.id));
  renders = join(work, "renders");
  const root = resolve(here, "../..");
  const r = await new Promise((done) => {
    const p = spawn("bunx", ["tsx", "tests/clapova-golden/render.ts", renders, ...specs.map((s) => s.id)], { cwd: root, stdio: "inherit" });
    p.on("close", done);
  });
  if (r !== 0) {
    console.error("échec du rendu");
    process.exit(1);
  }
}

let failed = 0;
for (const spec of specs) {
  const video = join(renders, `${spec.id}.mp4`);
  const refDir = join(REFS, spec.id);
  const info = await probe(video);
  const sound = await loudness(video);
  const got = { hasAudio: sound.hasAudio, lufs: sound.lufs, duration: info.duration };

  if (update) {
    await rm(refDir, { recursive: true, force: true });
    await mkdir(refDir, { recursive: true });
    for (const t of spec.frames) await extractFrame(video, t, join(refDir, frameName(t)));
    await writeFile(join(refDir, "meta.json"), JSON.stringify({ id: spec.id, fps: spec.fps, width: info.width, height: info.height, frames: spec.frames, ...got }, null, 2) + "\n");
    console.log(`référence écrite : ${spec.id}`);
    continue;
  }

  if (!existsSync(join(refDir, "meta.json"))) {
    console.error(`ECHEC ${spec.id} : référence absente (lancer avec --update dans l'image de test)`);
    failed++;
    continue;
  }
  const ref = JSON.parse(await readFile(join(refDir, "meta.json"), "utf8"));
  const frames = [];
  for (const t of ref.frames) {
    const out = join(work, `${spec.id}-${frameName(t)}`);
    await extractFrame(video, t, out);
    frames.push({ t, ssim: await ssim(join(refDir, frameName(t)), out) });
  }
  const fails = compareResult(ref, got, frames);
  const min = Math.min(...frames.map((f) => f.ssim));
  if (fails.length) {
    failed++;
    console.error(`ECHEC ${spec.id}\n  - ${fails.join("\n  - ")}`);
    const keep = join(here, "failures", spec.id);
    await mkdir(keep, { recursive: true });
    await cp(video, join(keep, "output.mp4"));
    for (const f of frames) await cp(join(work, `${spec.id}-${frameName(f.t)}`), join(keep, frameName(f.t)));
  } else {
    console.log(`ok ${spec.id} (SSIM min ${min.toFixed(4)}, ${got.hasAudio ? `${got.lufs} LUFS` : "sans audio"})`);
  }
}
await rm(work, { recursive: true, force: true });
if (failed) {
  console.error(`${failed} composition(s) en échec`);
  process.exit(1);
}
