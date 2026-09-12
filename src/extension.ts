import * as os from "node:os";
import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  State,
  TransportKind,
} from "vscode-languageclient/node";
import { classifySettingsChange, parseSettings, type ParsedSettings } from "./config";
import { commandIds, registerCommands } from "./commands";
import { compareLegends, describeLegendComparison } from "./compatibility";
import { formatHealthReport, type HealthSnapshot } from "./health";
import {
  DiscoveryCache,
  NodeFileProbe,
  describeStatus,
  discoveryCacheKey,
  resolveServer,
  type DiscoveryCandidate,
  type DiscoveryOptions,
  type DiscoveryOutcome,
  type ServerResolution,
} from "./serverDiscovery";
import {
  ServerSession,
  SessionConnectError,
  type ConnectionState,
  type ServerConnection,
  type SessionFailure,
  type SessionState,
} from "./serverSession";
import { describeSettingDivergence, type FolderSettingValue } from "./workspaceSessions";

const languageSelector = [
  { scheme: "file", language: "elisa" },
  { scheme: "untitled", language: "elisa" },
];

const configurationSection = "elisa.languageServer";

const statusPresentation: Record<SessionState, { icon: string; tooltip: string }> = {
  inactive: { icon: "$(circle-outline)", tooltip: "Elisa: inactive" },
  resolving: { icon: "$(search)", tooltip: "Elisa: locating language server" },
  starting: { icon: "$(sync~spin)", tooltip: "Elisa: starting language server" },
  ready: { icon: "$(check)", tooltip: "Elisa: language server ready" },
  degraded: { icon: "$(warning)", tooltip: "Elisa: language server degraded" },
  stopping: { icon: "$(circle-slash)", tooltip: "Elisa: stopping language server" },
  stopped: { icon: "$(circle-outline)", tooltip: "Elisa: language server stopped" },
  failed: { icon: "$(error)", tooltip: "Elisa: language server unavailable" },
};

interface RuntimeServices {
  configure(): Promise<void>;
  health(): Promise<void>;
}

interface Runtime {
  readonly context: vscode.ExtensionContext;
  readonly output: vscode.OutputChannel;
  readonly status: vscode.StatusBarItem;
  readonly cache: DiscoveryCache;
  session: ServerSession;
  readonly services: RuntimeServices;
  settings: ParsedSettings;
  client: LanguageClient | undefined;
  lastNotifiedFailure: string | undefined;
  languageRegistered: boolean;
}

let runtime: Runtime | undefined;

function configurationScope(): vscode.ConfigurationScope | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

function readSettings(): ParsedSettings {
  const configuration = vscode.workspace.getConfiguration(
    configurationSection,
    configurationScope(),
  );
  const parsed = parseSettings({ languageServerPath: configuration.get("path") });
  for (const diagnostic of parsed.diagnostics) {
    void vscode.window.showWarningMessage(`Elisa setting ${diagnostic.key} ${diagnostic.message}.`);
  }
  return parsed;
}

function folderSettingValues(): FolderSettingValue[] {
  return (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
    folder: folder.uri.fsPath,
    value: String(
      vscode.workspace.getConfiguration(configurationSection, folder.uri).get("path") ?? "",
    ),
  }));
}

function configurationWarnings(): string[] {
  const divergence = describeSettingDivergence(
    "elisa.languageServer.path",
    folderSettingValues(),
  );
  return divergence ? [divergence] : [];
}

function discoveryOptions(settings: ParsedSettings): DiscoveryOptions {
  return {
    configuredPath: settings.languageServerPath,
    environmentPath: process.env.ELISA_LSP ?? "",
    workspaceRoots: (vscode.workspace.workspaceFolders ?? []).map(
      (folder) => folder.uri.fsPath,
    ),
    extensionPath: runtime?.context.extensionPath ?? "",
    homeDirectory: os.homedir(),
    platform: process.platform,
    environmentPathValue: process.env.PATH ?? "",
    pathDelimiter: process.platform === "win32" ? ";" : ":",
    trusted: vscode.workspace.isTrusted,
  };
}

async function discover(settings: ParsedSettings): Promise<DiscoveryOutcome> {
  const state = runtime;
  if (!state) {
    return { kind: "missing", probes: [] };
  }
  const options = discoveryOptions(settings);
  const key = discoveryCacheKey(options);
  const cached = state.cache.get(key);
  if (cached) {
    return cached;
  }
  const outcome = await resolveServer(options, {
    probe: new NodeFileProbe(),
    concurrency: 4,
  });
  if (outcome.kind === "resolved") {
    state.cache.put(key, outcome);
  }
  return outcome;
}

function classifyConnectError(error: unknown): "spawn" | "initialization" {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOENT" || code === "EACCES" || code === "EPERM" || code === "ENOTDIR") {
    return "spawn";
  }
  return "initialization";
}

function declaredLegend(context: vscode.ExtensionContext): string[] {
  const contributes = (
    context.extension.packageJSON as {
      contributes?: { semanticTokenTypes?: ReadonlyArray<{ id?: string }> };
    }
  ).contributes;
  return (contributes?.semanticTokenTypes ?? [])
    .map((type) => type.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

function serverLegend(result: unknown): string[] | undefined {
  const legend = (
    result as {
      capabilities?: {
        semanticTokensProvider?: { legend?: { tokenTypes?: unknown } };
      };
    }
  )?.capabilities?.semanticTokensProvider?.legend?.tokenTypes;
  if (!Array.isArray(legend)) {
    return undefined;
  }
  return legend.filter((entry): entry is string => typeof entry === "string");
}

function createConnection(
  state: Runtime,
  server: ServerResolution,
): Promise<ServerConnection> {
  const serverOptions: ServerOptions = {
    run: { command: server.executable, transport: TransportKind.stdio },
    debug: { command: server.executable, transport: TransportKind.stdio },
  };
  const clientOptions: LanguageClientOptions = {
    documentSelector: languageSelector,
    synchronize: { configurationSection },
    outputChannel: state.output,
  };
  const client = new LanguageClient(
    "elisaLanguageServer",
    "Elisa Language Server",
    serverOptions,
    clientOptions,
  );
  const listeners = new Set<(connectionState: ConnectionState) => void>();
  client.onDidChangeState((event) => {
    const mapped: ConnectionState =
      event.newState === State.Running
        ? "running"
        : event.newState === State.Starting
          ? "starting"
          : "stopped";
    for (const listener of listeners) {
      listener(mapped);
    }
  });

  return client
    .start()
    .then(() => {
      state.client = client;
      const comparison = compareLegends(
        declaredLegend(state.context),
        serverLegend(client.initializeResult),
      );
      const degradedReason = comparison ? describeLegendComparison(comparison) : undefined;
      if (degradedReason) {
        state.output.appendLine(`[compatibility] semantic token legend mismatch: ${degradedReason}`);
      }
      return {
        degradedReason,
        onStateChange(listener: (connectionState: ConnectionState) => void) {
          listeners.add(listener);
          return {
            dispose: () => {
              listeners.delete(listener);
            },
          };
        },
        async stop(): Promise<void> {
          listeners.clear();
          if (state.client === client) {
            state.client = undefined;
          }
          await client.stop();
          client.dispose();
        },
      };
    })
    .catch((error: unknown) => {
      client.dispose();
      state.cache.clear();
      throw new SessionConnectError(String(error), classifyConnectError(error));
    });
}

function updateStatus(state: Runtime, sessionState: SessionState): void {
  const presentation = statusPresentation[sessionState];
  state.status.text = `${presentation.icon} Elisa`;
  state.status.tooltip = presentation.tooltip;
  state.status.accessibilityInformation = {
    label: `Elisa language support: ${presentation.tooltip.replace(/^Elisa: /, "")}`,
  };
}

function advertisedCapabilities(capabilities: unknown): string[] {
  if (!capabilities || typeof capabilities !== "object") {
    return [];
  }
  const caps = capabilities as Record<string, unknown>;
  const entries: ReadonlyArray<readonly [string, string]> = [
    ["document synchronization", "textDocumentSync"],
    ["hover", "hoverProvider"],
    ["semantic tokens", "semanticTokensProvider"],
    ["document symbols", "documentSymbolProvider"],
    ["definition", "definitionProvider"],
    ["declaration", "declarationProvider"],
    ["type definition", "typeDefinitionProvider"],
    ["references", "referencesProvider"],
    ["document highlights", "documentHighlightProvider"],
    ["completion", "completionProvider"],
    ["signature help", "signatureHelpProvider"],
    ["rename", "renameProvider"],
    ["code actions", "codeActionProvider"],
    ["formatting", "documentFormattingProvider"],
    ["inlay hints", "inlayHintProvider"],
    ["folding ranges", "foldingRangeProvider"],
    ["selection ranges", "selectionRangeProvider"],
    ["document links", "documentLinkProvider"],
    ["workspace symbols", "workspaceSymbolProvider"],
  ];
  return entries
    .filter(([, key]) => {
      const value = caps[key];
      return value !== undefined && value !== false && value !== null;
    })
    .map(([label]) => label);
}

function healthSnapshot(state: Runtime): HealthSnapshot {
  const client = state.client;
  const initializeResult = client?.initializeResult;
  const serverInfo = initializeResult?.serverInfo;
  const identity = serverInfo
    ? `${serverInfo.name ?? "elisa-lsp"}${serverInfo.version ? ` ${serverInfo.version}` : ""}`
    : undefined;
  const server = state.session.resolvedServer;
  return {
    extensionVersion: String(
      (state.context.extension.packageJSON as { version?: string }).version ?? "unknown",
    ),
    buildIdentifier: process.env.ELISA_VSCODE_BUILD_ID ?? "local",
    hostKind:
      vscode.env.uiKind === vscode.UIKind.Web
        ? "web"
        : vscode.env.remoteName
          ? "remote-workspace"
          : "desktop",
    platform: process.platform,
    architecture: process.arch,
    workspaceCount: vscode.workspace.workspaceFolders?.length ?? 0,
    trusted: vscode.workspace.isTrusted,
    languageIdConfigured: state.languageRegistered,
    serverPathSource: server ? `${server.source} (${server.origin})` : undefined,
    serverExecutable: server?.executable,
    serverState: state.session.state,
    serverIdentity: identity,
    encoding: initializeResult?.capabilities.positionEncoding,
    capabilities: advertisedCapabilities(initializeResult?.capabilities),
    lastFailure: state.session.lastFailure,
    resourceLimits: [],
    warnings: configurationWarnings(),
  };
}

async function showDocument(content: string, language: string): Promise<vscode.TextDocument> {
  const document = await vscode.workspace.openTextDocument({ content, language });
  await vscode.window.showTextDocument(document, { preview: false });
  return document;
}

function extensionDocument(context: vscode.ExtensionContext, relative: string): vscode.Uri {
  return vscode.Uri.joinPath(context.extensionUri, relative);
}

async function openExtensionDocument(
  context: vscode.ExtensionContext,
  relative: string,
): Promise<void> {
  const document = await vscode.workspace.openTextDocument(extensionDocument(context, relative));
  await vscode.window.showTextDocument(document, { preview: false });
}

async function promptMissingServer(state: Runtime, failure: SessionFailure): Promise<void> {
  const key = `${failure.kind}:${failure.detail ?? ""}`;
  if (state.lastNotifiedFailure === key) {
    return;
  }
  state.lastNotifiedFailure = key;
  const action = await vscode.window.showErrorMessage(
    `${failure.message}. ${failure.detail ?? ""}`.trim(),
    "Open Setting",
    "Select Executable",
    "Setup Guide",
    "Show Discovery Report",
  );
  switch (action) {
    case "Open Setting":
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "elisa.languageServer.path",
      );
      break;
    case "Select Executable":
      await state.services.configure();
      break;
    case "Setup Guide":
      await openExtensionDocument(state.context, "docs/setting-up.md");
      break;
    case "Show Discovery Report":
      await state.services.health();
      break;
    default:
      break;
  }
}

async function configureServer(state: Runtime): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    canSelectFolders: false,
    openLabel: "Select server executable",
    title: "Select the Elisa language server executable",
  });
  const selection = picked?.[0];
  if (!selection) {
    return;
  }
  const candidate: DiscoveryCandidate = {
    path: selection.fsPath,
    source: "setting",
    origin: "elisa.languageServer.path",
  };
  const probe = await new NodeFileProbe().probeFile(candidate, process.platform);
  if (probe.status !== "ok") {
    await vscode.window.showErrorMessage(
      `The selected file is ${describeStatus(probe)}: ${selection.fsPath}`,
    );
    return;
  }
  const hasWorkspace = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
  const target = hasWorkspace
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  const targetLabel = hasWorkspace ? "this workspace's settings" : "your user settings";
  const confirmed = await vscode.window.showInformationMessage(
    `Write elisa.languageServer.path to ${targetLabel}?`,
    { modal: true },
    "Write Setting",
  );
  if (confirmed !== "Write Setting") {
    return;
  }
  await vscode.workspace
    .getConfiguration(configurationSection)
    .update("path", selection.fsPath, target);
}

async function explainHighlighting(state: Runtime): Promise<void> {
  const action = await vscode.window.showInformationMessage(
    "Elisa highlighting has two layers: TextMate lexical scopes (always available) and semantic tokens (available once the language server is ready).",
    "Open Highlighting Guide",
    "Show Health Report",
  );
  if (action === "Open Highlighting Guide") {
    await openExtensionDocument(state.context, "docs/highlighting.md");
  } else if (action === "Show Health Report") {
    await showHealth(state);
  }
}

async function collectSupportReport(state: Runtime): Promise<void> {
  const report = formatHealthReport(healthSnapshot(state), {
    homeDirectory: os.homedir(),
    preview: true,
  });
  const document = await showDocument(report, "markdown");
  const action = await vscode.window.showInformationMessage(
    "Support report preview opened. Review it before sharing; nothing is uploaded automatically.",
    "Copy to Clipboard",
  );
  if (action === "Copy to Clipboard") {
    await vscode.env.clipboard.writeText(document.getText());
    await vscode.window.showInformationMessage("Elisa support report copied to the clipboard.");
  }
}

async function reportRestartOutcome(state: Runtime): Promise<void> {
  const sessionState = state.session.state;
  if (sessionState === "ready" || sessionState === "degraded") {
    state.output.appendLine(`[restart] language server state: ${sessionState}`);
    return;
  }
  const failure = state.session.lastFailure;
  const message = failure
    ? `${failure.message}${failure.detail ? `: ${failure.detail}` : ""}`
    : `state ${sessionState}`;
  void vscode.window.showWarningMessage(`Elisa language server did not become ready: ${message}`);
}

async function showHealth(state: Runtime): Promise<void> {
  const report = formatHealthReport(healthSnapshot(state), {
    homeDirectory: os.homedir(),
  });
  await showDocument(report, "markdown");
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Elisa Language Server");
  context.subscriptions.push(output);
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = commandIds.showHealthReport;
  status.show();
  context.subscriptions.push(status);

  const cache = new DiscoveryCache();
  const state: Runtime = {
    context,
    output,
    status,
    cache,
    session: undefined as unknown as ServerSession,
    settings: readSettings(),
    client: undefined,
    lastNotifiedFailure: undefined,
    languageRegistered: false,
    services: {
      configure: async () => configureServer(state),
      health: async () => showHealth(state),
    },
  };

  const session = new ServerSession({
    discover: () => discover(state.settings),
    connect: (server) => createConnection(state, server),
    log: (message) => {
      output.appendLine(`[${new Date().toISOString()}] ${message}`);
    },
    onStateChange: (sessionState) => {
      updateStatus(state, sessionState);
      if (sessionState === "ready") {
        state.lastNotifiedFailure = undefined;
      }
    },
    onFailure: (failure) => {
      output.appendLine(`[failure:${failure.kind}] ${failure.message}${failure.detail ? `: ${failure.detail}` : ""}`);
      if (failure.kind === "missing-server" || failure.kind === "invalid-configuration") {
        void promptMissingServer(state, failure);
      }
    },
  });
  state.session = session;
  updateStatus(state, session.state);

  registerCommands(context, {
    restartLanguageServer: async () => {
      output.appendLine("[command] restarting language server");
      await session.restart();
      await reportRestartOutcome(state);
    },
    showLanguageServerOutput: () => {
      output.show(true);
    },
    showHealthReport: async () => showHealth(state),
    configureLanguageServer: async () => configureServer(state),
    explainHighlighting: async () => explainHighlighting(state),
    collectSupportReport: async () => collectSupportReport(state),
  });

  let debounce: ReturnType<typeof setTimeout> | undefined;
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration(configurationSection)) {
        return;
      }
      if (debounce) {
        clearTimeout(debounce);
      }
      debounce = setTimeout(() => {
        debounce = undefined;
        const next = readSettings();
        const change = classifySettingsChange(state.settings, next);
        state.settings = next;
        if (change === "session-restart") {
          cache.clear();
          output.appendLine(
            "[config] elisa.languageServer.path changed; restarting the language server",
          );
          void session.restart().then(() => reportRestartOutcome(state));
        }
      }, 300);
    }),
  );
  context.subscriptions.push({
    dispose: () => {
      if (debounce) {
        clearTimeout(debounce);
        debounce = undefined;
      }
    },
  });

  context.subscriptions.push(
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      cache.clear();
      void session.restart();
    }),
  );

  runtime = state;
  void vscode.languages.getLanguages().then((languages) => {
    state.languageRegistered = languages.includes("elisa");
  });
  void session.start();
}

export function deactivate(): Thenable<void> | undefined {
  const state = runtime;
  runtime = undefined;
  state?.status.dispose();
  return state?.session.dispose();
}
