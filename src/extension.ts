import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

let languageClient: LanguageClient | undefined;

function executableName(): string {
  return process.platform === "win32" ? "elisa-lsp.exe" : "elisa-lsp";
}

function usableExecutable(candidate: string): boolean {
  try {
    const stat = fs.statSync(candidate);
    if (!stat.isFile()) {
      return false;
    }
    return process.platform === "win32" || (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function expandConfiguredPath(value: string, baseDirectory: string): string {
  const expanded = value.startsWith("~/")
    ? path.join(os.homedir(), value.slice(2))
    : value;
  return path.isAbsolute(expanded)
    ? expanded
    : path.resolve(baseDirectory, expanded);
}

function findOnPath(name: string): string | undefined {
  for (const entry of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!entry) {
      continue;
    }
    const candidate = path.join(entry, name);
    if (usableExecutable(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function findSiblingLanguageServer(context: vscode.ExtensionContext): string | undefined {
  const roots = [workspaceRoot(), context.extensionPath].filter(
    (root): root is string => root !== undefined,
  );
  const visited = new Set<string>();

  for (const root of roots) {
    let current = path.resolve(root);
    for (let depth = 0; depth <= 5; depth += 1) {
      const candidates = [
        path.join(current, "build", executableName()),
        path.join(current, "Elisa-LSP", "build", executableName()),
      ];
      for (const candidate of candidates) {
        const normalized = path.resolve(candidate);
        if (!visited.has(normalized)) {
          visited.add(normalized);
          if (usableExecutable(normalized)) {
            return normalized;
          }
        }
      }

      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  }
  return undefined;
}

function resolveServerPath(context: vscode.ExtensionContext): { executable: string; source: string } | undefined {
  const configured = vscode.workspace
    .getConfiguration("elisa.languageServer")
    .get<string>("path", "")
    .trim();
  const envPath = (process.env.ELISA_LSP ?? "").trim();
  const explicit = configured || envPath;

  if (explicit) {
    const candidate = expandConfiguredPath(explicit, workspaceRoot() ?? context.extensionPath);
    if (!usableExecutable(candidate)) {
      const setting = configured ? "elisa.languageServer.path" : "ELISA_LSP";
      throw new Error(`${setting} points to a missing or non-executable file: ${candidate}`);
    }
    return { executable: candidate, source: configured ? "VSCode setting" : "ELISA_LSP" };
  }

  const sibling = findSiblingLanguageServer(context);
  if (sibling) {
    return { executable: sibling, source: "nearby Elisa-LSP build" };
  }

  const fromPath = findOnPath(executableName());
  if (fromPath) {
    return { executable: fromPath, source: "PATH" };
  }
  return undefined;
}

function showMissingServerMessage(): void {
  void vscode.window
    .showErrorMessage(
      "Elisa language support could not find elisa-lsp. Build Elisa-LSP or configure elisa.languageServer.path.",
      "Open Setting",
    )
    .then((action) => {
      if (action === "Open Setting") {
        return vscode.commands.executeCommand("workbench.action.openSettings", "elisa.languageServer.path");
      }
      return undefined;
    });
}

export function activate(context: vscode.ExtensionContext): void {
  let server: { executable: string; source: string } | undefined;
  try {
    server = resolveServerPath(context);
  } catch (error) {
    void vscode.window.showErrorMessage(`Elisa language server was not started: ${String(error)}`);
    return;
  }

  if (!server) {
    showMissingServerMessage();
    return;
  }

  const outputChannel = vscode.window.createOutputChannel("Elisa Language Server");
  outputChannel.appendLine(`Starting ${server.executable} (${server.source})`);
  context.subscriptions.push(outputChannel);

  const serverOptions: ServerOptions = {
    run: {
      command: server.executable,
      transport: TransportKind.stdio,
    },
    debug: {
      command: server.executable,
      transport: TransportKind.stdio,
    },
  };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "elisa" },
      { scheme: "untitled", language: "elisa" },
    ],
    synchronize: {
      configurationSection: "elisa.languageServer",
    },
    outputChannel,
  };

  languageClient = new LanguageClient(
    "elisaLanguageServer",
    "Elisa Language Server",
    serverOptions,
    clientOptions,
  );
  const client = languageClient;
  context.subscriptions.push({
    dispose: () => {
      void client.stop();
    },
  });
  void client.start().catch((error: unknown) => {
    outputChannel.appendLine(`Language server failed to start: ${String(error)}`);
    void vscode.window.showErrorMessage(`Elisa language server failed to start: ${String(error)}`);
  });
}

export function deactivate(): Thenable<void> | undefined {
  const client = languageClient;
  languageClient = undefined;
  return client?.stop();
}
