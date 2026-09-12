export type TraceLevel = "off" | "messages" | "verbose";

const traceLevels: readonly TraceLevel[] = ["off", "messages", "verbose"];

export interface RawSettings {
  readonly languageServerPath: unknown;
  readonly trace?: unknown;
}

export interface SettingsDiagnostic {
  readonly key: string;
  readonly message: string;
}

export interface ParsedSettings {
  readonly languageServerPath: string;
  readonly trace: TraceLevel;
  readonly diagnostics: readonly SettingsDiagnostic[];
}

export type ChangeClass = "none" | "presentation" | "session-restart" | "project-reanalysis";

function parsePath(raw: unknown, diagnostics: SettingsDiagnostic[]): string {
  if (typeof raw === "string") {
    if (raw.includes("\0")) {
      diagnostics.push({
        key: "elisa.languageServer.path",
        message: "contains a NUL character and was ignored",
      });
      return "";
    }
    return raw.trim();
  }
  if (raw !== undefined && raw !== null) {
    diagnostics.push({
      key: "elisa.languageServer.path",
      message: `expected a string but found ${typeof raw}`,
    });
  }
  return "";
}

function parseTrace(raw: unknown, diagnostics: SettingsDiagnostic[]): TraceLevel {
  if (raw === undefined || raw === null) {
    return "off";
  }
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if ((traceLevels as readonly string[]).includes(normalized)) {
      return normalized as TraceLevel;
    }
    diagnostics.push({
      key: "elisa.trace.server",
      message: `expected one of ${traceLevels.join(", ")} but found "${raw}"`,
    });
    return "off";
  }
  diagnostics.push({
    key: "elisa.trace.server",
    message: `expected a string but found ${typeof raw}`,
  });
  return "off";
}

export function parseSettings(raw: RawSettings): ParsedSettings {
  const diagnostics: SettingsDiagnostic[] = [];
  const languageServerPath = parsePath(raw.languageServerPath, diagnostics);
  const trace = parseTrace(raw.trace, diagnostics);
  return { languageServerPath, trace, diagnostics };
}

export function classifySettingsChange(previous: ParsedSettings, next: ParsedSettings): ChangeClass {
  if (previous.languageServerPath !== next.languageServerPath) {
    return "session-restart";
  }
  if (previous.trace !== next.trace) {
    return "presentation";
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
