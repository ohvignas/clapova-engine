#!/usr/bin/env node
// Rewrites the publishable packages from @hyperframes/* to @clapova-hf/* inside
// the CI checkout only, then publishes them to GitHub Packages with pnpm.
// Usage: node scripts/clapova/publish-private.mjs <version> [--dry-run]
// The source tree keeps upstream names so upstream merges stay clean.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");
export const FROM_SCOPE = "@hyperframes/";
export const TO_SCOPE = "@clapova-hf/";
export const REGISTRY = "https://npm.pkg.github.com";
// Dependency order: a package is published after everything it depends on.
export const PUBLISH_ORDER = [
  "parsers",
  "lint",
  "studio-server",
  "core",
  "inspector",
  "sdk",
  "engine",
  "player",
  "producer",
  "shader-transitions",
  "studio",
  "aws-lambda",
  "gcp-cloud-run",
  "cli",
];

const rename = (name) =>
  name.startsWith(FROM_SCOPE) ? TO_SCOPE + name.slice(FROM_SCOPE.length) : name;

/** Pure transform of one package.json. */
export function transformPackageJson(pkg, version) {
  const out = { ...pkg, name: rename(pkg.name), version };
  const fields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
  for (const field of fields) {
    if (!pkg[field]) continue;
    out[field] = Object.fromEntries(Object.entries(pkg[field]).map(([k, v]) => [rename(k), v]));
  }
  const url = "https://github.com/ohvignas/clapova-engine";
  out.repository = { ...(pkg.repository ?? {}), url };
  out.publishConfig = { ...(pkg.publishConfig ?? {}), registry: REGISTRY, access: "restricted" };
  return out;
}

/** Rewrites bare import specifiers in built files so they resolve to the renamed packages. */
export function rewriteSpecifiers(source) {
  return source.replaceAll(FROM_SCOPE, TO_SCOPE);
}

// Published files outside dist (templates, skills) can import the scope too.
const TEXT_FILE = /\.(?:js|mjs|cjs|ts|mts|cts|json|html|md)$/;
const SKIP_DIRS = new Set(["node_modules", ".git", "src"]);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (SKIP_DIRS.has(entry)) continue;
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (TEXT_FILE.test(entry) && entry !== "package.json") yield path;
  }
}

function main() {
  const [version, ...flags] = process.argv.slice(2);
  const dryRun = flags.includes("--dry-run");
  if (!version || !/^\d+\.\d+\.\d+-clapova\.\d+$/.test(version)) {
    console.error("usage: publish-private.mjs <X.Y.Z-clapova.N> [--dry-run]");
    process.exit(1);
  }
  // Rename everything first: pnpm resolves workspace:* by package name.
  for (const dir of PUBLISH_ORDER) {
    const base = join(ROOT, "packages", dir);
    const file = join(base, "package.json");
    const pkg = transformPackageJson(JSON.parse(readFileSync(file, "utf8")), version);
    writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
    for (const path of walk(base)) {
      writeFileSync(path, rewriteSpecifiers(readFileSync(path, "utf8")));
    }
  }
  for (const dir of PUBLISH_ORDER) {
    const name = JSON.parse(readFileSync(join(ROOT, "packages", dir, "package.json"), "utf8")).name;
    const args = ["--filter", name, "publish", "--no-git-checks", "--tag", "clapova"];
    if (dryRun) args.push("--dry-run");
    console.log(`pnpm ${args.join(" ")}`);
    execFileSync("pnpm", args, { cwd: ROOT, stdio: "inherit" });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
