#!/usr/bin/env node
// Écrit tests/clapova-golden/.build/<id>/{index.html,assets/} pour chaque composition.
// Usage : node build.mjs [id...]
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { composeHtml } from "./lib/compose.mjs";
import { COMPOSITIONS } from "./lib/compositions.mjs";
import { generateMedia } from "./lib/media.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const BUILD_DIR = join(here, ".build");

export async function build(ids = []) {
  const wanted = COMPOSITIONS.filter((c) => ids.length === 0 || ids.includes(c.id));
  if (wanted.length === 0) throw new Error(`aucune composition pour : ${ids.join(", ")}`);
  const media = join(BUILD_DIR, "_media");
  await rm(BUILD_DIR, { recursive: true, force: true });
  await generateMedia(media);
  for (const spec of wanted) {
    const dir = join(BUILD_DIR, spec.id);
    await mkdir(join(dir, "assets"), { recursive: true });
    await writeFile(join(dir, "index.html"), composeHtml(spec));
    const used = new Set(
      spec.clips.filter((c) => c.src).map((c) => c.src.replace(/^assets\//, "")),
    );
    for (const name of used) await cp(join(media, name), join(dir, "assets", name));
  }
  return wanted.map((c) => c.id);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  build(process.argv.slice(2)).then((ids) =>
    console.log(`${ids.length} compositions dans ${BUILD_DIR}`),
  );
}
