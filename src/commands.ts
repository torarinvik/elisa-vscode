import * as vscode from "vscode";
import { commandIds } from "./commandIds";

export interface CommandServices {
  restartLanguageServer(): Promise<void>;
  showLanguageServerOutput(): void;
  showHealthReport(): Promise<void>;
  verifySupport(): Promise<void>;
  configureLanguageServer(): Promise<void>;
  explainHighlighting(): Promise<void>;
  collectSupportReport(): Promise<void>;
}

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
  register(commandIds.verifySupport, () => services.verifySupport());
  register(commandIds.configureLanguageServer, () => services.configureLanguageServer());
  register(commandIds.explainHighlighting, () => services.explainHighlighting());
  register(commandIds.collectSupportReport, () => services.collectSupportReport());
}
