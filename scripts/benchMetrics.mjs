import { performance } from "node:perf_hooks";

function validateIterations(value, name, { allowZero = false } = {}) {
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${name} must be a safe integer >= ${minimum}`);
  }
}

function rounded(value) {
  return Number(value.toFixed(3));
}

function validateSamples(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new RangeError("samples must be a non-empty array");
  }
  for (const sample of samples) {
    if (typeof sample !== "number" || !Number.isFinite(sample) || sample < 0) {
      throw new RangeError("samples must contain finite, non-negative durations");
    }
  }
}

export function summarize(samples) {
  validateSamples(samples);
  const sorted = [...samples].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total)) {
    throw new RangeError("sample total exceeds finite numeric range");
  }
  const mean = total / sorted.length;
  const variance = sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sorted.length;
  if (!Number.isFinite(variance)) {
    throw new RangeError("sample variance exceeds finite numeric range");
  }
  const percentile = (fraction) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)];
  return {
    samples: sorted.length,
    min: rounded(sorted[0]),
    p50: rounded(percentile(0.5)),
    p95: rounded(percentile(0.95)),
    p99: rounded(percentile(0.99)),
    max: rounded(sorted.at(-1)),
    mean: rounded(mean),
    standardDeviation: rounded(Math.sqrt(variance)),
  };
}

export async function measureOperation(operation, {
  iterations,
  warmupIterations = 10,
  validateResult,
  now = () => performance.now(),
} = {}) {
  if (typeof operation !== "function") {
    throw new TypeError("operation must be a function");
  }
  if (typeof now !== "function") {
    throw new TypeError("now must be a function");
  }
  if (validateResult !== undefined && typeof validateResult !== "function") {
    throw new TypeError("validateResult must be a function when provided");
  }
  validateIterations(iterations, "iterations");
  validateIterations(warmupIterations, "warmupIterations", { allowZero: true });

  const measureOne = async () => {
    const started = now();
    if (!Number.isFinite(started)) {
      throw new RangeError("clock must return finite timestamps");
    }
    const result = await operation();
    const elapsed = now() - started;
    if (!Number.isFinite(elapsed) || elapsed < 0) {
      throw new RangeError("clock must be monotonic and return finite durations");
    }
    validateResult?.(result);
    return elapsed;
  };

  const coldMs = await measureOne();
  for (let index = 0; index < warmupIterations; index += 1) {
    validateResult?.(await operation());
  }
  const samples = [];
  for (let index = 0; index < iterations; index += 1) {
    samples.push(await measureOne());
  }
  return {
    coldMs: rounded(coldMs),
    warmupIterations,
    ...summarize(samples),
  };
}
