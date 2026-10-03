import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { downloadAndUnzipVSCode, runTests } from "@vscode/test-electron";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testHostPath = resolve(root, "integration", "test-host");
const extensionId = "elisa-language.elisa-vscode";

function run(command, args, env = process.env) {
  try {
    return execFileSync(command, args, {
      cwd: root,
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const output = Buffer.concat([
      Buffer.isBuffer(error.stdout) ? error.stdout : Buffer.from(error.stdout ?? ""),
      Buffer.isBuffer(error.stderr) ? error.stderr : Buffer.from(error.stderr ?? ""),
    ])
      .subarray(-16 * 1024)
      .toString("utf8");
    const status = error.status ?? error.signal ?? "unknown status";
    throw new Error(
      `${command} ${args.join(" ")} failed (${status})${output ? `: ${output}` : ""}`,
      { cause: error },
    );
  }
}

const bundledExecutables = {
  darwin: [
    "/Applications/Visual Studio Code.app/Contents/MacOS/Code",
    "/Applications/Visual Studio Code.app/Contents/MacOS/Electron",
    join(
      process.env.HOME ?? "",
      "Applications/Visual Studio Code.app/Contents/MacOS/Code",
    ),
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

function isRunnable(candidate) {
  try {
    execFileSync(candidate, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function findMarkdownGrammar(executablePath) {
  const executableDirectory = dirname(executablePath);
  const relativeGrammar = join(
    "extensions",
    "markdown-basics",
    "syntaxes",
    "markdown.tmLanguage.json",
  );
  const candidates = [
    resolve(executableDirectory, "resources", "app", relativeGrammar),
    resolve(executableDirectory, "Resources", "app", relativeGrammar),
    resolve(executableDirectory, "..", "resources", "app", relativeGrammar),
    resolve(executableDirectory, "..", "Resources", "app", relativeGrammar),
    resolve(executableDirectory, "..", "..", "Resources", "app", relativeGrammar),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function findVsCodeCli() {
  if (process.env.VSCODE_CLI && isRunnable(process.env.VSCODE_CLI)) {
    return process.env.VSCODE_CLI;
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

const configuredExecutable = process.env.VSCODE_BIN
  ? findBundledExecutable()
  : undefined;
const executable = configuredExecutable ??
  (process.env.VSCODE_VERSION
    ? await downloadAndUnzipVSCode(process.env.VSCODE_VERSION)
    : findBundledExecutable() ?? (await downloadAndUnzipVSCode()));
const trustedWorkspace = mkdtempSync(join(tmpdir(), "eli-tw-"));
const restrictedWorkspace = mkdtempSync(join(tmpdir(), "eli-rw-"));
const artifactUserDataDir = mkdtempSync(join(tmpdir(), "eli-art-"));
const trustedUserDataDir = mkdtempSync(join(tmpdir(), "eli-tu-"));
const restrictedUserDataDir = mkdtempSync(join(tmpdir(), "eli-ru-"));
const extensionsDir = mkdtempSync(join(tmpdir(), "eli-ext-"));
const temporaryDirectories = [
  trustedWorkspace,
  restrictedWorkspace,
  artifactUserDataDir,
  trustedUserDataDir,
  restrictedUserDataDir,
  extensionsDir,
];
const vsix = join(artifactUserDataDir, "elisa-vscode.vsix");
const commonHostArgs = [
  "--disable-telemetry",
  "--disable-updates",
  "--skip-welcome",
  "--skip-release-notes",
];

function boundedOutput(maxBytes = 64 * 1024) {
  const chunks = [];
  let byteLength = 0;
  let droppedBytes = 0;
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(bytes);
      byteLength += bytes.length;
      while (byteLength > maxBytes && chunks.length > 0) {
        const excess = byteLength - maxBytes;
        const first = chunks[0];
        if (excess >= first.length) {
          chunks.shift();
          byteLength -= first.length;
          droppedBytes += first.length;
        } else {
          chunks[0] = first.subarray(excess);
          byteLength -= excess;
          droppedBytes += excess;
        }
      }
      callback();
    },
  });
  return {
    stream,
    read() {
      const prefix = droppedBytes > 0 ? `[earlier output omitted: ${droppedBytes} bytes]\n` : "";
      return prefix + Buffer.concat(chunks, byteLength).toString("utf8");
    },
  };
}

const stdout = boundedOutput();
const stderr = boundedOutput();

function killStrayHost() {
  if (process.platform === "win32") {
    return;
  }
  for (const userDataDir of [trustedUserDataDir, restrictedUserDataDir]) {
    try {
      execFileSync("pkill", ["-f", userDataDir], { stdio: "ignore" });
    } catch {
      // No host process for this isolated profile remains.
    }
  }
}

function launchRestrictedHost({ workspace, userDataDir, extensionTestsEnv }) {
  // @vscode/test-electron unconditionally adds --disable-workspace-trust. Launch
  // the same test host directly for this profile so the test exercises real Restricted Mode.
  const args = [
    workspace,
    ...commonHostArgs,
    "--user-data-dir",
    userDataDir,
    "--extensions-dir",
    extensionsDir,
    `--extensionTestsPath=${resolve(root, "integration", "suite")}`,
    `--extensionDevelopmentPath=${testHostPath}`,
  ];
  const child = spawn(executable, args, {
    env: { ...process.env, ...extensionTestsEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => stdout.stream.write(chunk));
  child.stderr.on("data", (chunk) => stderr.stream.write(chunk));
  return new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolveExit(code ?? 1));
  });
}

let timedOut = false;
let watchdog;
const timeout = new Promise((_, reject) => {
  watchdog = setTimeout(() => {
    timedOut = true;
    killStrayHost();
    reject(new Error("extension-host integration timed out after 60 seconds"));
  }, 60000);
  watchdog.unref();
});

try {
  const restrictedSettingsDirectory = join(restrictedUserDataDir, "User");
  mkdirSync(restrictedSettingsDirectory, { recursive: true });
  writeFileSync(
    join(restrictedSettingsDirectory, "settings.json"),
    JSON.stringify({ "security.workspace.trust.startupPrompt": "never" }, null, 2),
  );
  const restrictedWorkspaceSettings = join(restrictedWorkspace, ".vscode");
  mkdirSync(restrictedWorkspaceSettings, { recursive: true });
  writeFileSync(
    join(restrictedWorkspaceSettings, "settings.json"),
    JSON.stringify(
      {
        "elisa.languageServer.path": "/must-not-run-from-untrusted-workspace/elisa-lsp",
        "elisa.trace.server": "verbose",
      },
      null,
      2,
    ),
  );

  run("npm", ["run", "compile"]);
  run("npx", [
    "vsce",
    "package",
    "--out",
    vsix,
    "--allow-missing-repository",
  ]);

  const cli = findVsCodeCli();
  if (!cli) {
    throw new Error("VS Code CLI not found; set VSCODE_CLI or install 'code' on PATH");
  }
  const markdownGrammar = findMarkdownGrammar(executable);
  if (!markdownGrammar) {
    throw new Error(
      `could not locate the Markdown grammar shipped with ${executable}; ` +
        "the installed-host fence composition check cannot be skipped",
    );
  }
  run(cli, [
    "--install-extension",
    vsix,
    "--force",
    "--extensions-dir",
    extensionsDir,
    "--user-data-dir",
    artifactUserDataDir,
  ]);
  const installed = run(cli, [
    "--list-extensions",
    "--show-versions",
    "--extensions-dir",
    extensionsDir,
    "--user-data-dir",
    artifactUserDataDir,
  ])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (!installed.some((line) => line.toLowerCase().startsWith(extensionId))) {
    throw new Error(`isolated profile did not install ${extensionId}: ${installed.join(", ")}`);
  }
  const installedRoot = readdirSync(extensionsDir).find((entry) =>
    entry.toLowerCase().startsWith(extensionId),
  );
  if (!installedRoot) {
    throw new Error(`isolated extension directory does not contain ${extensionId}`);
  }
  const installedExtensionPath = join(extensionsDir, installedRoot);
  const markdownTestOutput = run(
    process.execPath,
    ["--test", "test/markdown-injection.test.mjs"],
    {
      ...process.env,
      ELISA_EXTENSION_ROOT: installedExtensionPath,
      VSCODE_MARKDOWN_GRAMMAR: markdownGrammar,
    },
  );
  process.stdout.write(markdownTestOutput);

  async function runInstalledHost({ workspace, userDataDir, trusted }) {
    const markers = [
      "fake-server-initialized",
      "fake-server-semantic-requested",
      "fake-server-verification-requested",
      "fake-server-shutdown",
      "fake-server-exit",
    ];
    const extensionTestsEnv = {
      ELISA_EXPECTED_EXTENSION_PATH: installedExtensionPath,
      ELISA_EXPECTED_TRUSTED: String(trusted),
      ELISA_LSP: resolve(root, "integration", "test-host", "fake-elisa-lsp.mjs"),
      ELISA_TEST_EXTENSION_ROOT: installedExtensionPath,
      ELISA_TEST_SERVER_INITIALIZED_MARKER: join(userDataDir, markers[0]),
      ELISA_TEST_SERVER_MARKER: join(userDataDir, markers[1]),
      ELISA_TEST_SERVER_VERIFICATION_MARKER: join(userDataDir, markers[2]),
      ELISA_TEST_SERVER_SHUTDOWN_MARKER: join(userDataDir, markers[3]),
      ELISA_TEST_SERVER_EXIT_MARKER: join(userDataDir, markers[4]),
    };
    const runHost = trusted
      ? runTests({
          vscodeExecutablePath: executable,
          extensionDevelopmentPath: testHostPath,
          extensionTestsPath: resolve(root, "integration", "suite"),
          extensionTestsEnv,
          launchArgs: [
            workspace,
            ...commonHostArgs,
            "--user-data-dir",
            userDataDir,
            "--extensions-dir",
            extensionsDir,
          ],
          stdout: stdout.stream,
          stderr: stderr.stream,
        })
      : launchRestrictedHost({ workspace, userDataDir, extensionTestsEnv });
    const code = await Promise.race([runHost, timeout]);
    if (code !== 0) {
      throw new Error(`VS Code (${trusted ? "trusted" : "Restricted Mode"}) exited with code ${code}`);
    }
    for (const marker of markers) {
      if (!existsSync(join(userDataDir, marker))) {
        throw new Error(
          `${trusted ? "trusted" : "Restricted Mode"} host did not complete LSP lifecycle stage: ${marker}`,
        );
      }
    }
    const serverPids = markers.map((marker) =>
      readFileSync(join(userDataDir, marker), "utf8").trim(),
    );
    if (!serverPids.every((pid) => /^\d+$/.test(pid)) || new Set(serverPids).size !== 1) {
      throw new Error("the LSP lifecycle markers did not come from the same process");
    }
    try {
      process.kill(Number(serverPids[0]), 0);
      throw new Error("the fake LSP process remained alive after the extension host exited");
    } catch (error) {
      if (error?.code !== "ESRCH") {
        throw error;
      }
    }
  }

  await runInstalledHost({
    workspace: trustedWorkspace,
    userDataDir: trustedUserDataDir,
    trusted: true,
  });
  await runInstalledHost({
    workspace: restrictedWorkspace,
    userDataDir: restrictedUserDataDir,
    trusted: false,
  });

  const hostOutput = `${stdout.read()}\n${stderr.read()}`;
  if (
    /configuration\.semanticTokenType\.id.*must follow the pattern|semanticTokenScopes\.scopes.*must be an array/i.test(
      hostOutput,
    )
  ) {
    throw new Error("VS Code rejected the semantic-token contribution schema");
  }
  console.log(
    `installed-VSIX trusted/Restricted Mode host integration and Markdown fence composition OK ` +
      `using ${executable}`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`extension-host integration ${timedOut ? "timed out" : "failed"}: ${message}`);
  const output = [stdout.read(), stderr.read()].filter((value) => value.length > 0).join("\n");
  if (output.length > 0) {
    console.error("--- bounded VS Code output tail ---");
    console.error(output);
  }
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  killStrayHost();
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
}
