import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverBinary = resolve(root, "..", "Elisa-LSP", "build", "elisa-lsp");
const fixturePath = resolve(root, "test", "fixtures", "highlighting", "enum-family.elisa");

const tokenTypes = {
  intSigned: 0,
  typeUser: 6,
  litInt: 8,
  fnDef: 13,
  fnUse: 14,
  bindParam: 16,
  bindLocal: 17,
  flowBranch: 27,
  declSkeleton: 30,
  punctuation: 41,
  enumVariant: 47,
};

function frame(message) {
  const body = Buffer.from(JSON.stringify(message));
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
}

async function semanticTokensFor(uri, text) {
  const messages = Buffer.concat([
    frame({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    frame({
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: {
        textDocument: { uri, languageId: "Elisa", version: 1, text },
      },
    }),
    frame({
      jsonrpc: "2.0",
      id: 2,
      method: "textDocument/semanticTokens/full",
      params: { textDocument: { uri } },
    }),
    frame({ jsonrpc: "2.0", method: "exit" }),
  ]);

  const child = spawn(serverBinary, [], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("language server did not answer in time"));
    }, 20000);
  });
  child.stdin.end(messages);
  try {
    await Promise.race([
      new Promise((resolveClose) => child.on("close", resolveClose)),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }

  const match = stdout.match(/"id":2,"result":\{"data":\[([^\]]*)\]/);
  assert.ok(match, `no semantic token response; stderr: ${stderr.slice(0, 400)}`);
  const data = match[1]
    .split(",")
    .filter((part) => part.trim().length > 0)
    .map(Number);
  assert.equal(data.length % 5, 0);

  const lines = text.split("\n");
  const tokens = [];
  let line = 0;
  let column = 0;
  for (let index = 0; index < data.length; index += 5) {
    const [deltaLine, deltaColumn, length, tokenType, modifiers] = data.slice(
      index,
      index + 5,
    );
    line += deltaLine;
    column = deltaLine === 0 ? column + deltaColumn : deltaColumn;
    tokens.push({
      line,
      column,
      length,
      type: tokenType,
      modifiers,
      text: lines[line].slice(column, column + length),
    });
  }
  return tokens;
}

function tokenAt(tokens, line, column, text) {
  const token = tokens.find(
    (candidate) => candidate.line === line && candidate.column === column,
  );
  assert.ok(token, `expected a token at ${line}:${column} (${text})`);
  assert.equal(token.text, text, `token text at ${line}:${column}`);
  return token;
}

test("compiler-backed classification matches the enum golden fixture", async (t) => {
  if (!existsSync(serverBinary)) {
    t.skip("sibling Elisa-LSP build not present; run ../Elisa-LSP/build.sh");
    return;
  }
  const text = readFileSync(fixturePath, "utf8");
  const tokens = await semanticTokensFor("file:///enum-family.elisa", text);

  for (let index = 1; index < tokens.length; index += 1) {
    const previous = tokens[index - 1];
    const current = tokens[index];
    assert.ok(
      current.line > previous.line ||
        (current.line === previous.line &&
          current.column >= previous.column + previous.length),
      `tokens must be source-ordered and non-overlapping at ${current.line}:${current.column}`,
    );
  }

  assert.equal(tokenAt(tokens, 0, 5, "Event").type, tokenTypes.typeUser);
  for (const [line, name] of [
    [1, "None"],
    [2, "Quit"],
    [3, "Resize"],
    [6, "Move"],
  ]) {
    assert.equal(
      tokenAt(tokens, line, 4, name).type,
      tokenTypes.enumVariant,
      `${name} declaration is an enum variant`,
    );
  }

  assert.equal(tokenAt(tokens, 3, 11, "size").type, tokenTypes.bindLocal);
  assert.equal(tokenAt(tokens, 3, 17, "Size").type, tokenTypes.typeUser);
  assert.notEqual(tokenAt(tokens, 6, 9, "at").type, tokenTypes.enumVariant);
  assert.equal(tokenAt(tokens, 6, 13, "Vec2").type, tokenTypes.typeUser);
  assert.equal(tokenAt(tokens, 5, 5, "PointerEvent").type, tokenTypes.typeUser);
  assert.equal(tokenAt(tokens, 5, 21, "InputEvent").type, tokenTypes.typeUser);

  assert.equal(tokenAt(tokens, 8, 4, "consume").type, tokenTypes.fnDef);
  assert.equal(tokenAt(tokens, 8, 12, "event").type, tokenTypes.bindParam);
  assert.equal(tokenAt(tokens, 8, 19, "Event").type, tokenTypes.typeUser);
  assert.equal(tokenAt(tokens, 8, 29, "i32").type, tokenTypes.intSigned);

  assert.equal(tokenAt(tokens, 10, 8, "Event").type, tokenTypes.typeUser);
  assert.equal(tokenAt(tokens, 10, 14, "None").type, tokenTypes.enumVariant);
  assert.equal(tokenAt(tokens, 12, 8, "Event").type, tokenTypes.typeUser);
  assert.equal(tokenAt(tokens, 12, 14, "Resize").type, tokenTypes.enumVariant);
  assert.notEqual(tokenAt(tokens, 12, 21, "size").type, tokenTypes.enumVariant);

  const uiKey = tokenAt(tokens, 16, 8, "UiKey");
  assert.notEqual(uiKey.type, tokenTypes.enumVariant);
  assert.equal(uiKey.type, tokenTypes.fnUse);
  const method = tokenAt(tokens, 17, 9, "Method");
  assert.notEqual(method.type, tokenTypes.enumVariant);
  assert.equal(method.type, tokenTypes.fnUse);
});
