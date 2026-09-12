import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const schemaPath = resolve(root, "..", "Elisa-LSP", "docs", "semantic-token-schema.json");

const standardTypes = new Set([
  "namespace",
  "type",
  "class",
  "enum",
  "interface",
  "struct",
  "typeParameter",
  "parameter",
  "variable",
  "property",
  "enumMember",
  "event",
  "function",
  "method",
  "macro",
  "keyword",
  "modifier",
  "comment",
  "string",
  "number",
  "regexp",
  "operator",
  "decorator",
]);

test("every declared semantic token type has a standard superType and description", () => {
  const types = manifest.contributes.semanticTokenTypes;
  assert.ok(types.length > 0, "semantic token types are declared");
  const ids = types.map((type) => type.id);
  assert.equal(new Set(ids).size, ids.length, "semantic token type ids are unique");
  for (const type of types) {
    assert.match(type.id, /^elisa\.[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$/, `${type.id} follows the id convention`);
    assert.ok(
      standardTypes.has(type.superType),
      `${type.id} superType ${type.superType} is a VS Code standard type`,
    );
    assert.equal(typeof type.description, "string", `${type.id} has a description`);
    assert.ok(type.description.length > 0, `${type.id} description is not empty`);
  }
});

test("every declared semantic token type has a TextMate scope mapping", () => {
  const scopes = manifest.contributes.semanticTokenScopes;
  assert.equal(Array.isArray(scopes), true);
  assert.equal(scopes.length > 0, true);
  const mapping = scopes[0].scopes;
  for (const type of manifest.contributes.semanticTokenTypes) {
    assert.ok(mapping[type.id] !== undefined, `${type.id} has a scope mapping`);
  }
});

test("enum variants fall back to the standard enumMember category", () => {
  const variant = manifest.contributes.semanticTokenTypes.find(
    (type) => type.id === "elisa.enum.variant",
  );
  assert.deepEqual(variant?.superType, "enumMember");
  const mapping = manifest.contributes.semanticTokenScopes[0].scopes;
  assert.deepEqual(mapping["elisa.enum.variant"], ["variable.other.enummember"]);
});

test("language defaults enable semantic highlighting without forcing a palette", () => {
  const defaults = manifest.contributes.configurationDefaults["[elisa]"];
  assert.equal(defaults?.["editor.semanticHighlighting.enabled"], true);
  assert.equal(
    "editor.semanticTokenColorCustomizations" in defaults,
    false,
    "theming settings are not language-scoped and must not be placed under a language default",
  );
});

test("legend order matches the shared Elisa taxonomy when the sibling is available", (t) => {
  if (!existsSync(schemaPath)) {
    t.skip("sibling Elisa-LSP semantic-token schema not present");
    return;
  }
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const declaredOrder = manifest.contributes.semanticTokenTypes.map((type) => type.id);
  assert.deepEqual(declaredOrder, schema.legend, "client legend must follow the server legend");
  assert.equal(schema.legend.length, schema.count, "schema count matches its legend");
});

test("grammar fallback scopes agree with the semantic mapping", () => {
  const grammar = JSON.parse(
    readFileSync(resolve(root, "syntaxes", "elisa.tmLanguage.json"), "utf8"),
  );
  const variantDeclaration = grammar.repository.variantDeclaration.patterns[0];
  assert.equal(
    variantDeclaration.captures["2"].name,
    "variable.other.enummember.elisa",
    "declared enum variants use the enumMember fallback scope",
  );
  const typeReference = grammar.repository.typeReferences.patterns[0];
  assert.match(typeReference.match, /\(:\|->/);
  assert.equal(typeReference.captures["2"].name, "entity.name.type.elisa");
});
