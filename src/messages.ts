export const messages = {
  serverOutputChannel: "Elisa Language Server",
  traceOutputChannel: "Elisa Language Server Trace",
  status: {
    inactive: "Elisa: inactive",
    resolving: "Elisa: locating language server",
    starting: "Elisa: starting language server",
    ready: "Elisa: language server ready",
    degraded: "Elisa: language server degraded",
    stopping: "Elisa: stopping language server",
    stopped: "Elisa: language server stopped",
    failed: "Elisa: language server unavailable",
  },
  invalidSetting: (key: string, detail: string): string => `Elisa setting ${key} ${detail}.`,
  traceWarning:
    "Elisa protocol tracing may include source code. Enable it only for temporary diagnostics and disable it when finished.",
  traceShowAction: "Show Trace Output",
  restartNotReady: (detail: string): string =>
    `Elisa language server did not become ready: ${detail}`,
  setupActions: {
    openSetting: "Open Setting",
    selectExecutable: "Select Executable",
    setupGuide: "Setup Guide",
    discoveryReport: "Show Discovery Report",
  },
  configure: {
    openLabel: "Select server executable",
    title: "Select the Elisa language server executable",
    rejected: (status: string, path: string): string =>
      `The selected file is ${status}: ${path}`,
    confirm: (target: string): string =>
      `Write elisa.languageServer.path to ${target}?`,
    confirmAction: "Write Setting",
    workspaceTarget: "this workspace's settings",
    userTarget: "your user settings",
  },
  explain: {
    text: "Elisa highlighting has two layers: TextMate lexical scopes (always available) and semantic tokens (available once the language server is ready).",
    guideAction: "Open Highlighting Guide",
    healthAction: "Show Health Report",
  },
  support: {
    opened:
      "Support report preview opened. Review it before sharing; nothing is uploaded automatically.",
    copyAction: "Copy to Clipboard",
    copied: "Elisa support report copied to the clipboard.",
  },
  session: {
    discoveryFailed: "Language server discovery failed",
    invalidSetting: (setting: string): string =>
      `${setting} points to a unusable language server`,
    missingServer: "No Elisa language server was found",
    missingServerDetail: "Build Elisa-LSP or configure elisa.languageServer.path",
    spawnFailed: "Language server failed to spawn",
    initializationFailed: "Language server failed to initialize",
    crashed: "Language server exited unexpectedly",
    retriesExhausted: (attempts: number): string =>
      `Language server crashed ${attempts} times; automatic restart disabled`,
  },
} as const;
