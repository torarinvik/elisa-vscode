import * as os from "node:os";
import * as vscode from "vscode";
import {
  HoverRequest,
  LanguageClient,
  LanguageClientOptions,
  SemanticTokensRequest,
  ServerOptions,
  State,
  TransportKind,
} from "vscode-languageclient/node";
import { Trace } from "vscode-jsonrpc";
import {
  classifySettingsChange,
  parseSettings,
  type ParsedSettings,
  type TraceLevel,
} from "./config";
import { commandIds } from "./commandIds";
import { registerCommands } from "./commands";
import {
  semanticLegendCompatibilityIssue,
} from "./compatibility";
import { messages } from "./messages";
import { formatHealthReport, type HealthSnapshot } from "./health";
import {
  DiscoveryCache,
  NodeFileProbe,
  describeStatus,
  discoveryCacheKey,
  resolveServerForWorkspaceRoots,
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
import {
  describeSettingDivergence,
  distinctSettingValues,
  folderValuesSignature,
  resolveServerPathValues,
  settingValuesAreConsistent,
  workspaceServerContextChanged,
  type FolderSettingValue,
} from "./workspaceSessions";
import { selectTrustedSettingValue } from "./trust";

const languageSelector = [
  { scheme: "file", language: "elisa" },
  { scheme: "untitled", language: "elisa" },
];

const configurationSection = "elisa.languageServer";

const statusPresentation: Record<SessionState, { icon: string; tooltip: string }> = {
  inactive: { icon: "$(circle-outline)", tooltip: messages.status.inactive },
  resolving: { icon: "$(search)", tooltip: messages.status.resolving },
  starting: { icon: "$(sync~spin)", tooltip: messages.status.starting },
  ready: { icon: "$(check)", tooltip: messages.status.ready },
  degraded: { icon: "$(warning)", tooltip: messages.status.degraded },
  stopping: { icon: "$(circle-slash)", tooltip: messages.status.stopping },
  stopped: { icon: "$(circle-outline)", tooltip: messages.status.stopped },
  failed: { icon: "$(error)", tooltip: messages.status.failed },
};

interface RuntimeServices {
  configure(): Promise<void>;
  health(): Promise<void>;
}

interface Runtime {
  readonly context: vscode.ExtensionContext;
  readonly output: vscode.OutputChannel;
  readonly traceChannel: vscode.OutputChannel;
  readonly status: vscode.StatusBarItem;
  readonly cache: DiscoveryCache;
  session: ServerSession;
  readonly services: RuntimeServices;
  settings: ParsedSettings;
  client: LanguageClient | undefined;
  lastNotifiedFailure: string | undefined;
  languageRegistered: boolean;
  untrustedWorkspacePathWarningShown: boolean;
  workspaceRootSignature: string;
  serverPathSignature: string;
  traceSettingsSignature: string;
  trustedWorkspace: boolean;
}

let runtime: Runtime | undefined;

function configurationScope(): vscode.ConfigurationScope | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

function readSettings(): ParsedSettings {
  const pathSelection = configuredSettingSelection(configurationSection, "path");
  const traceSelection = configuredSettingSelection("elisa.trace", "server");
  const traceValues = folderSettingValues("elisa.trace", "server");
  const traceUnsafe = !settingValuesAreConsistent(traceValues);
  const parsed = parseSettings({
    languageServerPath: pathSelection.value,
    // Tracing is process-wide. If roots disagree, fail closed rather than
    // allowing one folder's verbose setting to capture every folder's source.
    trace: traceUnsafe ? "off" : traceSelection.value,
  });
  for (const diagnostic of parsed.diagnostics) {
    // Invalid path values fail the session with an actionable error below;
    // showing a second warning here would duplicate that notification.
    if (diagnostic.key === "elisa.languageServer.path") {
      continue;
    }
    void vscode.window.showWarningMessage(
      messages.invalidSetting(diagnostic.key, diagnostic.message),
    );
  }
  return parsed;
}

function configuredSettingSelection(
  section: string,
  key: string,
): ReturnType<typeof selectTrustedSettingValue> {
  const configuration = vscode.workspace.getConfiguration(section, configurationScope());
  return selectTrustedSettingValue(
    configuration.get(key),
    configuration.inspect(key),
    vscode.workspace.isTrusted,
  );
}

function folderSettingValues(section: string, key: string): FolderSettingValue[] {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const sharedBase = folders[0]?.uri.fsPath ?? runtime?.context.extensionPath ?? process.cwd();
  return folders.map((folder) => {
    const configuration = vscode.workspace.getConfiguration(section, folder.uri);
    const inspected = configuration.inspect(key);
    const selection = selectTrustedSettingValue(
      configuration.get<unknown>(key),
      inspected,
      vscode.workspace.isTrusted,
    );
    const folderScoped =
      vscode.workspace.isTrusted && inspected?.workspaceFolderValue !== undefined;
    return {
      folder: folder.uri.fsPath,
      value: typeof selection.value === "string" ? selection.value : "",
      valid: selection.value == null || typeof selection.value === "string",
      ...(folderScoped ? { baseDirectory: folder.uri.fsPath } : {}),
    };
  });
}

function resolvedServerPathValues(): FolderSettingValue[] {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const sharedBase = folders[0]?.uri.fsPath ?? runtime?.context.extensionPath ?? process.cwd();
  return resolveServerPathValues(
    folderSettingValues(configurationSection, "path"),
    sharedBase,
    os.homedir(),
  );
}

function workspaceRootSignature(): string {
  return JSON.stringify((vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.toString()));
}

function traceSettingsWarning(values: readonly FolderSettingValue[]): string | undefined {
  if (values.some((setting) => setting.valid === false)) {
    return messages.configuration.workspaceTraceInvalid;
  }
  if (!settingValuesAreConsistent(values)) {
    return messages.configuration.workspaceTraceDiverged;
  }
  return undefined;
}

function configurationWarnings(): string[] {
  const warnings: string[] = [];
  if (configuredSettingSelection(configurationSection, "path").workspaceOverrideIgnored) {
    warnings.push(messages.trust.workspacePathIgnored);
  }
  if (configuredSettingSelection("elisa.trace", "server").workspaceOverrideIgnored) {
    warnings.push(messages.trust.workspaceTraceIgnored);
  }
  const pathDivergence = describeSettingDivergence(
    "elisa.languageServer.path",
    resolvedServerPathValues(),
  );
  if (pathDivergence) {
    warnings.push(pathDivergence);
  }
  const traceValues = folderSettingValues("elisa.trace", "server");
  const traceDivergence = describeSettingDivergence(
    "elisa.trace.server",
    traceValues,
  );
  if (traceDivergence) {
    warnings.push(`${traceDivergence}; tracing is disabled for safety`);
  }
  const traceWarning = traceSettingsWarning(traceValues);
  if (traceWarning && !traceDivergence) {
    warnings.push(traceWarning);
  }
  return warnings;
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
  const invalidPath = state.settings.diagnostics.find(
    (diagnostic) => diagnostic.key === "elisa.languageServer.path",
  );
  if (invalidPath) {
    return {
      kind: "invalid-setting",
      setting: "elisa.languageServer.path",
      detail: invalidPath.message,
    };
  }
  const serverPaths = resolvedServerPathValues();
  if (!settingValuesAreConsistent(serverPaths)) {
    return {
      kind: "configuration-conflict",
      detail: messages.session.workspacePathConflictDetail,
    };
  }
  const options = discoveryOptions(settings);
  const key = discoveryCacheKey(options);
  const cached = state.cache.get(key);
  if (cached) {
    return cached;
  }
  const outcome = await resolveServerForWorkspaceRoots(options, {
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

function traceValue(level: TraceLevel): Trace {
  switch (level) {
    case "verbose":
      return Trace.Verbose;
    case "messages":
      return Trace.Messages;
    case "off":
      return Trace.Off;
  }
}

function applyTrace(state: Runtime): void {
  if (state.client) {
    void state.client.setTrace(traceValue(state.settings.trace));
  }
}

function offerTraceConsent(state: Runtime): void {
  void vscode.window
    .showWarningMessage(messages.traceWarning, messages.traceShowAction)
    .then((action) => {
      if (action === messages.traceShowAction) {
        state.traceChannel.show(true);
      }
      return undefined;
    });
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
    traceOutputChannel: state.traceChannel,
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
      void client.setTrace(traceValue(state.settings.trace));
      const degradedReason = semanticLegendCompatibilityIssue(
        state.context.extension.packageJSON,
        client.initializeResult,
      );
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
    trace: state.settings.trace,
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
  const ignoredPathWarning =
    failure.kind === "missing-server" &&
    configuredSettingSelection(configurationSection, "path").workspaceOverrideIgnored;
  const detail = ignoredPathWarning
    ? [failure.detail, messages.trust.workspacePathIgnored].filter(Boolean).join("; ")
    : failure.detail;
  if (ignoredPathWarning) {
    state.untrustedWorkspacePathWarningShown = true;
  }
  const key = `${failure.kind}:${detail ?? ""}`;
  if (state.lastNotifiedFailure === key) {
    return;
  }
  state.lastNotifiedFailure = key;
  const action = await vscode.window.showErrorMessage(
    `${failure.message}. ${detail ?? ""}`.trim(),
    messages.setupActions.openSetting,
    messages.setupActions.selectExecutable,
    messages.setupActions.setupGuide,
    messages.setupActions.discoveryReport,
  );
  switch (action) {
    case messages.setupActions.openSetting:
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "elisa.languageServer.path",
      );
      break;
    case messages.setupActions.selectExecutable:
      await state.services.configure();
      break;
    case messages.setupActions.setupGuide:
      await openExtensionDocument(state.context, "docs/setting-up.md");
      break;
    case messages.setupActions.discoveryReport:
      await state.services.health();
      break;
    default:
      break;
  }
}

async function promptWorkspacePathConflict(
  state: Runtime,
  failure: SessionFailure,
): Promise<void> {
  const key = `${failure.kind}:${failure.detail ?? ""}`;
  if (state.lastNotifiedFailure === key) {
    return;
  }
  state.lastNotifiedFailure = key;
  const action = await vscode.window.showErrorMessage(
    `${failure.message}. ${failure.detail ?? ""}`.trim(),
    messages.setupActions.openSetting,
  );
  if (action === messages.setupActions.openSetting) {
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "elisa.languageServer.path",
    );
  }
}

async function configureServer(state: Runtime): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    canSelectFolders: false,
    openLabel: messages.configure.openLabel,
    title: messages.configure.title,
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
      messages.configure.rejected(describeStatus(probe), selection.fsPath),
    );
    return;
  }
  const hasWorkspace = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
  const useWorkspaceTarget = hasWorkspace && vscode.workspace.isTrusted;
  const target = useWorkspaceTarget
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  const targetLabel = useWorkspaceTarget
    ? messages.configure.workspaceTarget
    : messages.configure.userTarget;
  const confirmed = await vscode.window.showInformationMessage(
    messages.configure.confirm(targetLabel),
    { modal: true },
    messages.configure.confirmAction,
  );
  if (confirmed !== messages.configure.confirmAction) {
    return;
  }
  await vscode.workspace
    .getConfiguration(configurationSection)
    .update("path", selection.fsPath, target);
}

async function explainHighlighting(state: Runtime): Promise<void> {
  const action = await vscode.window.showInformationMessage(
    messages.explain.text,
    messages.explain.guideAction,
    messages.explain.healthAction,
  );
  if (action === messages.explain.guideAction) {
    await openExtensionDocument(state.context, "docs/highlighting.md");
  } else if (action === messages.explain.healthAction) {
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
    messages.support.opened,
    messages.support.copyAction,
  );
  if (action === messages.support.copyAction) {
    await vscode.env.clipboard.writeText(document.getText());
    await vscode.window.showInformationMessage(messages.support.copied);
  }
}

async function reportRestartOutcome(state: Runtime): Promise<void> {
  const sessionState = state.session.state;
  if (sessionState === "ready" || sessionState === "degraded") {
    state.output.appendLine(`[restart] language server state: ${sessionState}`);
    return;
  }
  const failure = state.session.lastFailure;
  if (failure?.kind === "workspace-configuration-conflict") {
    state.output.appendLine(`[restart] blocked: ${failure.message}`);
    return;
  }
  if (failure?.kind === "workspace-limit") {
    state.output.appendLine(`[restart] blocked: ${failure.message}`);
    return;
  }
  const message = failure
    ? `${failure.message}${failure.detail ? `: ${failure.detail}` : ""}`
    : `state ${sessionState}`;
  void vscode.window.showWarningMessage(messages.restartNotReady(message));
}

async function waitFor<T>(
  operation: () => Promise<T | undefined>,
  timeoutMs: number,
  intervalMs: number,
): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const value = await operation();
      if (value !== undefined) {
        return value;
      }
    } catch {
      void 0;
    }
    if (Date.now() >= deadline) {
      return undefined;
    }
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, intervalMs));
  }
}

async function verifySupport(state: Runtime): Promise<void> {
  const snapshot = healthSnapshot(state);
  const lines = [
    formatHealthReport(snapshot, { homeDirectory: os.homedir() }),
    "",
    "## Live verification",
  ];
  const client = state.client;
  if (!client || state.session.state !== "ready") {
    lines.push("- Server requests: unavailable while the server is not ready");
    await showDocument(lines.join("\n"), "markdown");
    return;
  }

  const content = [
    "enum Verify:",
    "    Ok",
    "",
    "def check(xs: darray[i64]) -> i64:",
    "    total: mutable i64 = 0",
    "    r: i64 =",
    "        for x in xs |acc = 0, total| -> acc:",
    "            total <- total + x",
    "            acc <- acc + 1",
    "    return total + r",
    "",
    "def default_value() -> Verify:",
    "    return Verify.Ok",
  ].join("\n");
  const document = await vscode.workspace.openTextDocument({
    language: "elisa",
    content,
  });
  await vscode.window.showTextDocument(document, { preview: true });
  const uri = document.uri.toString();

  const tokens = await waitFor(
    async () => {
      const result = await client.sendRequest(SemanticTokensRequest.type, {
        textDocument: { uri },
      });
      return result && result.data.length > 0 ? result : undefined;
    },
    3000,
    150,
  );
  lines.push(
    tokens
      ? `- Semantic tokens: ${tokens.data.length / 5} spans returned for the verification document`
      : "- Semantic tokens: none returned; the server may not advertise them",
  );

  const hover = await client.sendRequest(HoverRequest.type, {
    textDocument: { uri },
    position: new vscode.Position(6, 20),
  });
  lines.push(
    hover
      ? "- Hover: content returned for the loop-header capture list"
      : "- Hover: no content returned at the hover position",
  );

  await showDocument(lines.join("\n"), "markdown");
}

async function showHealth(state: Runtime): Promise<void> {
  const report = formatHealthReport(healthSnapshot(state), {
    homeDirectory: os.homedir(),
  });
  await showDocument(report, "markdown");
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel(messages.serverOutputChannel);
  context.subscriptions.push(output);
  const traceChannel = vscode.window.createOutputChannel(messages.traceOutputChannel);
  context.subscriptions.push(traceChannel);
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = commandIds.showHealthReport;
  status.show();
  context.subscriptions.push(status);

  const cache = new DiscoveryCache();
  const state: Runtime = {
    context,
    output,
    traceChannel,
    status,
    cache,
    session: undefined as unknown as ServerSession,
    settings: readSettings(),
    client: undefined,
    lastNotifiedFailure: undefined,
    languageRegistered: false,
    untrustedWorkspacePathWarningShown: false,
    workspaceRootSignature: workspaceRootSignature(),
    serverPathSignature: folderValuesSignature(resolvedServerPathValues()),
    traceSettingsSignature: folderValuesSignature(folderSettingValues("elisa.trace", "server")),
    trustedWorkspace: vscode.workspace.isTrusted,
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
      if (
        (sessionState === "ready" || sessionState === "degraded") &&
        !state.untrustedWorkspacePathWarningShown &&
        configuredSettingSelection(configurationSection, "path").workspaceOverrideIgnored
      ) {
        state.untrustedWorkspacePathWarningShown = true;
        void vscode.window.showWarningMessage(messages.trust.workspacePathIgnored);
      }
      if (sessionState === "ready") {
        state.lastNotifiedFailure = undefined;
      }
    },
    onFailure: (failure) => {
      output.appendLine(`[failure:${failure.kind}] ${failure.message}${failure.detail ? `: ${failure.detail}` : ""}`);
      if (failure.kind === "workspace-configuration-conflict") {
        void promptWorkspacePathConflict(state, failure);
      } else if (failure.kind === "workspace-limit") {
        void vscode.window.showErrorMessage(
          `${failure.message}. ${failure.detail ?? ""}`.trim(),
        );
      } else if (failure.kind === "missing-server" || failure.kind === "invalid-configuration") {
        void promptMissingServer(state, failure);
      }
    },
  });
  state.session = session;
  updateStatus(state, session.state);
  const initialTraceWarning = traceSettingsWarning(folderSettingValues("elisa.trace", "server"));
  if (initialTraceWarning) {
    output.appendLine(`[config] ${initialTraceWarning}`);
  }

  registerCommands(context, {
    restartLanguageServer: async () => {
      output.appendLine("[command] restarting language server");
      cache.clear();
      await session.restart();
      await reportRestartOutcome(state);
    },
    showLanguageServerOutput: () => {
      output.show(true);
    },
    showHealthReport: async () => showHealth(state),
    verifySupport: async () => verifySupport(state),
    configureLanguageServer: async () => configureServer(state),
    explainHighlighting: async () => explainHighlighting(state),
    collectSupportReport: async () => collectSupportReport(state),
  });

  let debounce: ReturnType<typeof setTimeout> | undefined;
  const scheduleConfigurationRefresh = (reason: string): void => {
    if (debounce) {
      clearTimeout(debounce);
    }
    debounce = setTimeout(() => {
      debounce = undefined;
      const next = readSettings();
      const previous = state.settings;
      const change = classifySettingsChange(previous, next);
      const nextRootSignature = workspaceRootSignature();
      const nextPathSignature = folderValuesSignature(resolvedServerPathValues());
      const nextTraceValues = folderSettingValues("elisa.trace", "server");
      const nextTraceSignature = folderValuesSignature(nextTraceValues);
      const nextTrust = vscode.workspace.isTrusted;
      const tracesChanged = nextTraceSignature !== state.traceSettingsSignature;
      const serverContextChanged = workspaceServerContextChanged(
        {
          roots: state.workspaceRootSignature,
          paths: state.serverPathSignature,
          trusted: state.trustedWorkspace,
        },
        {
          roots: nextRootSignature,
          paths: nextPathSignature,
          trusted: nextTrust,
        },
      );
      state.settings = next;
      state.workspaceRootSignature = nextRootSignature;
      state.serverPathSignature = nextPathSignature;
      state.traceSettingsSignature = nextTraceSignature;
      state.trustedWorkspace = nextTrust;

      const nextTraceWarning = traceSettingsWarning(nextTraceValues);
      if (tracesChanged && nextTraceWarning) {
        output.appendLine(`[config] ${nextTraceWarning}`);
      }
      if (change === "session-restart" || serverContextChanged) {
        cache.clear();
        output.appendLine(`[config] ${reason}; restarting the language server`);
        void session.restart().then(() => reportRestartOutcome(state));
      } else if (change === "presentation") {
        output.appendLine(`[config] trace level changed to ${next.trace}`);
        applyTrace(state);
        if (previous.trace === "off" && next.trace !== "off") {
          offerTraceConsent(state);
        }
      }
    }, 300);
  };

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      const folders = vscode.workspace.workspaceFolders ?? [];
      const affects = (section: string): boolean =>
        event.affectsConfiguration(section) ||
        folders.some((folder) => event.affectsConfiguration(section, folder.uri));
      if (
        !affects(configurationSection) &&
        !affects("elisa.trace.server")
      ) {
        return;
      }
      scheduleConfigurationRefresh("Elisa settings changed");
    }),
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      scheduleConfigurationRefresh("workspace folders changed");
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
      scheduleConfigurationRefresh("workspace trust changed");
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
