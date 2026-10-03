import assert from "node:assert/strict";
import test from "node:test";
import { measureOperation, summarize } from "../scripts/benchMetrics.mjs";

test("benchmark summaries use nearest-rank quantiles and population deviation", () => {
  assert.deepEqual(summarize([4, 1, 3, 2]), {
    samples: 4,
    min: 1,
    p50: 2,
    p95: 4,
    p99: 4,
    max: 4,
    mean: 2.5,
    standardDeviation: 1.118,
  });
});

test("benchmark summaries reject empty, negative, and non-finite samples", () => {
  assert.throws(() => summarize([]), /non-empty/);
  assert.throws(() => summarize([1, -1]), /non-negative/);
  assert.throws(() => summarize([1, Number.NaN]), /finite/);
  assert.throws(() => summarize([Number.MAX_VALUE, Number.MAX_VALUE]), /total exceeds/);
});

test("operation timing separates first run and explicit warmups from samples", async () => {
  let calls = 0;
  let validated = 0;
  let timestamp = 0;
  const result = await measureOperation(() => {
    calls += 1;
    return calls;
  }, {
    iterations: 3,
    warmupIterations: 2,
    validateResult: (value) => {
      assert.equal(value, ++validated);
    },
    now: () => {
      timestamp += 2;
      return timestamp;
    },
  });

  assert.equal(calls, 6); // one cold run, two warmups, three measured runs
  assert.equal(validated, calls);
  assert.equal(result.coldMs, 2);
  assert.equal(result.warmupIterations, 2);
  assert.equal(result.samples, 3);
  assert.equal(result.p50, 2);
});

test("operation timing validates counts and rejects non-monotonic clocks", async () => {
  await assert.rejects(measureOperation(() => {}, { iterations: 0 }), /iterations/);
  await assert.rejects(
    measureOperation(() => {}, { iterations: 1, warmupIterations: -1 }),
    /warmupIterations/,
  );
  await assert.rejects(
    measureOperation(() => "invalid", {
      iterations: 1,
      warmupIterations: 0,
      validateResult: () => { throw new Error("bad response"); },
    }),
    /bad response/,
  );
  let calls = 0;
  await assert.rejects(
    measureOperation(() => {}, {
      iterations: 1,
      warmupIterations: 0,
      now: () => (calls++ === 0 ? 10 : 9),
    }),
    /monotonic/,
  );
});
