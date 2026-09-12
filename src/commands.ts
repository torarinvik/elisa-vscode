import * as vscode from "vscode";

export interface CommandServices {
  restartLanguageServer(): Promise<void>;
  showLanguageServerOutput(): void;
  showHealthReport(): Promise<void>;
  configureLanguageServer(): Promise<void>;
  explainHighlighting(): Promise<void>;
  collectSupportReport(): Promise<void>;
}

export const commandIds = {
  restartLanguageServer: "elisa.restartLanguageServer",
  showLanguageServerOutput: "elisa.showLanguageServerOutput",
  showHealthReport: "elisa.showHealthReport",
  configureLanguageServer: "elisa.configureLanguageServer",
  explainHighlighting: "elisa.explainHighlighting",
  collectSupportReport: "elisa.collectSupportReport",
} as const;

export function registerCommands(
  context: vscode.ExtensionContext,
  services: CommandServices,
): void {
  const register = (id: string, handler: () => Promise<void> | void): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  };

  register(commandIds.restartLanguageServer, () => services.restartLanguageServer());
  register(commandIds.showLanguageServerOutput, () => services.showLanguageServerOutput());
  register(commandIds.showHealthReport, () => services.showHealthReport());
  register(commandIds.configureLanguageServer, () => services.configureLanguageServer());
  register(commandIds.explainHighlighting, () => services.explainHighlighting());
  register(commandIds.collectSupportReport, () => services.collectSupportReport());
}
