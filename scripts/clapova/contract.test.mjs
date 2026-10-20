// Contract test between the fork and clapova-render (roadmap 5.2 / 5.4).
// Update the golden with `node scripts/clapova/contract.mjs --update` only
// after checking that clapova-render still works with the change.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  listLintCodes,
  listProducerValueExports,
  readCompositionContractVersion,
  readGolden,
} from "./contract.mjs";

describe("clapova contract", () => {
  const golden = readGolden();

  it("producer still exports everything clapova-render imports", () => {
    const exported = new Set(listProducerValueExports());
    const missing = golden.producerRequiredExports.filter((name) => !exported.has(name));
    assert.deepEqual(missing, [], `missing producer exports: ${missing.join(", ")}`);
  });

  it("COMPOSITION_CONTRACT_VERSION is a version clapova knows", () => {
    const version = readCompositionContractVersion();
    assert.ok(
      golden.knownCompositionContractVersions.includes(version),
      `unknown COMPOSITION_CONTRACT_VERSION ${version}; review the compose output of clapova-compose, then run contract.mjs --update`,
    );
  });

  it("no lint code disappeared (golden)", () => {
    const current = new Set(listLintCodes());
    const removed = golden.lintCodes.filter((code) => !current.has(code));
    assert.deepEqual(removed, [], `lint codes removed or renamed: ${removed.join(", ")}`);
  });

  it("golden lint codes are sorted and unique", () => {
    assert.deepEqual(golden.lintCodes, [...new Set(golden.lintCodes)].sort());
  });
});
