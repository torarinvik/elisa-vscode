const assert = require("node:assert");
const { existsSync, readFileSync, realpathSync } = require("node:fs");
const vscode = require("vscode");

const extensionId = "elisa-language.elisa-vscode";

const expectedCommands = [
  "elisa.restartLanguageServer",
  "elisa.showLanguageServerOutput",
  "elisa.showHealthReport",
  "elisa.verifySupport",
  "elisa.configureLanguageServer",
  "elisa.explainHighlighting",
  "elisa.collectSupportReport",
];

async function waitForMarker(environmentVariable, description) {
  const marker = process.env[environmentVariable];
  assert.ok(marker, `the integration harness provides a ${description} marker`);
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (existsSync(marker)) {
      const pid = readFileSync(marker, "utf8").trim();
      assert.match(pid, /^\d+$/, `the ${description} came from the test server`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`the installed extension did not complete ${description}`);
}

async function run() {
  const expectedTrust = process.env.ELISA_EXPECTED_TRUSTED;
  assert.ok(
    expectedTrust === "true" || expectedTrust === "false",
    "the integration harness declares the expected trust state",
  );
  assert.equal(
    vscode.workspace.isTrusted,
    expectedTrust === "true",
    "the isolated VS Code host has the requested workspace trust state",
  );

  const extension = vscode.extensions.getExtension(extensionId);
  assert.ok(extension, `${extensionId} is discoverable in a clean profile`);
  const expectedExtensionPath = process.env.ELISA_EXPECTED_EXTENSION_PATH;
  assert.ok(expectedExtensionPath, "the integration harness provides the installed VSIX path");
  assert.equal(
    realpathSync(extension.extensionPath),
    realpathSync(expectedExtensionPath),
    "the extension host loaded the installed VSIX, not a development checkout",
  );

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
  const markdownInjection = manifest.contributes.grammars.find(
    (candidate) => candidate.scopeName === "markdown.elisa.fenced-code",
  );
  assert.ok(markdownInjection, "the Elisa Markdown fence injection is contributed");
  assert.deepEqual(markdownInjection.injectTo, ["text.html.markdown"]);
  assert.equal(
    markdownInjection.embeddedLanguages["meta.embedded.block.elisa"],
    "elisa",
  );
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
  const enumVariantType = manifest.contributes.semanticTokenTypes.find(
    (semanticType) => semanticType.id === "elisa-enum-variant",
  );
  assert.equal(enumVariantType?.superType, "enumMember");
  assert.ok(
    manifest.contributes.semanticTokenScopes[0].scopes["elisa-enum-variant"]?.includes(
      "variable.other.enummember",
    ),
    "enum variants have a standard-theme fallback scope",
  );
  for (const semanticType of manifest.contributes.semanticTokenTypes) {
    assert.match(
      semanticType.id,
      /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
      `${semanticType.id} satisfies the VS Code contribution schema`,
    );
  }
  for (const scopes of Object.values(manifest.contributes.semanticTokenScopes[0].scopes)) {
    assert.ok(Array.isArray(scopes), "semantic token scope values use arrays");
    assert.ok(scopes.every((scope) => typeof scope === "string"));
  }
  assert.equal(
    manifest.capabilities.untrustedWorkspaces.supported,
    "limited",
    "Restricted Mode support is explicitly declared",
  );
  assert.deepEqual(
    manifest.capabilities.untrustedWorkspaces.restrictedConfigurations,
    ["elisa.languageServer.path", "elisa.trace.server"],
    "execution-sensitive workspace settings are restricted",
  );

  const document = await vscode.workspace.openTextDocument({
    language: "elisa",
    content: "enum Event:\n    None\n    Resize(size: i64)\n\ndef make() -> Event:\n    return Event.Resize(1)\n",
  });
  assert.equal(document.languageId, "elisa", "elisa documents receive the elisa language id");

  const editor = await vscode.window.showTextDocument(document);
  assert.ok(editor, "an elisa editor can be opened");
  await waitForMarker(
    "ELISA_TEST_SERVER_INITIALIZED_MARKER",
    "the LSP initialization handshake",
  );
  const markdownDocument = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: "```elisa\nenum Event:\n    None\n```\n",
  });
  assert.equal(
    markdownDocument.languageId,
    "markdown",
    "Elisa fences keep their Markdown host document identity",
  );

  await vscode.commands.executeCommand("elisa.showHealthReport");
  const healthDocument = vscode.workspace.textDocuments.find((candidate) =>
    candidate.getText().startsWith("# Elisa Language Support Health"),
  );
  assert.ok(healthDocument, "the health report opens in the packaged extension host");
  const health = healthDocument.getText();
  assert.match(health, /Server lifecycle state: ready/);
  assert.match(health, /Server path source: environment \(ELISA_LSP\)/);
  assert.match(health, /Server identity: fake-elisa-lsp integration-test/);
  assert.match(health, /Advertised capabilities: document synchronization, hover, semantic tokens/);
  if (expectedTrust === "false") {
    assert.match(health, /Workspace trusted: no/);
    assert.match(health, /Protocol tracing: off/);
    assert.doesNotMatch(health, /must-not-run-from-untrusted-workspace/);
  }

  await vscode.commands.executeCommand("elisa.verifySupport");
  await waitForMarker(
    "ELISA_TEST_SERVER_VERIFICATION_MARKER",
    "the semantic-token request for the explicit support-verification document",
  );
  const verificationDocument = [...vscode.workspace.textDocuments]
    .reverse()
    .find((candidate) => candidate.getText().includes("## Live verification"));
  assert.ok(verificationDocument, "live server verification opens a report");
  assert.match(verificationDocument.getText(), /Semantic tokens: 4 spans returned/);
  assert.match(verificationDocument.getText(), /Hover: content returned/);

  return undefined;
}

module.exports = { run };
