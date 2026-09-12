import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { downloadAndUnzipVSCode, runTests } from "@vscode/test-electron";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const bundledExecutables = {
  darwin: [
    "/Applications/Visual Studio Code.app/Contents/MacOS/Electron",
    "/Applications/Visual Studio Code - Insiders.app/Contents/MacOS/Electron",
    join(
      process.env.HOME ?? "",
      "Applications/Visual Studio Code.app/Contents/MacOS/Electron",
    ),
  ],
  linux: ["/usr/share/code/code", "/usr/bin/code", "/snap/bin/code"],
  win32: [
    join(
      process.env.LOCALAPPDATA ?? "",
      "Programs",
      "Microsoft VS Code",
      "Code.exe",
    ),
  ],
};

function findBundledExecutable() {
  if (process.env.VSCODE_BIN) {
    return process.env.VSCODE_BIN;
  }
  for (const candidate of bundledExecutables[process.platform] ?? []) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

const executable = findBundledExecutable() ?? (await downloadAndUnzipVSCode());
const workspace = mkdtempSync(join(tmpdir(), "elisa-integration-workspace-"));
const userDataDir = mkdtempSync(join(tmpdir(), "elisa-integration-user-"));

const args = [
  workspace,
  "--disable-extensions",
  "--disable-workspace-trust",
  "--disable-telemetry",
  "--disable-updates",
  "--skip-welcome",
  "--skip-release-notes",
  "--user-data-dir",
  userDataDir,
];

function killStrayHost() {
  if (process.platform === "win32") {
    return;
  }
  try {
    execFileSync("pkill", ["-f", userDataDir], { stdio: "ignore" });
  } catch {
    return;
  }
}

const watchdog = setTimeout(() => {
  console.error(
    "extension-host integration timed out; ensure no other VS Code instance is running",
  );
  killStrayHost();
  process.exit(1);
}, 120000);
watchdog.unref();

try {
  const code = await runTests({
    vscodeExecutablePath: executable,
    extensionDevelopmentPath: root,
    extensionTestsPath: resolve(root, "integration", "suite"),
    launchArgs: args,
  });
  if (code !== 0) {
    throw new Error(`VS Code exited with code ${code}`);
  }
  console.log(`extension-host integration OK using ${executable}`);
} finally {
  clearTimeout(watchdog);
  rmSync(workspace, { recursive: true, force: true });
  rmSync(userDataDir, { recursive: true, force: true });
}
