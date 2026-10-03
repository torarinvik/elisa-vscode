import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function installedMarkdownGrammar() {
  const candidates = process.platform === "darwin"
    ? [
        "/Applications/Visual Studio Code.app/Contents/Resources/app/extensions/markdown-basics/syntaxes/markdown.tmLanguage.json",
        "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/extensions/markdown-basics/syntaxes/markdown.tmLanguage.json",
      ]
    : process.platform === "linux"
      ? [
          "/usr/share/code/resources/app/extensions/markdown-basics/syntaxes/markdown.tmLanguage.json",
          "/usr/share/code-insiders/resources/app/extensions/markdown-basics/syntaxes/markdown.tmLanguage.json",
        ]
      : [];
  return candidates.find((candidate) => existsSync(candidate));
}

function run(label, command, args, environment) {
  console.log(`[headless] ${label}`);
  execFileSync(command, args, {
    cwd: root,
    env: environment,
    stdio: "inherit",
  });
}

const environment = {
  ...process.env,
  ELISA_HEADLESS: "1",
  ELISA_REQUIRE_FRESH_LSP: "1",
};
if (!environment.VSCODE_MARKDOWN_GRAMMAR) {
  const grammar = installedMarkdownGrammar();
  if (grammar) {
    environment.VSCODE_MARKDOWN_GRAMMAR = grammar;
  }
}

run("compile", npm, ["run", "compile"], environment);
run("node test suite", process.execPath, ["--test"], environment);
run("type check", npm, ["run", "check"], environment);
run("VSIX content audit", npm, ["run", "audit:vsix"], environment);
console.log("[headless] complete: no VS Code, Electron, or Extension Development Host was launched");
