import assert from "node:assert/strict";
import test from "node:test";
import compatibility from "../out/compatibility.js";

const { compareLegends, describeLegendComparison } = compatibility;

const declared = ["elisa.type.user", "elisa.enum.variant", "elisa.fn.def"];

test("matching legends produce no comparison result", () => {
  assert.equal(compareLegends(declared, [...declared]), undefined);
});

test("missing and unexpected server entries are reported separately", () => {
  const comparison = compareLegends(declared, [
    "elisa.type.user",
    "elisa.fn.def",
    "elisa.extra.kind",
  ]);
  assert.deepEqual(comparison.missingFromServer, ["elisa.enum.variant"]);
  assert.deepEqual(comparison.unexpectedFromServer, ["elisa.extra.kind"]);
  const description = describeLegendComparison(comparison);
  assert.match(description, /missing elisa\.enum\.variant/);
  assert.match(description, /added elisa\.extra\.kind/);
});

test("reordered legends are treated as incompatible", () => {
  const comparison = compareLegends(declared, [
    "elisa.enum.variant",
    "elisa.type.user",
    "elisa.fn.def",
  ]);
  assert.equal(comparison.orderChanged, true);
  assert.match(describeLegendComparison(comparison), /order differs/);
});

test("absent server legend is not treated as a mismatch", () => {
  assert.equal(compareLegends(declared, undefined), undefined);
  assert.equal(compareLegends(declared, []), undefined);
});
