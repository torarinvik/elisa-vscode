import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
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

const bundledCliPaths = {
  darwin: [
    "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
    "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code",
    join(
      process.env.HOME ?? "",
      "Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
    ),
  ],
  linux: ["/usr/share/code/bin/code", "/snap/bin/code", "/usr/bin/code"],
  win32: [
    join(
      process.env.LOCALAPPDATA ?? "",
      "Programs",
      "Microsoft VS Code",
      "bin",
      "code.cmd",
    ),
    join(
      process.env.PROGRAMFILES ?? "",
      "Microsoft VS Code",
      "bin",
      "code.cmd",
    ),
  ],
};

function isRunnable(candidate) {
  try {
    execFileSync(candidate, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function findVsCodeCli() {
  if (process.env.VSCODE_BIN && isRunnable(process.env.VSCODE_BIN)) {
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
      if (isRunnable(candidate)) {
        return candidate;
      }
    }
  }
  for (const candidate of bundledCliPaths[process.platform] ?? []) {
    if (candidate && isRunnable(candidate)) {
      return candidate;
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
  "--show-versions",
  "--extensions-dir",
  extensionsDir,
  "--user-data-dir",
  userDataDir,
])
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.length > 0);

const expected = "elisa-language.elisa-vscode";
if (!installed.some((line) => line.toLowerCase().startsWith(expected))) {
  console.error(`installed extensions did not include ${expected}: ${installed.join(", ")}`);
  process.exit(1);
}

const installedRoots = readdirSync(extensionsDir).filter((entry) =>
  entry.startsWith("elisa-language.elisa-vscode"),
);
const unpacked = installedRoots.map((entry) => ({
  root: entry,
  packageJson: existsSync(join(extensionsDir, entry, "package.json")),
  bundle: existsSync(join(extensionsDir, entry, "dist", "extension.js")),
  grammar: existsSync(
    join(extensionsDir, entry, "syntaxes", "elisa.tmLanguage.json"),
  ),
}));
const incomplete = unpacked.filter(
  (entry) => !entry.packageJson || !entry.bundle || !entry.grammar,
);
if (unpacked.length === 0 || incomplete.length > 0) {
  console.error(`installed extension is incomplete: ${JSON.stringify(unpacked)}`);
  process.exit(1);
}

console.log(
  `installed-VSIX smoke OK: ${expected} ${installed.find((line) => line.toLowerCase().startsWith(expected))} unpacked with bundle and grammar`,
);
