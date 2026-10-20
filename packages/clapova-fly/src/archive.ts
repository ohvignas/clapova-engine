/** tar.gz helpers (same approach as gcp-cloud-run: pure-JS `tar`, no system binary). */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import * as tar from "tar";

export async function tarDirectory(sourceDir: string, destTarball: string): Promise<void> {
  mkdirSync(dirname(destTarball), { recursive: true });
  await tar.create({ gzip: true, file: destTarball, cwd: sourceDir }, ["."]);
}

export async function untarDirectory(tarball: string, destDir: string): Promise<void> {
  if (!existsSync(tarball)) throw new Error(`[clapova-fly] tarball missing: ${tarball}`);
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  await tar.extract({ file: tarball, cwd: destDir });
}
