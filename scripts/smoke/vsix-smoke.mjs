import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workspace = mkdtempSync(join(tmpdir(), "elisa-vsix-"));
const vsix = join(workspace, "elisa-vscode.vsix");
const extensionsDir = join(workspace, "extensions");
const userDataDir = join(workspace, "user-data");

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  });
}

function findVsCodeCli() {
  if (process.env.VSCODE_BIN) {
    return process.env.VSCODE_BIN;
  }
  const names =
    process.platform === "win32" ? ["code.cmd", "code"] : ["code", "code-insiders"];
  for (const entry of (process.env.PATH ?? "").split(delimiter)) {
    if (!entry) {
      continue;
    }
    for (const name of names) {
      const candidate = join(entry, name);
      try {
        execFileSync(candidate, ["--version"], { stdio: "ignore" });
        return candidate;
      } catch {
        continue;
      }
    }
  }
  return undefined;
}

run("npm", ["run", "compile"], { inherit: true });
run("npx", [
  "vsce",
  "package",
  "--out",
  vsix,
  "--allow-missing-repository",
]);

const cli = findVsCodeCli();
if (!cli) {
  console.log(`VSIX packaged at ${vsix}`);
  console.log("skipped: no VS Code CLI found; set VSCODE_BIN or install 'code' on PATH");
  process.exit(0);
}

run(cli, [
  "--install-extension",
  vsix,
  "--force",
  "--extensions-dir",
  extensionsDir,
  "--user-data-dir",
  userDataDir,
]);

const installed = run(cli, [
  "--list-extensions",
  "--extensions-dir",
  extensionsDir,
  "--user-data-dir",
  userDataDir,
])
  .split("\n")
  .map((line) => line.trim().toLowerCase())
  .filter((line) => line.length > 0);

const expected = "elisa-language.elisa-vscode";
if (!installed.includes(expected)) {
  console.error(`installed extensions did not include ${expected}: ${installed.join(", ")}`);
  process.exit(1);
}

console.log(`installed-VSIX smoke OK: ${expected} installed into an isolated profile`);
