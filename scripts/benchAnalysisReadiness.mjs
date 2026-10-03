import { performance } from "node:perf_hooks";

const ANALYSIS_COUNTERS = ["tokenize_calls", "parse_calls", "check_calls"];

export function analysisCounters(stats) {
  const counters = stats?.analysis;
  if (
    !counters ||
    ANALYSIS_COUNTERS.some((name) => !Number.isSafeInteger(counters[name]) || counters[name] < 0)
  ) {
    throw new Error("LSP stats response is missing valid analysis counters");
  }
  return Object.fromEntries(ANALYSIS_COUNTERS.map((name) => [name, counters[name]]));
}

export function assertSingleAnalysis(before, after) {
  for (const name of ANALYSIS_COUNTERS) {
    if (!Number.isSafeInteger(before?.[name]) || !Number.isSafeInteger(after?.[name])) {
      throw new Error(`invalid ${name} analysis counter`);
    }
    if (after[name] !== before[name] + 1) {
      throw new Error(
        `expected exactly one ${name} during didOpen analysis; saw ${after[name] - before[name]}`,
      );
    }
  }
}

export function assertAnalysisUnchanged(expected, actual, phase) {
  for (const name of ANALYSIS_COUNTERS) {
    if (!Number.isSafeInteger(expected?.[name]) || !Number.isSafeInteger(actual?.[name])) {
      throw new Error(`invalid ${name} analysis counter during ${phase}`);
    }
    if (actual[name] !== expected[name]) {
      throw new Error(`${phase} unexpectedly changed ${name}: ${expected[name]} -> ${actual[name]}`);
    }
  }
}

export async function waitForAnalysisReady(readStats, before, {
  timeoutMs = 30_000,
  pollIntervalMs = 5,
  startedAt = performance.now(),
  now = () => performance.now(),
  delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  if (typeof readStats !== "function" || typeof now !== "function" || typeof delay !== "function") {
    throw new TypeError("readStats, now, and delay must be functions");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("timeoutMs must be a finite positive number");
  }
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new RangeError("pollIntervalMs must be a finite positive number");
  }
  if (!Number.isFinite(startedAt)) {
    throw new RangeError("startedAt must be a finite timestamp");
  }
  analysisCounters({ analysis: before });

  let polls = 0;
  let previousTime = now();
  if (!Number.isFinite(previousTime) || previousTime < startedAt) {
    throw new RangeError("clock must return finite timestamps no earlier than startedAt");
  }
  while (previousTime - startedAt < timeoutMs) {
    await delay(pollIntervalMs);
    const stats = await readStats();
    polls += 1;
    const currentTime = now();
    if (!Number.isFinite(currentTime) || currentTime < previousTime) {
      throw new RangeError("clock must return monotonic finite timestamps");
    }
    previousTime = currentTime;
    if (currentTime - startedAt >= timeoutMs) {
      break;
    }
    if (!stats) {
      continue;
    }
    const current = analysisCounters(stats);
    if (current.parse_calls > before.parse_calls || current.check_calls > before.check_calls) {
      assertSingleAnalysis(before, current);
      return {
        elapsedMs: Number((currentTime - startedAt).toFixed(3)),
        pollIntervalMs,
        polls,
        counters: current,
      };
    }
  }
  throw new Error(`LSP analysis did not complete within ${timeoutMs} ms after didOpen`);
}
