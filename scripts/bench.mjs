import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { loadElisaGrammar, tokenizeFile } from "../test/helpers/grammar.mjs";
import discovery from "../out/serverDiscovery.js";

const { NodeFileProbe, resolveServer } = discovery;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function percentile(sorted, fraction) {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[index];
}

function summarize(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    samples: sorted.length,
    p50: Number(percentile(sorted, 0.5).toFixed(3)),
    p95: Number(percentile(sorted, 0.95).toFixed(3)),
    p99: Number(percentile(sorted, 0.99).toFixed(3)),
    max: Number(sorted.at(-1).toFixed(3)),
    mean: Number((total / sorted.length).toFixed(3)),
  };
}

async function timeOperation(operation, iterations) {
  const samples = [];
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    await operation();
    samples.push(performance.now() - started);
  }
  return summarize(samples);
}

function generateSource(lines) {
  const output = [];
  for (let index = 0; index < lines; index += 4) {
    output.push(`def fn_${index}(a: i64, b: u32) -> bool:`);
    output.push(`    x: mutable f64 = ${index}.5`);
    output.push(`    if a > ${index}:`);
    output.push(`        return true`);
    output.push(`    return false`);
  }
  return output.join("\n");
}

const grammar = await loadElisaGrammar();

const fixtureTimings = await timeOperation(() => {
  tokenizeFile(grammar, "enum Event:\n    None\n    Resize(size: i64)\n");
}, 200);

const scaling = [];
for (const lines of [2000, 4000, 8000]) {
  const source = generateSource(lines);
  const timing = await timeOperation(() => {
    tokenizeFile(grammar, source);
  }, 20);
  scaling.push({ lines: source.split("\n").length, ...timing });
}

const workspace = mkdtempSync(join(tmpdir(), "elisa-bench-"));
let discoveryWarm;
try {
  mkdirSync(join(workspace, "build"), { recursive: true });
  const server = join(workspace, "build", "elisa-lsp");
  writeFileSync(server, "#!/bin/sh\nexit 0\n");
  chmodSync(server, 0o755);
  const options = {
    configuredPath: "",
    environmentPath: "",
    workspaceRoots: [workspace],
    extensionPath: root,
    homeDirectory: tmpdir(),
    platform: process.platform,
    environmentPathValue: "",
    pathDelimiter: ":",
    trusted: true,
  };
  discoveryWarm = await timeOperation(async () => {
    await resolveServer(options, { probe: new NodeFileProbe(), concurrency: 4 });
  }, 50);
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

const report = {
  machine: {
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    revision: (() => {
      try {
        return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
          cwd: root,
          encoding: "utf8",
        }).trim();
      } catch {
        return "unknown";
      }
    })(),
    profile: "release",
  },
  grammar: {
    unit: "milliseconds per full tokenization",
    smallFixture: fixtureTimings,
    scaling,
  },
  discovery: {
    unit: "milliseconds per full resolution against a warm fake workspace",
    warm: discoveryWarm,
  },
};

console.log(JSON.stringify(report, null, 2));
