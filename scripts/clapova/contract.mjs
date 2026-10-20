// Clapova contract extraction. Static analysis only, so it runs without a
// build, Chrome or ffmpeg. The golden file lists what clapova-render relies on.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const ROOT = join(import.meta.dirname, "..", "..");
export const GOLDEN_PATH = join(import.meta.dirname, "contract.golden.json");

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Value (runtime) export names of the producer entry point. Type-only exports are ignored. */
export function listProducerValueExports(root = ROOT) {
  const source = stripComments(readFileSync(join(root, "packages/producer/src/index.ts"), "utf8"));
  const names = new Set();
  for (const block of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const raw of block[1].split(",")) {
      const item = raw.trim();
      if (!item || /^type\s/.test(item)) continue;
      const alias = item.split(/\s+as\s+/);
      names.add(alias[alias.length - 1].trim());
    }
  }
  for (const m of source.matchAll(/export\s+(?:async\s+)?(?:const|function|class)\s+([A-Za-z0-9_$]+)/g)) {
    names.add(m[1]);
  }
  return [...names].sort();
}

export function readCompositionContractVersion(root = ROOT) {
  const source = readFileSync(join(root, "packages/parsers/src/compositionContract.ts"), "utf8");
  const match = source.match(/export const COMPOSITION_CONTRACT_VERSION\s*=\s*(\d+)/);
  return match ? Number(match[1]) : null;
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) yield path;
  }
}

/** Lint finding codes declared as `code: "snake_case"` in the lint package sources. */
export function listLintCodes(root = ROOT) {
  const codes = new Set();
  for (const file of walk(join(root, "packages/lint/src"))) {
    const source = stripComments(readFileSync(file, "utf8"));
    for (const m of source.matchAll(/\bcode:\s*"([a-z][a-z0-9]*(?:_[a-z0-9]+)+)"/g)) codes.add(m[1]);
  }
  return [...codes].sort();
}

export function readGolden() {
  return JSON.parse(readFileSync(GOLDEN_PATH, "utf8"));
}

export function snapshot(root = ROOT) {
  return {
    compositionContractVersion: readCompositionContractVersion(root),
    producerRequiredExports: readGolden().producerRequiredExports,
    lintCodes: listLintCodes(root),
  };
}

if (process.argv.includes("--update")) {
  const { writeFileSync } = await import("node:fs");
  const golden = readGolden();
  golden.knownCompositionContractVersions = [
    ...new Set([...golden.knownCompositionContractVersions, readCompositionContractVersion()]),
  ].sort((a, b) => a - b);
  golden.lintCodes = listLintCodes();
  writeFileSync(GOLDEN_PATH, JSON.stringify(golden, null, 2) + "\n");
  console.log(`golden updated: ${golden.lintCodes.length} lint codes`);
}
