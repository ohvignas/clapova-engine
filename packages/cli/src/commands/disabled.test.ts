import { describe, expect, it } from "vitest";
import { disabledCommand } from "./disabled.js";

describe("disabledCommand (Clapova fork)", () => {
  it.each(["feedback", "publish", "cloud"])("refuses `%s` without touching the network", (name) => {
    const cmd = disabledCommand(name);
    const run = cmd.run as (ctx: unknown) => unknown;
    expect(() => run({ args: {}, rawArgs: [], cmd })).toThrow(/disabled in the Clapova fork/);
  });
});

describe("cli command table", () => {
  it("routes feedback, publish and cloud to the disabled command", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../cli.ts", import.meta.url), "utf8");
    for (const name of ["feedback", "publish"]) {
      expect(src).toContain(`${name}: () => import("./commands/disabled.js")`);
    }
    // `cloud` is disabled except `cloud render --dry-run` (local archive sizing, no network).
    expect(src).toContain(
      `import("./commands/disabled.js").then((m) => m.disabledCommand("cloud"))`,
    );
    expect(src).toContain(`process.argv[3] === "render" && process.argv.includes("--dry-run")`);
  });
});
