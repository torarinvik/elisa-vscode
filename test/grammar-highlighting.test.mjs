import assert from "node:assert/strict";
import test from "node:test";
import {
  fixtureText,
  hasScope,
  loadElisaGrammar,
  tokenAt,
  tokenizeFile,
} from "./helpers/grammar.mjs";

const grammar = await loadElisaGrammar();

test("enum family declarations and variants receive exact lexical scopes", () => {
  const tokens = tokenizeFile(grammar, fixtureText("enum-family.elisa"));

  assert.ok(
    hasScope(tokenAt(tokens[0], "enum"), "storage.type.declaration"),
    "enum keyword is a declaration keyword",
  );
  assert.ok(
    hasScope(tokenAt(tokens[0], "Event"), "entity.name.type.enum"),
    "enum family name is an enum type",
  );
  for (const [line, variant] of [
    [1, "None"],
    [2, "Quit"],
    [3, "Resize"],
    [6, "Move"],
  ]) {
    assert.ok(
      hasScope(tokenAt(tokens[line], variant), "variable.other.enummember"),
      `variant ${variant} on line ${line} is an enum member`,
    );
  }

  assert.equal(
    hasScope(tokenAt(tokens[3], "size"), "variable.other.enummember"),
    false,
    "payload field names are not enum members",
  );
  assert.ok(
    hasScope(tokenAt(tokens[3], "Size"), "entity.name.type"),
    "payload annotation is a type reference",
  );
  assert.equal(
    hasScope(tokenAt(tokens[6], "at"), "variable.other.enummember"),
    false,
    "payload field names in inherited families are not enum members",
  );
  assert.ok(
    hasScope(tokenAt(tokens[6], "Vec2"), "entity.name.type"),
    "inherited payload annotation is a type reference",
  );
  assert.ok(
    hasScope(tokenAt(tokens[5], "PointerEvent"), "entity.name.type.enum"),
    "inheriting family declaration is an enum type",
  );
  assert.ok(
    hasScope(tokenAt(tokens[5], "InputEvent"), "entity.name.type"),
    "parent family is a type reference",
  );
});

test("multiline payload lists and payload-free variants stay in enum context", () => {
  const tokens = tokenizeFile(grammar, fixtureText("enum-multiline.elisa"));
  assert.ok(
    hasScope(tokenAt(tokens[1], "Single"), "variable.other.enummember"),
    "payload-free variant is an enum member",
  );
  assert.ok(
    hasScope(tokenAt(tokens[2], "Pair"), "variable.other.enummember"),
    "multiline variant head is an enum member",
  );
  for (const [line, field] of [
    [3, "first"],
    [4, "second"],
  ]) {
    assert.equal(
      hasScope(tokenAt(tokens[line], field), "variable.other.enummember"),
      false,
      `payload field ${field} is not an enum member`,
    );
    assert.ok(
      hasScope(tokenAt(tokens[line], "i32"), "storage.type.primitive"),
      `payload field type ${field} keeps its primitive scope`,
    );
  }
  assert.ok(
    hasScope(tokenAt(tokens[8], "Read"), "variable.other.enummember"),
    "variant before a discriminant is an enum member",
  );
});

test("unrelated dotted PascalCase is never classified as an enum variant", () => {
  const tokens = tokenizeFile(grammar, fixtureText("enum-family.elisa"));

  assert.equal(
    hasScope(tokenAt(tokens[10], "None"), "variable.other.enummember"),
    false,
    "qualified use of an enum variant is not proven by the lexical layer",
  );
  assert.equal(
    hasScope(tokenAt(tokens[10], "Event"), "variable.other.enummember"),
    false,
    "qualified family name is not an enum member",
  );
  assert.equal(
    hasScope(tokenAt(tokens[12], "Resize"), "variable.other.enummember"),
    false,
    "pattern variant is not proven by the lexical layer",
  );
  assert.equal(
    hasScope(tokenAt(tokens[16], "UiKey"), "variable.other.enummember"),
    false,
    "UFCS-like conversion is not an enum variant",
  );
  assert.equal(
    hasScope(tokenAt(tokens[17], "Method"), "variable.other.enummember"),
    false,
    "PascalCase method call is not an enum variant",
  );
});

test("function, parameter, and type roles are distinguished", () => {
  const tokens = tokenizeFile(grammar, fixtureText("enum-family.elisa"));
  assert.ok(
    hasScope(tokenAt(tokens[8], "consume"), "entity.name.function"),
    "def name is a function declaration",
  );
  assert.ok(
    hasScope(tokenAt(tokens[8], "Event"), "entity.name.type"),
    "parameter type annotation is a type reference",
  );
  assert.ok(
    hasScope(tokenAt(tokens[8], "i32"), "storage.type.primitive"),
    "primitive return type keeps its primitive scope",
  );
});

test("comments do not receive symbol scopes", () => {
  const tokens = tokenizeFile(grammar, fixtureText("lexical.elisa"));
  const comment = tokenAt(tokens[0], "# Comment with Event.None and \"quoted text\" inside.");
  assert.ok(hasScope(comment, "comment.line.number-sign"), "comment line is scoped");
  assert.equal(hasScope(comment, "variable.other.enummember"), false);
  assert.equal(hasScope(comment, "entity.name.type"), false);
});

test("const enum keeps the enum keyword out of the declaration name slot", () => {
  const tokens = tokenizeFile(grammar, fixtureText("lexical.elisa"));
  assert.ok(
    hasScope(tokenAt(tokens[1], "Mode"), "entity.name.type.enum"),
    "const enum name is an enum type",
  );
  assert.equal(
    hasScope(tokenAt(tokens[1], "enum"), "variable.other.constant"),
    false,
    "the enum keyword is not captured as a constant name",
  );
  assert.ok(
    hasScope(tokenAt(tokens[2], "Fast"), "variable.other.enummember"),
    "const enum variants are enum members",
  );
});

test("numeric forms are classified", () => {
  const tokens = tokenizeFile(grammar, fixtureText("lexical.elisa"));
  assert.ok(hasScope(tokenAt(tokens[5], "0x1F_FF"), "constant.numeric.hex"));
  assert.ok(hasScope(tokenAt(tokens[6], "0b1010"), "constant.numeric.binary"));
  assert.ok(hasScope(tokenAt(tokens[7], "0o17"), "constant.numeric.octal"));
});

test("f-string interpolation is code, literal chunks stay strings", () => {
  const tokens = tokenizeFile(grammar, fixtureText("lexical.elisa"));
  const interpolation = tokenAt(tokens[10], "name");
  assert.ok(
    hasScope(interpolation, "meta.embedded.expression"),
    "interpolated identifier is inside an embedded expression",
  );
  assert.ok(
    hasScope(interpolation, "variable.other"),
    "interpolated identifier receives normal expression scopes",
  );
  const literal = tokens[10].find((token) => token.text.includes("hi "));
  assert.ok(
    hasScope(literal, "string.quoted.double.fstring"),
    "literal chunk keeps the string scope",
  );

  const escapedOpen = tokens[11].find((token) => token.text === "{{");
  const escapedClose = tokens[11].find((token) => token.text === "}}");
  assert.ok(
    hasScope(escapedOpen, "constant.character.escape.brace"),
    "escaped opening braces are an escape",
  );
  assert.ok(
    hasScope(escapedClose, "constant.character.escape.brace"),
    "escaped closing braces are an escape",
  );
  assert.ok(
    hasScope(escapedOpen, "string.quoted.double.fstring"),
    "escaped braces remain literal string content",
  );

  const plain = tokens[12].find((token) => token.text === "quoted");
  assert.ok(
    hasScope(plain, "string.quoted.double"),
    "escaped quotes inside a plain string stay string content",
  );
});

test("overlapping operators prefer the longest match", () => {
  const tokens = tokenizeFile(grammar, fixtureText("lexical.elisa"));
  assert.ok(
    hasScope(tokenAt(tokens[14], "..<"), "keyword.operator"),
    "range operator ..< is one token",
  );
  assert.ok(
    hasScope(tokenAt(tokens[15], ".."), "keyword.operator"),
    "range operator .. is one token",
  );
  assert.ok(
    hasScope(tokenAt(tokens[16], "<<"), "keyword.operator.bitwise"),
    "left shift is a bitwise operator, not two comparisons",
  );
  assert.ok(
    hasScope(tokenAt(tokens[17], "<="), "keyword.operator.comparison"),
    "<= is a comparison operator",
  );
});

test("unicode identifiers follow the compiler's letter rules", () => {
  const tokens = tokenizeFile(grammar, fixtureText("lexical.elisa"));
  assert.ok(
    hasScope(tokenAt(tokens[23], "élan"), "entity.name.function"),
    "unicode function name is a declaration",
  );
  assert.ok(
    hasScope(tokenAt(tokens[24], "café"), "variable.other"),
    "unicode local binding is an identifier",
  );
  assert.ok(
    hasScope(tokenAt(tokens[25], "return"), "keyword.control"),
    "keywords adjacent to unicode identifiers stay keywords",
  );
});

test("declaration names use distinct scopes", () => {
  const tokens = tokenizeFile(grammar, fixtureText("lexical.elisa"));
  assert.ok(
    hasScope(tokenAt(tokens[20], "mapped"), "entity.name.function"),
    "top-level function declaration",
  );
  assert.ok(
    hasScope(tokenAt(tokens[5], "LIMIT"), "variable.other.constant"),
    "const declaration name",
  );
});
