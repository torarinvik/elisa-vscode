import type { SessionFailure, SessionState } from "./serverSession";

export interface HealthSnapshot {
  readonly extensionVersion: string;
  readonly buildIdentifier: string;
  readonly hostKind: "desktop" | "web" | "remote-workspace";
  readonly platform: string;
  readonly architecture: string;
  readonly workspaceCount: number;
  readonly trusted: boolean;
  readonly languageIdConfigured: boolean;
  readonly serverPathSource: string | undefined;
  readonly serverExecutable: string | undefined;
  readonly serverState: SessionState;
  readonly serverIdentity: string | undefined;
  readonly encoding: string | undefined;
  readonly capabilities: readonly string[];
  readonly trace: string;
  readonly lastFailure: SessionFailure | undefined;
  readonly resourceLimits: readonly string[];
  readonly warnings: readonly string[];
}

export interface ReportOptions {
  readonly homeDirectory?: string;
  readonly preview?: boolean;
}

export function redactHome(value: string, homeDirectory: string): string {
  if (!homeDirectory) {
    return value;
  }
  if (value === homeDirectory) {
    return "~";
  }
  const prefix = homeDirectory.endsWith("/") ? homeDirectory : `${homeDirectory}/`;
  if (value.startsWith(prefix)) {
    return `~/${value.slice(prefix.length)}`;
  }
  return value;
}

export function sanitizeLine(value: string, homeDirectory: string): string {
  return redactHome(value, homeDirectory)
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatHealthReport(snapshot: HealthSnapshot, options: ReportOptions = {}): string {
  const home = options.homeDirectory ?? "";
  const lines: string[] = [];
  lines.push("# Elisa Language Support Health");
  lines.push("");
  lines.push(`- Extension: ${snapshot.extensionVersion} (${snapshot.buildIdentifier})`);
  lines.push(`- Editor host: ${snapshot.hostKind}`);
  lines.push(`- Platform: ${snapshot.platform}/${snapshot.architecture}`);
  lines.push(`- Workspace folders: ${snapshot.workspaceCount}`);
  lines.push(`- Workspace trusted: ${snapshot.trusted ? "yes" : "no"}`);
  lines.push(`- Language registration active: ${snapshot.languageIdConfigured ? "yes" : "no"}`);
  lines.push(`- Server path source: ${snapshot.serverPathSource ?? "not resolved"}`);
  lines.push(
    `- Server executable: ${snapshot.serverExecutable ? sanitizeLine(snapshot.serverExecutable, home) : "not resolved"}`,
  );
  lines.push(`- Server lifecycle state: ${snapshot.serverState}`);
  lines.push(`- Server identity: ${snapshot.serverIdentity ?? "not reported"}`);
  lines.push(`- Negotiated encoding: ${snapshot.encoding ?? "not negotiated"}`);
  lines.push(
    `- Advertised capabilities: ${snapshot.capabilities.length > 0 ? snapshot.capabilities.join(", ") : "none reported"}`,
  );
  lines.push(
    `- Resource limits: ${snapshot.resourceLimits.length > 0 ? snapshot.resourceLimits.join(", ") : "defaults"}`,
  );
  lines.push(`- Protocol tracing: ${snapshot.trace}`);
  if (snapshot.lastFailure) {
    const failure = snapshot.lastFailure;
    lines.push(
      `- Last failure: ${failure.kind} (${sanitizeLine(failure.message, home)}${failure.detail ? `: ${sanitizeLine(failure.detail, home)}` : ""})`,
    );
  } else {
    lines.push("- Last failure: none");
  }
  if (snapshot.warnings.length > 0) {
    for (const warning of snapshot.warnings) {
      lines.push(`- Warning: ${sanitizeLine(warning, home)}`);
    }
  }
  if (options.preview) {
    lines.push("");
    lines.push("This preview omits source text, environment dumps, tokens, and private URLs.");
    lines.push("Review before sharing; nothing is uploaded automatically.");
  }
  return lines.join("\n");
}

export function capabilitySummary(capabilities: readonly string[]): string {
  if (capabilities.length === 0) {
    return "No capabilities reported yet";
  }
  return capabilities.join(", ");
}
