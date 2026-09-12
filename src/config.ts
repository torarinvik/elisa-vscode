export interface RawSettings {
  readonly languageServerPath: unknown;
}

export interface SettingsDiagnostic {
  readonly key: string;
  readonly message: string;
}

export interface ParsedSettings {
  readonly languageServerPath: string;
  readonly diagnostics: readonly SettingsDiagnostic[];
}

export type ChangeClass = "none" | "presentation" | "session-restart" | "project-reanalysis";

export function parseSettings(raw: RawSettings): ParsedSettings {
  const diagnostics: SettingsDiagnostic[] = [];
  let languageServerPath = "";
  if (typeof raw.languageServerPath === "string") {
    if (raw.languageServerPath.includes("\0")) {
      diagnostics.push({
        key: "elisa.languageServer.path",
        message: "contains a NUL character and was ignored",
      });
    } else {
      languageServerPath = raw.languageServerPath.trim();
    }
  } else if (raw.languageServerPath !== undefined && raw.languageServerPath !== null) {
    diagnostics.push({
      key: "elisa.languageServer.path",
      message: `expected a string but found ${typeof raw.languageServerPath}`,
    });
  }
  return { languageServerPath, diagnostics };
}

export function classifySettingsChange(previous: ParsedSettings, next: ParsedSettings): ChangeClass {
  if (previous.languageServerPath !== next.languageServerPath) {
    return "session-restart";
  }
  return "none";
}

export function isRelativePath(value: string): boolean {
  return (
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.startsWith("\\") &&
    !/^[A-Za-z]:[\\/]/.test(value)
  );
}
