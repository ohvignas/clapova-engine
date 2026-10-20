import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { REGISTRY, rewriteSpecifiers, transformPackageJson } from "./publish-private.mjs";

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
});
