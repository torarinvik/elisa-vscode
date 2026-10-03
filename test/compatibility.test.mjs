import assert from "node:assert/strict";
import test from "node:test";
import compatibility from "../out/compatibility.js";

const {
  compareLegends,
  describeLegendComparison,
  inspectDeclaredLegend,
  inspectServerLegend,
  semanticLegendCompatibilityIssue,
} = compatibility;

const declared = ["elisa-type-user", "elisa-enum-variant", "elisa-fn-def"];

test("server legend parsing rejects non-string entries without filtering them", () => {
  assert.deepEqual(
    inspectServerLegend({
      capabilities: {
        semanticTokensProvider: {
          legend: { tokenTypes: ["type", "enumMember"], tokenModifiers: [] },
        },
      },
    }),
    { kind: "valid", values: ["type", "enumMember"], modifiers: [] },
  );
  assert.deepEqual(
    inspectServerLegend({
      capabilities: {
        semanticTokensProvider: {
          legend: { tokenTypes: ["type", null, "enumMember"], tokenModifiers: [] },
        },
      },
    }),
    {
      kind: "invalid",
      detail: "server semantic tokenTypes entry 1 must be a non-empty string",
    },
  );
});

test("a present semantic-token provider without a valid legend is not mistaken for no provider", () => {
  assert.deepEqual(
    inspectServerLegend({ capabilities: { semanticTokensProvider: { full: true } } }),
    {
      kind: "invalid",
      detail: "server semanticTokensProvider must include a legend object",
    },
  );
  assert.deepEqual(
    inspectServerLegend({ capabilities: { hoverProvider: true } }),
    { kind: "absent" },
  );
});

test("server token-modifier legends are required, validated, and unique", () => {
  const withModifiers = (tokenModifiers) => ({
    capabilities: {
      semanticTokensProvider: {
        legend: { tokenTypes: ["type"], tokenModifiers },
      },
    },
  });
  assert.deepEqual(
    inspectServerLegend({
      capabilities: {
        semanticTokensProvider: { legend: { tokenTypes: ["type"] } },
      },
    }),
    {
      kind: "invalid",
      detail: "server semantic tokenModifiers must be an array",
    },
  );
  assert.deepEqual(
    inspectServerLegend(withModifiers(["declaration", null])),
    {
      kind: "invalid",
      detail: "server semantic tokenModifiers entry 1 must be a non-empty string",
    },
  );
  assert.deepEqual(
    inspectServerLegend(withModifiers(["declaration", "declaration"])),
    {
      kind: "invalid",
      detail: "server semantic tokenModifiers repeats declaration",
    },
  );
});

test("client legend parsing does not silently drop malformed contribution entries", () => {
  assert.deepEqual(
    inspectDeclaredLegend({
      contributes: { semanticTokenTypes: [{ id: "elisa-type-user" }, { description: "missing id" }] },
    }),
    {
      kind: "invalid",
      detail: "client semanticTokenTypes entry 1 must have a non-empty string id",
    },
  );
});

test("both client and server legends are bounded before entry copying", () => {
  const tooManyTypes = Array.from({ length: 257 }, (_, index) => `type-${index}`);
  assert.deepEqual(
    inspectServerLegend({
      capabilities: {
        semanticTokensProvider: {
          legend: { tokenTypes: tooManyTypes, tokenModifiers: [] },
        },
      },
    }),
    {
      kind: "invalid",
      detail: "server semantic tokenTypes exceeds the 256-entry limit",
    },
  );
  assert.deepEqual(
    inspectDeclaredLegend({
      contributes: {
        semanticTokenTypes: tooManyTypes.map((id) => ({ id })),
      },
    }),
    {
      kind: "invalid",
      detail: "client semanticTokenTypes exceeds the 256-entry limit",
    },
  );
});

test("legend identifier length and total text are bounded", () => {
  const provider = (tokenTypes) => ({
    capabilities: {
      semanticTokensProvider: {
        legend: { tokenTypes, tokenModifiers: [] },
      },
    },
  });
  assert.deepEqual(
    inspectServerLegend(provider(["x".repeat(129)])),
    {
      kind: "invalid",
      detail: "server semantic tokenTypes entry 0 exceeds the 128-character limit",
    },
  );
  assert.deepEqual(
    inspectServerLegend(provider(Array.from({ length: 129 }, () => "x".repeat(128)))),
    {
      kind: "invalid",
      detail: "server semantic tokenTypes exceeds the 16384-character total limit",
    },
  );
  assert.equal(
    inspectServerLegend(provider(Array.from({ length: 128 }, () => "x".repeat(128)))).kind,
    "valid",
    "exactly-at-limit entries and total text are accepted",
  );
  assert.equal(
    inspectServerLegend(provider(Array.from({ length: 256 }, (_, index) => `t${index}`))).kind,
    "valid",
    "exactly 256 entries are accepted",
  );
});

test("matching legends produce no comparison result", () => {
  assert.equal(compareLegends(declared, [...declared]), undefined);
});

test("duplicate server legend entries are rejected, including a duplicate appended at the end", () => {
  const comparison = compareLegends(declared, [...declared, declared[0]]);
  assert.deepEqual(comparison.duplicateFromServer, [declared[0]]);
  assert.equal(comparison.orderChanged, false);
  assert.match(describeLegendComparison(comparison), /server legend repeats elisa-type-user/);
});

test("legacy and canonical aliases that normalize to one token type count as duplicates", () => {
  const comparison = compareLegends(declared, [
    "elisa-type-user",
    "elisa.type.user",
    "elisa.enum.variant",
    "elisa.fn.def",
  ]);
  assert.deepEqual(comparison.duplicateFromServer, ["elisa-type-user"]);
});

test("duplicate contributed IDs are reported as a client-side compatibility defect", () => {
  const comparison = compareLegends([...declared, declared[0]], [...declared, declared[0]]);
  assert.deepEqual(comparison.duplicateInClient, [declared[0]]);
  assert.deepEqual(comparison.duplicateFromServer, [declared[0]]);
  assert.match(describeLegendComparison(comparison), /client contribution repeats/);
});

test("missing and unexpected server entries are reported separately", () => {
  const comparison = compareLegends(declared, [
    "elisa-type-user",
    "elisa-fn-def",
    "elisa-extra-kind",
  ]);
  assert.deepEqual(comparison.missingFromServer, ["elisa-enum-variant"]);
  assert.deepEqual(comparison.unexpectedFromServer, ["elisa-extra-kind"]);
  const description = describeLegendComparison(comparison);
  assert.match(description, /missing elisa-enum-variant/);
  assert.match(description, /added elisa-extra-kind/);
});

test("legacy dotted wire legends map to valid contribution IDs without losing order checks", () => {
  assert.equal(
    compareLegends(declared, ["elisa.type.user", "elisa.enum.variant", "elisa.fn.def"]),
    undefined,
  );
  const reorderedLegacy = compareLegends(declared, [
    "elisa.enum.variant",
    "elisa.type.user",
    "elisa.fn.def",
  ]);
  assert.equal(reorderedLegacy.orderChanged, true);
});

test("reordered legends are treated as incompatible", () => {
  const comparison = compareLegends(declared, [
    "elisa-enum-variant",
    "elisa-type-user",
    "elisa-fn-def",
  ]);
  assert.equal(comparison.orderChanged, true);
  assert.match(describeLegendComparison(comparison), /order differs/);
});

test("an explicitly empty server legend is incompatible with contributed token types", () => {
  const comparison = compareLegends(declared, []);
  assert.deepEqual(comparison.missingFromServer, declared);
  assert.equal(comparison.unexpectedFromServer.length, 0);
});

test("an absent server legend is not treated as a mismatch", () => {
  assert.equal(compareLegends(declared, undefined), undefined);
  assert.equal(compareLegends([], []), undefined);
});

test("initialization compatibility accepts an exact legacy mapping and ignores an absent provider", () => {
  const clientManifest = {
    contributes: { semanticTokenTypes: declared.map((id) => ({ id })) },
  };
  assert.equal(
    semanticLegendCompatibilityIssue(clientManifest, {
      capabilities: {
        semanticTokensProvider: {
          legend: {
            tokenTypes: ["elisa.type.user", "elisa.enum.variant", "elisa.fn.def"],
            tokenModifiers: [],
          },
        },
      },
    }),
    undefined,
  );
  assert.equal(
    semanticLegendCompatibilityIssue(clientManifest, { capabilities: { hoverProvider: true } }),
    undefined,
  );
});

test("initialization compatibility returns a degradation reason for invalid server legend data", () => {
  const reason = semanticLegendCompatibilityIssue(
    { contributes: { semanticTokenTypes: declared.map((id) => ({ id })) } },
    {
      capabilities: {
        semanticTokensProvider: {
          legend: { tokenTypes: ["elisa-type-user", null], tokenModifiers: [] },
        },
      },
    },
  );
  assert.equal(
    reason,
    "server semantic token legend is malformed: server semantic tokenTypes entry 1 must be a non-empty string",
  );
});
