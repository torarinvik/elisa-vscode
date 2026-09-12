import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

function createStdioClient(executable) {
  const child = spawn(executable, [], { stdio: ["pipe", "pipe", "pipe"] });
  let buffer = Buffer.alloc(0);
  const pending = new Map();
  let nextId = 1;
  const closed = new Promise((resolveClose) => child.on("close", resolveClose));

  child.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        return;
      }
      const header = buffer.slice(0, headerEnd).toString("ascii");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        buffer = buffer.slice(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      if (buffer.length < headerEnd + 4 + length) {
        return;
      }
      const body = buffer.slice(headerEnd + 4, headerEnd + 4 + length).toString("utf8");
      buffer = buffer.slice(headerEnd + 4 + length);
      let message;
      try {
        message = JSON.parse(body);
      } catch {
        continue;
      }
      if (message.id !== undefined && pending.has(message.id)) {
        const entry = pending.get(message.id);
        pending.delete(message.id);
        entry.resolve(message);
      }
    }
  });

  function send(payload) {
    const body = Buffer.from(JSON.stringify(payload), "utf8");
    child.stdin.write(
      Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]),
    );
  }

  return {
    request(method, params) {
      const id = nextId++;
      send({ jsonrpc: "2.0", id, method, params });
      return new Promise((resolveRequest) => pending.set(id, { resolve: resolveRequest }));
    },
    notify(method, params) {
      send({ jsonrpc: "2.0", method, params });
    },
    async stop() {
      try {
        send({ jsonrpc: "2.0", method: "exit" });
      } catch {
        void 0;
      }
      child.kill("SIGTERM");
      await closed;
    },
  };
}

const serverBinary = resolve(root, "..", "Elisa-LSP", "build", "elisa-lsp");

async function benchServer() {
  if (!existsSync(serverBinary)) {
    return { available: false, reason: `missing ${serverBinary}; build the sibling server first` };
  }
  const ready = [];
  for (let index = 0; index < 5; index += 1) {
    const started = performance.now();
    const client = createStdioClient(serverBinary);
    await client.request("initialize", {});
    ready.push(performance.now() - started);
    await client.stop();
  }

  const client = createStdioClient(serverBinary);
  await client.request("initialize", {});
  const uri = "file:///bench.elisa";
  const source = generateSource(600);
  client.notify("textDocument/didOpen", {
    textDocument: { uri, languageId: "Elisa", version: 1, text: source },
  });
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  const tokens = await timeOperation(
    () => client.request("textDocument/semanticTokens/full", { textDocument: { uri } }),
    30,
  );
  const hover = await timeOperation(
    () =>
      client.request("textDocument/hover", {
        textDocument: { uri },
        position: { line: 0, character: 4 },
      }),
    30,
  );
  await client.stop();
  return { available: true, sourceLines: source.split("\n").length, serverReady: summarize(ready), semanticTokens: tokens, hover };
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
  server: await benchServer(),
};

console.log(JSON.stringify(report, null, 2));
