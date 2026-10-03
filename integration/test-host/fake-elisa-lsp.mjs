#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const extensionRoot = process.env.ELISA_TEST_EXTENSION_ROOT;
if (!extensionRoot) {
  process.stderr.write("ELISA_TEST_EXTENSION_ROOT is required\n");
  process.exit(2);
}

const manifest = JSON.parse(
  readFileSync(resolve(extensionRoot, "package.json"), "utf8"),
);
const legend = manifest.contributes.semanticTokenTypes.map((type) =>
  type.id.replaceAll("-", "."),
);
const maximumFrameBytes = 1024 * 1024;
let input = Buffer.alloc(0);
let markerWritten = false;
let verificationMarkerWritten = false;
let shutdownRequested = false;
const documents = new Map();

function writeMarker(name, value) {
  const marker = process.env[name];
  if (marker) {
    writeFileSync(marker, value);
  }
}

function send(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  process.stdout.write(
    Buffer.concat([
      Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"),
      body,
    ]),
  );
}

function semanticTokens(uri) {
  const text = documents.get(uri) ?? "";
  const lines = text.split(/\r?\n/);
  const family = /^enum ([A-Za-z_][A-Za-z0-9_]*)/.exec(lines[0] ?? "");
  if (!family) {
    return [];
  }
  const familyType = legend.indexOf("elisa.type.user");
  const variantType = legend.indexOf("elisa.enum.variant");
  if (familyType < 0 || variantType < 0) {
    throw new Error("installed manifest is missing a family or enum-variant token type");
  }

  const familyName = family[1];
  const variants = new Set();
  const tokens = [{ line: 0, column: 5, length: familyName.length, type: familyType }];
  let line = 1;
  for (; line < lines.length; line += 1) {
    const variant = /^ {4}([A-Za-z_][A-Za-z0-9_]*)/.exec(lines[line]);
    if (!variant) {
      break;
    }
    variants.add(variant[1]);
    tokens.push({ line, column: 4, length: variant[1].length, type: variantType });
  }

  const familyPattern = new RegExp(`\\b${familyName}\\.([A-Za-z_][A-Za-z0-9_]*)`, "g");
  for (; line < lines.length; line += 1) {
    for (const usage of lines[line].matchAll(familyPattern)) {
      if (!variants.has(usage[1])) {
        continue;
      }
      const column = usage.index;
      tokens.push({ line, column, length: familyName.length, type: familyType });
      tokens.push({
        line,
        column: column + familyName.length + 1,
        length: usage[1].length,
        type: variantType,
      });
    }
  }

  tokens.sort((left, right) => left.line - right.line || left.column - right.column);
  const data = [];
  let previousLine = 0;
  let previousColumn = 0;
  for (const token of tokens) {
    const deltaLine = token.line - previousLine;
    const deltaColumn = deltaLine === 0 ? token.column - previousColumn : token.column;
    data.push(deltaLine, deltaColumn, token.length, token.type, 0);
    previousLine = token.line;
    previousColumn = token.column;
  }
  return data;
}

function handle(message) {
  if (message.method === "exit") {
    if (!shutdownRequested) {
      process.stderr.write("fake LSP received exit before shutdown\n");
      process.exit(1);
    }
    writeMarker("ELISA_TEST_SERVER_EXIT_MARKER", String(process.pid));
    process.exit(0);
  }
  if (message.method === "textDocument/didOpen") {
    const document = message.params?.textDocument;
    if (typeof document?.uri === "string" && typeof document.text === "string") {
      documents.set(document.uri, document.text);
    }
    return;
  }
  if (message.method === "textDocument/didChange") {
    const uri = message.params?.textDocument?.uri;
    const changes = message.params?.contentChanges;
    const latest = Array.isArray(changes) ? changes.at(-1) : undefined;
    if (typeof uri === "string" && typeof latest?.text === "string") {
      documents.set(uri, latest.text);
    }
    return;
  }
  if (message.method === "textDocument/didClose") {
    const uri = message.params?.textDocument?.uri;
    if (typeof uri === "string") {
      documents.delete(uri);
    }
    return;
  }
  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        capabilities: {
          textDocumentSync: { openClose: true, change: 1 },
          semanticTokensProvider: {
            legend: { tokenTypes: legend, tokenModifiers: [] },
            full: true,
          },
          hoverProvider: true,
        },
        serverInfo: { name: "fake-elisa-lsp", version: "integration-test" },
      },
    });
    return;
  }
  if (message.method === "initialized") {
    writeMarker("ELISA_TEST_SERVER_INITIALIZED_MARKER", String(process.pid));
    return;
  }
  if (message.method === "shutdown") {
    shutdownRequested = true;
    writeMarker("ELISA_TEST_SERVER_SHUTDOWN_MARKER", String(process.pid));
    send({ jsonrpc: "2.0", id: message.id, result: null });
    return;
  }
  if (message.method === "workspace/configuration") {
    const items = message.params?.items;
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: Array.isArray(items) ? items.map(() => null) : [],
    });
    return;
  }
  if (message.method === "textDocument/semanticTokens/full") {
    if (!markerWritten && process.env.ELISA_TEST_SERVER_MARKER) {
      writeMarker("ELISA_TEST_SERVER_MARKER", String(process.pid));
      markerWritten = true;
    }
    const uri = message.params?.textDocument?.uri;
    if (
      !verificationMarkerWritten &&
      documents.get(uri)?.startsWith("enum Verify:")
    ) {
      writeMarker("ELISA_TEST_SERVER_VERIFICATION_MARKER", String(process.pid));
      verificationMarkerWritten = true;
    }
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: { data: semanticTokens(uri) },
    });
    return;
  }
  if (message.method === "textDocument/hover") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: { contents: { kind: "plaintext", value: "fake hover response" } },
    });
    return;
  }
  if (message.id !== undefined) {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: null,
    });
  }
}

process.stdin.on("data", (chunk) => {
  input = Buffer.concat([input, Buffer.from(chunk)]);
  for (;;) {
    const headerEnd = input.indexOf("\r\n\r\n");
    if (headerEnd < 0) {
      if (input.length > 4096) {
        process.stderr.write("oversized fake LSP header\n");
        process.exit(3);
      }
      return;
    }
    if (headerEnd > 4096) {
      process.stderr.write("oversized fake LSP header\n");
      process.exit(3);
    }
    const header = input.subarray(0, headerEnd).toString("ascii");
    const match = /^Content-Length:\s*(\d+)\s*$/im.exec(header);
    const length = match ? Number(match[1]) : Number.NaN;
    if (!Number.isSafeInteger(length) || length < 0 || length > maximumFrameBytes) {
      process.stderr.write("invalid fake LSP Content-Length\n");
      process.exit(3);
    }
    const bodyStart = headerEnd + 4;
    if (input.length < bodyStart + length) {
      return;
    }
    const body = input.subarray(bodyStart, bodyStart + length).toString("utf8");
    input = input.subarray(bodyStart + length);
    handle(JSON.parse(body));
  }
});
