import assert from "node:assert/strict";
import test from "node:test";
import {
  analysisCounters,
  assertAnalysisUnchanged,
  assertSingleAnalysis,
  waitForAnalysisReady,
} from "../scripts/benchAnalysisReadiness.mjs";

const counters = (tokenize, parse, check) => ({
  analysis: { tokenize_calls: tokenize, parse_calls: parse, check_calls: check },
});

test("LSP benchmark observes completed analysis and requires one frontend pass", async () => {
  const before = { tokenize_calls: 0, parse_calls: 0, check_calls: 0 };
  let timestamp = 100;
  let readCount = 0;
  const ready = await waitForAnalysisReady(async () => {
    readCount += 1;
    return readCount === 1 ? counters(0, 0, 0) : counters(1, 1, 1);
  }, before, {
    startedAt: 100,
    timeoutMs: 100,
    pollIntervalMs: 5,
    now: () => timestamp,
    delay: async (ms) => { timestamp += ms; },
  });

  assert.equal(ready.elapsedMs, 10);
  assert.equal(ready.polls, 2);
  assert.deepEqual(ready.counters, { tokenize_calls: 1, parse_calls: 1, check_calls: 1 });
});

test("LSP benchmark rejects duplicate passes, partial stats, and repeated provider analysis", async () => {
  const before = { tokenize_calls: 0, parse_calls: 0, check_calls: 0 };
  await assert.rejects(waitForAnalysisReady(async () => counters(2, 1, 1), before, {
    startedAt: 0,
    timeoutMs: 100,
    now: () => 1,
    delay: async () => {},
  }), /exactly one tokenize_calls/);
  assert.throws(() => analysisCounters({ analysis: { parse_calls: 1 } }), /missing valid/);
  assert.throws(
    () => assertSingleAnalysis(before, { tokenize_calls: 1, parse_calls: 1, check_calls: 0 }),
    /exactly one check_calls/,
  );
  assert.throws(
    () => assertAnalysisUnchanged(before, { tokenize_calls: 0, parse_calls: 1, check_calls: 0 }, "hover"),
    /hover unexpectedly changed parse_calls/,
  );
});

test("LSP readiness polling has a bounded timeout", async () => {
  const before = { tokenize_calls: 0, parse_calls: 0, check_calls: 0 };
  let timestamp = 0;
  let polls = 0;
  await assert.rejects(waitForAnalysisReady(async () => {
    polls += 1;
    return counters(0, 0, 0);
  }, before, {
    startedAt: 0,
    timeoutMs: 10,
    pollIntervalMs: 5,
    now: () => timestamp,
    delay: async (ms) => { timestamp += ms; },
  }), /did not complete within 10 ms/);
  assert.equal(polls, 2);
});
