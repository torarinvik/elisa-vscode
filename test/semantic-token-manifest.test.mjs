import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const grammar = JSON.parse(
  readFileSync(resolve(root, "syntaxes/elisa.tmLanguage.json"), "utf8"),
);

test("user-defined types are declared and mapped to the Elisa type scope", () => {
  const userType = manifest.contributes.semanticTokenTypes.find(
    (tokenType) => tokenType.id === "elisa.type.user",
  );
  assert.deepEqual(userType?.superType, "type");

  const scopeMapping = manifest.contributes.semanticTokenScopes.find(
    (mapping) => !mapping.language,
  )?.scopes?.["elisa.type.user"];
  assert.deepEqual(scopeMapping, ["entity.name.type"]);

  assert.equal(
    manifest.contributes.configurationDefaults["[elisa]"]?.[
      "editor.semanticHighlighting.enabled"
    ],
    true,
  );
  assert.equal(
    manifest.contributes.configurationDefaults["[elisa]"]?.[
      "editor.semanticTokenColorCustomizations"
    ]?.rules?.["elisa.type.user"],
    "#267F99",
  );

  const typeReference = grammar.repository.typeReferences.patterns[0];
  assert.match(typeReference.match, /\(:\|->/);
  assert.equal(typeReference.captures["2"].name, "entity.name.type.elisa");
});

test("enum variants are declared, colored, and scoped as enum members", () => {
  const enumVariant = manifest.contributes.semanticTokenTypes.find(
    (tokenType) => tokenType.id === "elisa.enum.variant",
  );
  assert.deepEqual(enumVariant?.superType, "enumMember");

  const scopeMapping = manifest.contributes.semanticTokenScopes.find(
    (mapping) => !mapping.language,
  )?.scopes?.["elisa.enum.variant"];
  assert.deepEqual(scopeMapping, ["variable.other.enummember"]);

  assert.equal(
    manifest.contributes.configurationDefaults["[elisa]"]?.[
      "editor.semanticTokenColorCustomizations"
    ]?.rules?.["elisa.enum.variant"],
    "#8250DF",
  );

  const variantReference = grammar.repository.enumVariantReferences.patterns[0];
  assert.match(variantReference.match, /A-Za-z0-9_/);
  assert.equal(
    variantReference.captures["2"].name,
    "constant.language.elisa",
  );
  const familyReference = grammar.repository.enumFamilyReferences.patterns[0];
  assert.match(familyReference.match, /A-Z/);
  assert.equal(familyReference.captures["1"].name, "entity.name.type.elisa");
  const variantDeclaration = grammar.repository.enumVariantDeclarations.patterns[0];
  assert.match(variantDeclaration.match, /A-Za-z0-9_/);
  assert.equal(variantDeclaration.captures["2"].name, "constant.language.elisa");
});
