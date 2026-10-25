import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  outDir: "dist",
  target: "node22",
  platform: "node",
  bundle: true,
  splitting: false,
  clean: true,
  dts: true,
  // The engine is loaded at runtime (lazy import), never bundled.
  external: ["@hyperframes/producer", "@hyperframes/lint", "@hyperframes/cli"],
});
