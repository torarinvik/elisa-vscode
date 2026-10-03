import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  fixtureText,
  hasScope,
  loadMarkdownGrammar,
  tokenAt,
  tokenizeFile,
} from "./helpers/grammar.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = process.env.ELISA_EXTENSION_ROOT
  ? resolve(process.env.ELISA_EXTENSION_ROOT)
  : root;
const packageManifest = JSON.parse(
  readFileSync(resolve(extensionRoot, "package.json"), "utf8"),
);
const injectionPath = resolve(extensionRoot, "syntaxes", "markdown-elisa.tmLanguage.json");
const injection = JSON.parse(readFileSync(injectionPath, "utf8"));
const grammar = await loadMarkdownGrammar(
  process.env.VSCODE_MARKDOWN_GRAMMAR,
  extensionRoot,
);

test("Markdown contributes a bounded Elisa-only grammar injection", () => {
  const contribution = packageManifest.contributes.grammars.find(
    (item) => item.scopeName === injection.scopeName,
  );
  assert.deepEqual(contribution, {
    scopeName: "markdown.elisa.fenced-code",
    path: "./syntaxes/markdown-elisa.tmLanguage.json",
    embeddedLanguages: { "meta.embedded.block.elisa": "elisa" },
    injectTo: ["text.html.markdown"],
  });
  assert.match(injection.injectionSelector, /^L:text\.html\.markdown\b/);
  assert.match(injection.injectionSelector, /- markup\.fenced_code\.block\.markdown/);
  assert.equal(injection.patterns.length, 2, "ticks and tildes are distinct fence rules");
  for (const rule of injection.patterns) {
    assert.equal(rule.contentName, "meta.embedded.block.elisa");
    assert.deepEqual(rule.patterns, [{ include: "source.elisa" }]);
  }
});

test("only Elisa fenced blocks embed the real Elisa grammar", () => {
  const lines = fixtureText("markdown-fences.md").split("\n");
  const tokens = tokenizeFile(grammar, lines.join("\n"));

  assert.ok(
    hasScope(tokenAt(tokens[3], "enum"), "storage.type.declaration"),
    "Elisa declaration keyword is tokenized inside the fence",
  );
  assert.ok(
    hasScope(tokenAt(tokens[3], "Event"), "entity.name.type.enum"),
    "family declaration is tokenized inside the fence",
  );
  assert.ok(
    hasScope(tokenAt(tokens[4], "Resize"), "variable.other.enummember"),
    "variant declaration is tokenized inside the fence",
  );
  assert.ok(
    hasScope(tokenAt(tokens[4], "i32"), "storage.type.primitive"),
    "payload type remains Elisa",
  );
  assert.equal(
    hasScope(tokenAt(tokens[7], "Event"), "entity.name.type"),
    false,
    "the lexical layer does not invent family identity for a qualified reference",
  );
  assert.equal(
    hasScope(tokenAt(tokens[7], "Resize"), "variable.other.enummember"),
    false,
    "the lexical layer does not guess qualified variant identity",
  );
  assert.ok(
    hasScope(tokenAt(tokens[7], "return"), "keyword.control"),
    "Elisa control keyword is tokenized",
  );

  assert.equal(
    hasScope(tokenAt(tokens[0], "enum"), "storage.type.declaration"),
    false,
    "inline-code examples in ordinary Markdown are not promoted to Elisa",
  );
  assert.equal(
    hasScope(tokenAt(tokens[18], "def"), "storage.type.function"),
    false,
    "a non-Elisa fenced language remains under the host grammar",
  );
  assert.equal(
    hasScope(tokenAt(tokens[24], "not"), "variable.other.elisa"),
    false,
    "a longer language identifier is not mistaken for Elisa",
  );
  assert.equal(
    hasScope(tokenAt(tokens[10], "Event"), "variable.other.elisa"),
    false,
    "Elisa scopes stop after a longer closing fence",
  );
});

test("tilde fences accept case-insensitive Elisa info strings and stop at their closer", () => {
  const tokens = tokenizeFile(
    grammar,
    "before\n~~~ELISA linenos\nstruct Vec2:\n    x: f32\n~~~\nafter\n",
  );
  assert.ok(
    hasScope(tokenAt(tokens[2], "Vec2"), "entity.name.type.struct"),
    "tilde fence body uses the Elisa grammar despite harmless metadata",
  );
  assert.ok(
    hasScope(tokenAt(tokens[3], "f32"), "storage.type.primitive"),
    "nested body lines retain embedded Elisa tokenization",
  );
  assert.equal(
    hasScope(tokenAt(tokens[5], "after"), "source.elisa"),
    false,
    "the host grammar resumes after the closing tilde fence",
  );
});

test("Elisa fence injection does not reopen inside another fenced block", () => {
  const tokens = tokenizeFile(
    grammar,
    "```text\n```elisa\ndef notEmbedded():\n```\n```\nafter\n",
  );
  assert.equal(
    tokens.flat().some((token) => token.scopes.includes("meta.embedded.block.elisa")),
    false,
    "nested fence-looking text in a host code block remains literal host content",
  );
});

test("fence boundaries honor the delimiter character and minimum closing length", () => {
  const tokens = tokenizeFile(
    grammar,
    "~~~elisa\nstruct T:\n    x: i32\n```\ndef still_inside():\n    return 1\n~~~\n\n````elisa `invalid\ndef not_embedded():\n    return 2\n````\n",
  );
  assert.ok(
    hasScope(tokenAt(tokens[4], "def"), "storage.type.function"),
    "a backtick fence does not close an Elisa tilde fence",
  );
  assert.ok(
    hasScope(tokenAt(tokens[5], "return"), "keyword.control"),
    "content remains Elisa until a same-character closer appears",
  );
  assert.equal(
    hasScope(tokenAt(tokens[9], "def"), "storage.type.function"),
    false,
    "a backtick in the info string invalidates a backtick opener",
  );
});

const installedMarkdownGrammar = process.env.VSCODE_MARKDOWN_GRAMMAR;
test(
  "Elisa injection composes with the installed VS Code Markdown grammar",
  { skip: !installedMarkdownGrammar || !existsSync(installedMarkdownGrammar) },
  async () => {
    const installedGrammar = await loadMarkdownGrammar(
      installedMarkdownGrammar,
      extensionRoot,
    );
    const tokens = tokenizeFile(
      installedGrammar,
      "Text before.\n\n```elisa\nenum Event:\n    Resize(size: i32)\n```\n\n```python\ndef not_elisa():\n    return 1\n```\n",
    );
    assert.ok(
      hasScope(tokenAt(tokens[3], "Event"), "entity.name.type.enum"),
      "the actual host grammar allows the Elisa injection to classify a declaration",
    );
    assert.ok(
      hasScope(tokenAt(tokens[4], "Resize"), "variable.other.enummember"),
      "the actual host grammar preserves Elisa variant scopes",
    );
    assert.equal(
      hasScope(tokenAt(tokens[8], "def"), "storage.type.function"),
      false,
      "ordinary language fences retain their Markdown-host behavior",
    );
  },
);
