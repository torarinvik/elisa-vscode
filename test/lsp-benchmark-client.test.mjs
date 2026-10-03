import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { createStdioClient } from "../scripts/lspBenchmarkClient.mjs";

function nodeClient(source, options = {}) {
  return createStdioClient(process.execPath, ["-e", source], options);
}

const echoServer = `
let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const end = buffer.indexOf("\\r\\n\\r\\n");
    if (end < 0) return;
    const header = buffer.subarray(0, end).toString("ascii");
    const length = Number(/Content-Length:\\s*(\\d+)/i.exec(header)?.[1]);
    if (!Number.isSafeInteger(length) || buffer.length < end + 4 + length) return;
    const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString("utf8"));
    buffer = buffer.subarray(end + 4 + length);
    if (message.method === "exit") process.exit(0);
    if (message.id !== undefined) {
      const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { ok: true } }));
      process.stdout.write(Buffer.concat([Buffer.from("Content-Length: " + body.length + "\\r\\n\\r\\n"), body]));
    }
  }
});
`;

test("benchmark client frames requests and shuts down cleanly", async () => {
  const client = nodeClient(echoServer, { requestTimeoutMs: 500, shutdownGraceMs: 100 });
  let exit;
  try {
    const response = await client.request("initialize", { capabilities: {} });
    assert.deepEqual(response.result, { ok: true });
  } finally {
    exit = await client.stop();
  }
  assert.deepEqual(exit, { code: 0, signal: null });
});

test("benchmark client rejects pending requests promptly when the process exits", async () => {
  const client = nodeClient('process.stdin.on("data", () => process.exit(7));', {
    requestTimeoutMs: 1000,
    shutdownGraceMs: 100,
  });
  try {
    const started = performance.now();
    await assert.rejects(client.request("initialize", {}), /closed before answering requests/);
    assert.ok(performance.now() - started < 800, "child exit is not mistaken for a request timeout");
  } finally {
    await client.stop();
  }
});

test("benchmark client times out and kills an unresponsive process", async () => {
  const client = nodeClient("setInterval(() => {}, 1000);", {
    requestTimeoutMs: 60,
    shutdownGraceMs: 100,
  });
  const started = performance.now();
  await assert.rejects(client.request("initialize", {}), /timed out after 60 ms/);
  await client.stop();
  assert.ok(performance.now() - started < 1000, "timeout cleanup reaps the server promptly");
});

test("benchmark client bounds protocol output and rejects malformed JSON", async () => {
  const oversized = nodeClient(
    "process.stdout.write(Buffer.alloc(6000, 65)); setInterval(() => {}, 1000);",
    { maximumFrameBytes: 1024, requestTimeoutMs: 500, shutdownGraceMs: 100 },
  );
  await assert.rejects(oversized.request("initialize", {}), /output exceeded 1024 bytes/);
  await oversized.stop();

  const malformed = nodeClient(
    'process.stdin.once("data", () => process.stdout.write("Content-Length: 3\\r\\n\\r\\nabc"));',
    { requestTimeoutMs: 500, shutdownGraceMs: 100 },
  );
  await assert.rejects(malformed.request("initialize", {}), /invalid JSON/);
  await malformed.stop();
});

test("benchmark client reports process-spawn errors without waiting for the timeout", async () => {
  const executable = join(tmpdir(), `missing-elisa-server-${randomUUID()}`);
  const client = createStdioClient(executable, [], {
    requestTimeoutMs: 1000,
    shutdownGraceMs: 100,
  });
  try {
    await assert.rejects(client.request("initialize", {}), /ENOENT|spawn/);
  } finally {
    await client.stop();
  }
});
