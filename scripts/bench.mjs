import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { cpus, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import {
  loadElisaGrammar,
  loadMarkdownGrammar,
  tokenizeFile,
} from "../test/helpers/grammar.mjs";
import { inspectLspBuild } from "./lspBuildInfo.mjs";
import {
  assertBuildSnapshotUnchanged,
  serverBuildBenchmarkGate,
} from "./benchBuildGate.mjs";
import { createStdioClient } from "./lspBenchmarkClient.mjs";
import {
  analysisCounters,
  assertAnalysisUnchanged,
  waitForAnalysisReady,
} from "./benchAnalysisReadiness.mjs";
import { measureOperation, summarize } from "./benchMetrics.mjs";
import {
  assertHoverResponse,
  assertJsonRpcResult,
  assertSemanticTokensResponse,
  shutdownAndStop,
} from "./benchProtocol.mjs";
import discovery from "../out/serverDiscovery.js";

const { NodeFileProbe, resolveServer } = discovery;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function extensionSourceSnapshot() {
  try {
    const revision = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    const status = execFileSync("git", ["status", "--porcelain", "-z", "--untracked-files=all"], {
      cwd: root,
    });
    return {
      revision,
      dirty: status.length > 0,
      statusSha256: sha256(status),
    };
  } catch {
    return { revision: "unknown", dirty: null, statusSha256: null };
  }
}

const extensionSourceAtStart = extensionSourceSnapshot();

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

function generateMarkdownSource(lines) {
  return ["Markdown fence benchmark.", "```elisa", generateSource(lines), "```", ""].join("\n");
}

const serverBinary = resolve(root, "..", "Elisa-LSP", "build", "elisa-lsp");
const lspRoot = resolve(root, "..", "Elisa-LSP");

async function benchServer() {
  const build = inspectLspBuild(lspRoot);
  const gate = serverBuildBenchmarkGate(build);
  if (!gate.available) {
    return {
      ...gate,
      binarySha256: build.binarySha256,
    };
  }
  const ready = [];
  for (let index = 0; index < 5; index += 1) {
    const started = performance.now();
    const client = createStdioClient(serverBinary);
    let initialized = false;
    let primaryError;
    try {
      const response = await client.request("initialize", { capabilities: {} });
      const result = assertJsonRpcResult(response, "initialize");
      client.notify("initialized", {});
      initialized = true;
      if (!result || typeof result !== "object") {
        throw new Error("initialize result is not an object");
      }
      ready.push(performance.now() - started);
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      try {
        if (initialized) {
          await shutdownAndStop(client);
        } else {
          await client.stop();
        }
      } catch (error) {
        if (!primaryError) {
          throw error;
        }
      }
    }
  }

  const client = createStdioClient(serverBinary);
  let initialized = false;
  let primaryError;
  try {
    const initialize = await client.request("initialize", { capabilities: {} });
    const initializeResult = assertJsonRpcResult(initialize, "initialize");
    client.notify("initialized", {});
    initialized = true;
    if (!initializeResult || typeof initializeResult !== "object") {
      throw new Error("initialize result is not an object");
    }
    const tokenTypes = initializeResult.capabilities?.semanticTokensProvider?.legend?.tokenTypes;
    const tokenModifiers = initializeResult.capabilities?.semanticTokensProvider?.legend?.tokenModifiers;
    if (!Array.isArray(tokenTypes) || tokenTypes.length === 0 || !Array.isArray(tokenModifiers)) {
      throw new Error("initialize response has no valid semantic-token legend");
    }
    const readAnalysisStats = async () => {
      const response = await client.request("$/elisa/stats", {});
      if (response.error || !response.result) {
        throw new Error(`$/elisa/stats failed: ${JSON.stringify(response.error ?? response)}`);
      }
      return response.result;
    };
    const uri = "file:///bench.elisa";
    const source = generateSource(600);
    const countersBeforeOpen = analysisCounters(await readAnalysisStats());
    const analysisStarted = performance.now();
    client.notify("textDocument/didOpen", {
      textDocument: { uri, languageId: "Elisa", version: 1, text: source },
    });
    const ready = await waitForAnalysisReady(readAnalysisStats, countersBeforeOpen, {
      startedAt: analysisStarted,
    });
    const tokens = await measureOperation(
      () => client.request("textDocument/semanticTokens/full", { textDocument: { uri } }),
      {
        iterations: 30,
        warmupIterations: 10,
        validateResult: (response) => assertSemanticTokensResponse(response, {
          source,
          tokenTypeCount: tokenTypes.length,
          modifierCount: tokenModifiers.length,
        }),
      },
    );
    const analysisAfterSemanticTokens = analysisCounters(await readAnalysisStats());
    assertAnalysisUnchanged(ready.counters, analysisAfterSemanticTokens, "semantic-token requests");
    const hover = await measureOperation(
      () =>
        client.request("textDocument/hover", {
          textDocument: { uri },
          position: { line: 0, character: 5 },
        }),
      {
        iterations: 30,
        warmupIterations: 10,
        validateResult: (response) => assertHoverResponse(response, { allowNull: false }),
      },
    );
    const analysisAfterHover = analysisCounters(await readAnalysisStats());
    assertAnalysisUnchanged(ready.counters, analysisAfterHover, "hover requests");
    return {
      available: true,
      measurementStatus: "release binary and source fingerprints remained stable throughout server measurements",
      provenance: {
        builtAtUtc: build.manifest.built_at_utc,
        profile: build.manifest.profile,
        lspRevision: build.manifest.lsp_rev,
        lspInputsSha256: build.manifest.lsp_inputs_sha256,
        compilerRevision: build.manifest.compiler_rev,
        compilerSourcesSha256: build.manifest.compiler_sources_sha256,
        compilerDirty: build.manifest.compiler_dirty,
        compilerStatusSha256: build.manifest.compiler_status_sha256,
        stage0CompilerSha256: build.manifest.elisac_sha256,
        lspDirty: build.manifest.lsp_dirty,
        lspStatusSha256: build.manifest.lsp_status_sha256,
        binarySha256: build.binarySha256,
      },
      sourceSha256: sha256(source),
      sourceLines: source.split("\n").length,
      serverReady: {
        state: "cold process start plus initialize; each sample is a separate process",
        warmupIterations: 0,
        ...summarize(ready),
      },
      analysisReady: {
        state: "didOpen to observed tokenize/parse/check counter increment",
        elapsedMs: ready.elapsedMs,
        pollIntervalMs: ready.pollIntervalMs,
        polls: ready.polls,
      },
      semanticTokens: tokens,
      hover,
      analysisCounters: {
        beforeOpen: countersBeforeOpen,
        afterAnalysisReady: ready.counters,
        afterSemanticTokens: analysisAfterSemanticTokens,
        afterHover: analysisAfterHover,
      },
    };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      if (initialized) {
        await shutdownAndStop(client);
      } else {
        await client.stop();
      }
    } catch (error) {
      if (!primaryError) {
        throw error;
      }
    }
    if (!primaryError) {
      assertBuildSnapshotUnchanged(build, inspectLspBuild(lspRoot));
    }
  }
}

const grammar = await loadElisaGrammar();

const smallGrammarSource = "enum Event:\n    None\n    Resize(size: i64)\n";
const fixtureTimings = await measureOperation(() => {
  tokenizeFile(grammar, smallGrammarSource);
}, { iterations: 200, warmupIterations: 20 });

const scaling = [];
for (const lines of [2000, 4000, 8000]) {
  const source = generateSource(lines);
  const timing = await measureOperation(() => {
    tokenizeFile(grammar, source);
  }, { iterations: 20, warmupIterations: 5 });
  scaling.push({ lines: source.split("\n").length, sourceSha256: sha256(source), ...timing });
}

const markdownGrammarPath = process.env.VSCODE_MARKDOWN_GRAMMAR;
const markdownGrammar = await loadMarkdownGrammar(markdownGrammarPath);
const markdownScaling = [];
for (const lines of [1000, 2000, 4000]) {
  const source = generateMarkdownSource(lines);
  const timing = await measureOperation(() => {
    tokenizeFile(markdownGrammar, source);
  }, { iterations: 20, warmupIterations: 5 });
  markdownScaling.push({ lines: source.split("\n").length, sourceSha256: sha256(source), ...timing });
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
  discoveryWarm = await measureOperation(async () => {
    await resolveServer(options, { probe: new NodeFileProbe(), concurrency: 4 });
  }, { iterations: 50, warmupIterations: 10 });
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

const cpuInfo = cpus();
const extensionSourceAtEnd = extensionSourceSnapshot();
if (JSON.stringify(extensionSourceAtStart) !== JSON.stringify(extensionSourceAtEnd)) {
  throw new Error("extension source/worktree state changed during benchmark; discard the measurements and retry");
}
const report = {
  machine: {
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    cpuModel: cpuInfo[0]?.model ?? "unknown",
    logicalCpuCount: cpuInfo.length || null,
    powerMode: process.env.ELISA_BENCH_POWER_MODE ?? "not-recorded",
    editorVersion: process.env.VSCODE_VERSION ?? null,
    harness: "node-cli; extension-host activation is not measured",
    extensionSource: extensionSourceAtStart,
  },
  grammar: {
    unit: "milliseconds per full tokenization",
    smallFixtureSha256: sha256(smallGrammarSource),
    smallFixture: fixtureTimings,
    scaling,
  },
  markdownFenceGrammar: {
    unit: "milliseconds per full Markdown document tokenization",
    hostGrammar: markdownGrammarPath
      ? "editor-supplied VS Code Markdown grammar"
      : "bundled test-host fixture",
    languageFence: "elisa",
    scaling: markdownScaling,
  },
  discovery: {
    unit: "milliseconds per full resolution against a warm fake workspace",
    fixtureSha256: sha256("#!/bin/sh\nexit 0\n"),
    warm: discoveryWarm,
  },
  server: await benchServer(),
};

const outputOption = process.argv.indexOf("--out");
let capturePath;
if (outputOption !== -1) {
  const value = process.argv[outputOption + 1];
  if (!value || value.startsWith("--")) {
    throw new Error("--out requires a new JSON file path");
  }
  capturePath = resolve(root, value);
  if (!capturePath.toLowerCase().endsWith(".json")) {
    throw new Error("benchmark capture path must end in .json");
  }
}

const serializedReport = `${JSON.stringify(report, null, 2)}\n`;
if (capturePath) {
  writeFileSync(capturePath, serializedReport, { flag: "wx" });
}
console.log(serializedReport.trimEnd());
if (capturePath) {
  console.error(`benchmark capture written: ${capturePath}`);
}
