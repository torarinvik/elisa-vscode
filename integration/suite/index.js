const assert = require("node:assert");
const vscode = require("vscode");

const extensionId = "elisa-language.elisa-vscode";

const expectedCommands = [
  "elisa.restartLanguageServer",
  "elisa.showLanguageServerOutput",
  "elisa.showHealthReport",
  "elisa.configureLanguageServer",
  "elisa.explainHighlighting",
  "elisa.collectSupportReport",
];

async function run() {
  const extension = vscode.extensions.getExtension(extensionId);
  assert.ok(extension, `${extensionId} is discoverable in a clean profile`);

  await extension.activate();
  assert.equal(extension.isActive, true, "extension activates");

  const languages = await vscode.languages.getLanguages();
  assert.ok(languages.includes("elisa"), "the elisa language is registered");

  const commands = await vscode.commands.getCommands(true);
  for (const id of expectedCommands) {
    assert.ok(commands.includes(id), `command ${id} is registered`);
  }

  const manifest = extension.packageJSON;
  const grammar = manifest.contributes.grammars.find(
    (candidate) => candidate.language === "elisa",
  );
  assert.ok(grammar, "an elisa grammar is contributed");
  assert.equal(grammar.scopeName, "source.elisa");
  assert.equal(
    manifest.contributes.configurationDefaults["[elisa]"][
      "editor.semanticHighlighting.enabled"
    ],
    true,
    "semantic highlighting is enabled for elisa",
  );
  assert.ok(
    manifest.contributes.semanticTokenTypes.length === 48,
    "the full 48-type legend is declared",
  );
  assert.ok(
    manifest.contributes.semanticTokenScopes.length > 0,
    "semantic token scopes are contributed",
  );

  const document = await vscode.workspace.openTextDocument({
    language: "elisa",
    content: "enum Event:\n    None\n    Resize(size: i64)\n\ndef make() -> Event:\n    return Event.Resize(1)\n",
  });
  assert.equal(document.languageId, "elisa", "elisa documents receive the elisa language id");

  const editor = await vscode.window.showTextDocument(document);
  assert.ok(editor, "an elisa editor can be opened");

  await vscode.commands.executeCommand("elisa.showHealthReport");

  return undefined;
}

module.exports = { run };
