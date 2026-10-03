import assert from "node:assert/strict";
import test from "node:test";
import {
  assertHoverResponse,
  assertJsonRpcResult,
  assertSemanticTokensResponse,
  shutdownAndStop,
} from "../scripts/benchProtocol.mjs";

test("benchmark protocol validation accepts well-formed results", () => {
  const response = { result: { data: [0, 0, 4, 1, 0, 1, 2, 3, 2, 1] } };
  assertSemanticTokensResponse(response, {
    source: "word\n  foo",
    tokenTypeCount: 3,
    modifierCount: 1,
  });
  assert.equal(assertJsonRpcResult({ result: null }, "optional"), null);
  assertHoverResponse({ result: null });
  assert.throws(() => assertHoverResponse({ result: null }, { allowNull: false }), /expected a hover result/);
  assertHoverResponse({ result: { contents: "text" } });
  assertHoverResponse({ result: { contents: { kind: "markdown", value: "text" } } });
  assertHoverResponse({ result: { contents: [{ language: "elisa", value: "text" }] } });
});

test("benchmark protocol validation rejects malformed semantic-token results", () => {
  const options = { source: "word\n  foo", tokenTypeCount: 3, modifierCount: 1 };
  assert.throws(() => assertSemanticTokensResponse({ error: { code: -1 } }, options), /failed/);
  assert.throws(() => assertSemanticTokensResponse({ result: { data: [] } }, options), /non-empty/);
  assert.throws(() => assertSemanticTokensResponse({ result: { data: [0, 0, 4, 3, 0] } }, options), /absent legend type/);
  assert.throws(() => assertSemanticTokensResponse({ result: { data: [0, 0, 4, 1, 2] } }, options), /absent modifier bits/);
  assert.throws(() => assertSemanticTokensResponse({ result: { data: [0, 0, 0, 1, 0] } }, options), /empty range/);
  assert.throws(() => assertSemanticTokensResponse({ result: { data: [0, 0, 5, 1, 0] } }, options), /outside the source/);
  assert.throws(() => assertSemanticTokensResponse({ result: { data: [0, 0, 3, 1, 0, 0, 2, 1, 1, 0] } }, options), /overlap/);
  assert.throws(() => assertSemanticTokensResponse({ result: { data: [0, 0, 4, 1] } }, options), /five-integer/);
});

test("benchmark protocol validation rejects malformed hover and response envelopes", () => {
  assert.throws(() => assertHoverResponse({ result: { value: "no contents" } }), /containing contents/);
  assert.throws(() => assertHoverResponse({ result: { contents: { value: 7 } } }), /MarkedString/);
  assert.throws(() => assertJsonRpcResult({}, "missing"), /neither result nor error/);
});

test("benchmark shutdown follows request/exit order and verifies a clean process exit", async () => {
  const calls = [];
  await shutdownAndStop({
    request: async (...args) => {
      calls.push(args);
      return { result: null };
    },
    stop: async () => {
      calls.push(["exit"]);
      return { code: 0, signal: null };
    },
  });
  assert.deepEqual(calls, [["shutdown"], ["exit"]]);
});

test("benchmark shutdown still stops the process when shutdown or exit fails", async () => {
  let stopped = false;
  await assert.rejects(shutdownAndStop({
    request: async () => ({ error: { code: -32602 } }),
    stop: async () => {
      stopped = true;
      return { code: 1, signal: null };
    },
  }), /shutdown failed/);
  assert.equal(stopped, true);
  await assert.rejects(shutdownAndStop({
    request: async () => ({ result: null }),
    stop: async () => ({ code: null, signal: "SIGTERM" }),
  }), /exited uncleanly/);
});
