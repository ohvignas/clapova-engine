import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  PUBLISH_ORDER,
  REGISTRY,
  rewriteSpecifiers,
  transformPackageJson,
} from "./publish-private.mjs";

const PACKAGES = join(import.meta.dirname, "..", "..", "packages");

describe("publish-private", () => {
  it("renames the package and its internal dependencies", () => {
    const out = transformPackageJson(
      {
        name: "@hyperframes/producer",
        version: "0.8.177",
        dependencies: { "@hyperframes/core": "workspace:*", hono: "^4.0.0" },
        publishConfig: { access: "public", exports: {} },
      },
      "0.8.177-clapova.1",
    );
    assert.equal(out.name, "@clapova-hf/producer");
    assert.equal(out.version, "0.8.177-clapova.1");
    assert.deepEqual(out.dependencies, { "@clapova-hf/core": "workspace:*", hono: "^4.0.0" });
    assert.equal(out.publishConfig.registry, REGISTRY);
    assert.equal(out.publishConfig.access, "restricted");
    assert.deepEqual(out.publishConfig.exports, {});
  });

  it("rewrites specifiers in built files", () => {
    assert.equal(rewriteSpecifiers('import "@hyperframes/core";'), 'import "@clapova-hf/core";');
  });

  it("renames peerDependencies too", () => {
    const out = transformPackageJson(
      { name: "@hyperframes/studio", peerDependencies: { "@hyperframes/core": "^1" } },
      "1.0.0-clapova.1",
    );
    assert.deepEqual(out.peerDependencies, { "@clapova-hf/core": "^1" });
  });

  it("PUBLISH_ORDER lists every non-private package exactly once", () => {
    const publishable = readdirSync(PACKAGES)
      .filter((dir) => {
        try {
          return !JSON.parse(readFileSync(join(PACKAGES, dir, "package.json"), "utf8")).private;
        } catch {
          return false;
        }
      })
      .sort();
    assert.deepEqual([...PUBLISH_ORDER].sort(), publishable);
  });

  it("publishes after every internal dependency", () => {
    // core and studio-server depend on each other; the registry accepts either order.
    const cycle = new Set(["core>studio-server", "studio-server>core"]);
    for (const [i, dir] of PUBLISH_ORDER.entries()) {
      const pkg = JSON.parse(readFileSync(join(PACKAGES, dir, "package.json"), "utf8"));
      const deps = { ...pkg.dependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies };
      for (const name of Object.keys(deps)) {
        if (!name.startsWith("@hyperframes/")) continue;
        const at = PUBLISH_ORDER.indexOf(name.slice("@hyperframes/".length));
        if (at === -1 || cycle.has(`${dir}>${name.slice("@hyperframes/".length)}`)) continue;
        assert.ok(at < i, `${dir} must be published after ${name}`);
      }
    }
  });

  it("uses a tag that upstream publish.yml (v*-*) does not match", () => {
    const wf = readFileSync(
      join(import.meta.dirname, "..", "..", ".github", "workflows", "publish-private.yml"),
      "utf8",
    );
    assert.match(wf, /- "clapova-v\*"/);
    assert.doesNotMatch(wf, /- "v\*/);
  });
});
