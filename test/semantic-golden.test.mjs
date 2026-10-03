import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inspectLspBuild } from "../scripts/lspBuildInfo.mjs";
import { createStdioClient } from "../scripts/lspBenchmarkClient.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lspRoot = resolve(root, "..", "Elisa-LSP");
const serverBinary = resolve(lspRoot, "build", "elisa-lsp");
const fixturePath = resolve(root, "test", "fixtures", "highlighting", "enum-family.elisa");
const semanticTypeCount = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
).contributes.semanticTokenTypes.length;

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

async function semanticTokensFor(uri, text) {
  const client = createStdioClient(serverBinary, [], { requestTimeoutMs: 20000 });
  let primaryError;
  try {
    const initialize = await client.request("initialize", {
      capabilities: {},
    });
    assert.equal(
      initialize.error,
      undefined,
      `initialize failed: ${JSON.stringify(initialize.error)}`,
    );
    assert.ok(
      initialize.result?.capabilities?.semanticTokensProvider,
      "server advertises semantic tokens after initialize",
    );
    client.notify("initialized", {});
    client.notify("textDocument/didOpen", {
      textDocument: { uri, languageId: "Elisa", version: 1, text },
    });
    const response = await client.request("textDocument/semanticTokens/full", {
      textDocument: { uri },
    });
    assert.equal(
      response.error,
      undefined,
      `semanticTokens/full failed: ${JSON.stringify(response.error)}`,
    );
    const data = response.result?.data;
    assert.ok(Array.isArray(data), "semantic token response contains an integer array");
    assert.ok(data.every(Number.isSafeInteger), "semantic token data contains only integers");
    assert.equal(data.length % 5, 0);
    return data;
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    let shutdownError;
    try {
      // This LSP validates present params as an object; the protocol's
      // parameterless shutdown request must omit the field entirely.
      const shutdown = await client.request("shutdown");
      if (shutdown.error !== undefined) {
        throw new Error(`shutdown failed: ${JSON.stringify(shutdown.error)}`);
      }
    } catch (error) {
      shutdownError = error;
    }
    let exit;
    try {
      exit = await client.stop();
    } catch (error) {
      shutdownError ??= error;
    }
    if (!primaryError && shutdownError) {
      throw shutdownError;
    }
    if (!primaryError) {
      assert.deepEqual(exit, { code: 0, signal: null }, "server exits cleanly after shutdown");
    }
  }
}

function decodeTokens(data, text) {
  const lines = text.split("\n");
  assert.equal(data.length % 5, 0, "semantic token arrays have five integers per entry");
  const tokens = [];
  let line = 0;
  let column = 0;
  let previousLine = -1;
  let previousEnd = -1;
  for (let index = 0; index < data.length; index += 5) {
    const [deltaLine, deltaColumn, length, tokenType, modifiers] = data.slice(
      index,
      index + 5,
    );
    assert.ok(deltaLine >= 0, "semantic-token line deltas are non-negative");
    assert.ok(deltaColumn >= 0, "semantic-token column deltas are non-negative");
    assert.ok(length > 0, "semantic tokens have positive lengths");
    assert.ok(
      tokenType >= 0 && tokenType < semanticTypeCount,
      `semantic token type ${tokenType} exists in the client legend`,
    );
    assert.ok(modifiers >= 0, "semantic-token modifier bitsets are non-negative");
    line += deltaLine;
    column = deltaLine === 0 ? column + deltaColumn : deltaColumn;
    assert.ok(line < lines.length, `semantic token line ${line} is in the document`);
    assert.ok(
      column + length <= lines[line].length,
      `semantic token range ${line}:${column}+${length} fits its UTF-16 source line`,
    );
    if (line === previousLine) {
      assert.ok(column >= previousEnd, `semantic tokens do not overlap on line ${line}`);
    }
    tokens.push({
      line,
      column,
      length,
      type: tokenType,
      modifiers,
      text: lines[line].slice(column, column + length),
    });
    previousLine = line;
    previousEnd = column + length;
  }
  return tokens;
}

test("semantic-token decoding respects UTF-16 columns and validates ranges", () => {
  const decoded = decodeTokens(
    [0, 7, 4, tokenTypes.typeUser, 0, 1, 8, 4, tokenTypes.typeUser, 0],
    "struct Rect:\n    på: Vec2\n",
  );
  assert.deepEqual(
    decoded.map(({ line, column, text }) => ({ line, column, text })),
    [
      { line: 0, column: 7, text: "Rect" },
      { line: 1, column: 8, text: "Vec2" },
    ],
  );
  assert.throws(
    () => decodeTokens([0, 0, 2, tokenTypes.typeUser, 0], "x"),
    /fits its UTF-16 source line/,
  );
  assert.throws(
    () => decodeTokens([0, 0, 1, semanticTypeCount, 0], "x"),
    /exists in the client legend/,
  );
});

function tokenAt(tokens, line, column, text) {
  const token = tokens.find(
    (candidate) => candidate.line === line && candidate.column === column,
  );
  assert.ok(token, `expected a token at ${line}:${column} (${text})`);
  assert.equal(token.text, text, `token text at ${line}:${column}`);
  return token;
}

function serverFreshness() {
  const build = inspectLspBuild(lspRoot);
  return build.reason;
}

test("compiler-backed classification matches the enum golden fixture", async (t) => {
  const staleReason = serverFreshness();
  if (staleReason) {
    const reason =
      staleReason === "build/elisa-lsp is missing"
        ? "sibling Elisa-LSP build not present; run ../Elisa-LSP/build.sh"
        : staleReason;
    if (process.env.ELISA_REQUIRE_FRESH_LSP === "1") {
      assert.fail(`semantic golden requires a current Elisa-LSP build: ${reason}`);
    }
    t.skip(reason);
    return;
  }
  const text = readFileSync(fixturePath, "utf8");
  const data = await semanticTokensFor("file:///enum-family.elisa", text);
  const tokens = decodeTokens(data, text);

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

  assert.equal(tokenAt(tokens, 34, 7, "Rect").type, tokenTypes.typeUser);
  assert.equal(
    tokenAt(tokens, 35, 12, "Vec2").type,
    tokenTypes.typeUser,
    "user-defined type in a struct field annotation keeps its type color",
  );
  assert.equal(
    tokenAt(tokens, 36, 10, "Size").type,
    tokenTypes.typeUser,
    "user-defined type in a second struct field annotation keeps its type color",
  );
  assert.equal(
    tokenAt(tokens, 37, 8, "Vec2").type,
    tokenTypes.typeUser,
    "UTF-16 coordinates remain correct after a non-ASCII field name",
  );

  assert.equal(tokenAt(tokens, 8, 4, "consume").type, tokenTypes.fnDef);
  assert.equal(tokenAt(tokens, 8, 12, "event").type, tokenTypes.bindParam);
  assert.equal(tokenAt(tokens, 8, 19, "Event").type, tokenTypes.typeUser);
  assert.equal(tokenAt(tokens, 8, 29, "i32").type, tokenTypes.intSigned);

  assert.equal(tokenAt(tokens, 10, 8, "Event").type, tokenTypes.typeUser);
  assert.equal(tokenAt(tokens, 10, 14, "None").type, tokenTypes.enumVariant);
  assert.equal(tokenAt(tokens, 12, 8, "Event").type, tokenTypes.typeUser);
  assert.equal(tokenAt(tokens, 12, 14, "Resize").type, tokenTypes.enumVariant);
  assert.notEqual(tokenAt(tokens, 12, 21, "size").type, tokenTypes.enumVariant);

  const lines = text.split("\n");
  const constructorLine = lines.findIndex((line) =>
    line.includes("return Event.Resize(1)"),
  );
  assert.notEqual(constructorLine, -1, "fixture includes a qualified variant constructor");
  const familyColumn = lines[constructorLine].indexOf("Event.Resize");
  assert.equal(
    tokenAt(tokens, constructorLine, familyColumn, "Event").type,
    tokenTypes.typeUser,
    "enum family at a constructor site keeps its type color",
  );
  assert.equal(
    tokenAt(tokens, constructorLine, familyColumn + "Event.".length, "Resize").type,
    tokenTypes.enumVariant,
    "qualified constructor variant receives enum-member color",
  );

  const shadowLine = lines.findIndex((line) =>
    line.includes("return Event.Resize(2)"),
  );
  assert.notEqual(shadowLine, -1, "fixture covers a local shadowing the enum family name");
  const shadowColumn = lines[shadowLine].indexOf("Event.Resize");
  assert.notEqual(
    tokenAt(tokens, shadowLine, shadowColumn, "Event").type,
    tokenTypes.typeUser,
    "a local named Event is not recolored as the enum family",
  );
  assert.notEqual(
    tokenAt(tokens, shadowLine, shadowColumn + "Event.".length, "Resize").type,
    tokenTypes.enumVariant,
    "a local shadowing the family prevents false enum-variant coloring",
  );

  const uiKey = tokenAt(tokens, 16, 8, "UiKey");
  assert.notEqual(uiKey.type, tokenTypes.enumVariant);
  assert.equal(uiKey.type, tokenTypes.fnUse);
  const method = tokenAt(tokens, 17, 9, "Method");
  assert.notEqual(method.type, tokenTypes.enumVariant);
  assert.equal(method.type, tokenTypes.fnUse);

  const uiFamilyDeclLine = lines.findIndex((line) => line.trim() === "enum Event:");
  assert.notEqual(uiFamilyDeclLine, -1, "fixture covers an enum nested in a module");
  assert.equal(
    tokenAt(tokens, uiFamilyDeclLine, lines[uiFamilyDeclLine].indexOf("Event"), "Event").type,
    tokenTypes.typeUser,
    "module-owned enum declaration retains type identity",
  );

  const uiAliasLine = lines.findIndex((line) => line.startsWith("type UiEvent ="));
  assert.notEqual(uiAliasLine, -1, "fixture covers an alias to a module-owned enum");
  const aliasTargetColumn = lines[uiAliasLine].lastIndexOf("Event");
  assert.equal(
    tokenAt(tokens, uiAliasLine, aliasTargetColumn, "Event").type,
    tokenTypes.typeUser,
    "module-qualified enum type in an alias target is a type reference",
  );

  const qualifiedLines = [
    lines.findIndex((line) => line.includes("Ui::Event.None:")),
    lines.findIndex((line) => line.includes("Ui::Event.Resize(size):")),
    lines.findIndex((line) => line.includes("return Ui::Event.Resize(1)")),
  ];
  assert.ok(qualifiedLines.every((line) => line >= 0), "fixture covers qualified pattern and construction sites");
  for (const line of qualifiedLines) {
    const familyColumn = lines[line].indexOf("Event.");
    const variantColumn = familyColumn + "Event.".length;
    assert.equal(
      tokenAt(tokens, line, familyColumn, "Event").type,
      tokenTypes.typeUser,
      "module-qualified family retains type color in pattern/construction context",
    );
    assert.equal(
      tokenAt(tokens, line, variantColumn, line === qualifiedLines[0] ? "None" : "Resize").type,
      tokenTypes.enumVariant,
      "module-qualified family variant uses enum-member color",
    );
  }

  const aliasLine = lines.findIndex((line) => line.startsWith("type EventAlias ="));
  assert.notEqual(aliasLine, -1, "fixture covers a direct alias to an enum family");
  assert.equal(
    tokenAt(tokens, aliasLine, lines[aliasLine].lastIndexOf("Event"), "Event").type,
    tokenTypes.typeUser,
    "enum family at an alias target keeps its type color",
  );
  for (const [needle, site] of [
    ["return EventAlias.Resize(1)", "constructor"],
    ["EventAlias.Resize(size):", "pattern"],
  ]) {
    const line = lines.findIndex((candidate) => candidate.includes(needle));
    assert.notEqual(line, -1, `fixture covers an alias-qualified ${site}`);
    const familyColumn = lines[line].indexOf("EventAlias.Resize");
    assert.equal(
      tokenAt(tokens, line, familyColumn, "EventAlias").type,
      tokenTypes.typeUser,
      `enum alias at a ${site} site keeps its type color`,
    );
    assert.equal(
      tokenAt(tokens, line, familyColumn + "EventAlias.".length, "Resize").type,
      tokenTypes.enumVariant,
      `enum variant through a type alias receives enum-member color in a ${site}`,
    );
  }
});
