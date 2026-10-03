import * as fs from "node:fs/promises";
import * as path from "node:path";

export type DiscoverySource = "setting" | "environment" | "nearby" | "path";

export type PlatformSupport = "supported" | "experimental" | "unsupported";

export interface DiscoveryCandidate {
  readonly path: string;
  readonly source: DiscoverySource;
  readonly origin: string;
}

export interface DiscoveryOptions {
  readonly configuredPath: string;
  readonly environmentPath: string;
  readonly workspaceRoots: readonly string[];
  readonly extensionPath: string;
  readonly homeDirectory: string;
  readonly platform: NodeJS.Platform;
  readonly environmentPathValue: string;
  readonly pathDelimiter: string;
  readonly trusted: boolean;
  readonly maxAncestorDepth?: number;
}

export type CandidateStatus =
  | "ok"
  | "missing"
  | "not-a-file"
  | "not-executable"
  | "inaccessible"
  | "unsupported-host";

export interface CandidateProbe {
  readonly candidate: DiscoveryCandidate;
  readonly status: CandidateStatus;
  readonly detail?: string;
}

export interface ServerResolution {
  readonly executable: string;
  readonly source: DiscoverySource;
  readonly origin: string;
}

export type DiscoveryOutcome =
  | { readonly kind: "resolved"; readonly server: ServerResolution }
  | { readonly kind: "missing"; readonly probes: readonly CandidateProbe[] }
  | { readonly kind: "configuration-conflict"; readonly detail: string }
  | { readonly kind: "workspace-limit"; readonly detail: string }
  | { readonly kind: "invalid-setting"; readonly setting: string; readonly detail: string }
  | {
      readonly kind: "invalid-explicit";
      readonly setting: string;
      readonly candidate: DiscoveryCandidate;
      readonly status: CandidateStatus;
      readonly detail?: string;
    };

export interface FileSystemProbe {
  probeFile(candidate: DiscoveryCandidate, platform: NodeJS.Platform): Promise<CandidateProbe>;
}

export interface ResolveDependencies {
  readonly probe: FileSystemProbe;
  readonly concurrency?: number;
}

const supportedPlatforms: readonly NodeJS.Platform[] = ["darwin", "linux"];
export const MAX_WORKSPACE_ROOTS = 32;
const MAX_DISCOVERY_CONCURRENCY = 4;

export function executableName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "elisa-lsp.exe" : "elisa-lsp";
}

export function classifyPlatform(platform: NodeJS.Platform): PlatformSupport {
  if (supportedPlatforms.includes(platform)) {
    return "supported";
  }
  if (platform === "win32") {
    return "experimental";
  }
  return "unsupported";
}

export function expandHome(value: string, homeDirectory: string): string {
  if (value === "~") {
    return homeDirectory;
  }
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(homeDirectory, value.slice(2));
  }
  return value;
}

export function resolveConfiguredPath(
  value: string,
  baseDirectory: string,
  homeDirectory: string,
): string {
  const expanded = expandHome(value.trim(), homeDirectory);
  if (!expanded) {
    return "";
  }
  return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(baseDirectory, expanded);
}

function baseDirectory(options: DiscoveryOptions): string {
  return options.workspaceRoots[0] ?? options.extensionPath;
}

export function nearbyCandidates(options: DiscoveryOptions): DiscoveryCandidate[] {
  const roots = [...options.workspaceRoots, options.extensionPath];
  const candidates: DiscoveryCandidate[] = [];
  const seen = new Set<string>();
  const depthLimit = options.maxAncestorDepth ?? 5;
  const name = executableName(options.platform);

  for (const root of roots) {
    let current = path.resolve(root);
    for (let depth = 0; depth <= depthLimit; depth += 1) {
      const shapes = [
        path.join(current, "build", name),
        path.join(current, "Elisa-LSP", "build", name),
      ];
      for (const shape of shapes) {
        const candidate = path.normalize(shape);
        if (!seen.has(candidate)) {
          seen.add(candidate);
          candidates.push({ path: candidate, source: "nearby", origin: current });
        }
      }
      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  }
  return candidates;
}

export function buildCandidates(options: DiscoveryOptions): DiscoveryCandidate[] {
  const candidates: DiscoveryCandidate[] = [];
  const seen = new Set<string>();
  const push = (candidate: DiscoveryCandidate): void => {
    const normalized = path.normalize(candidate.path);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    candidates.push({ ...candidate, path: normalized });
  };

  const base = baseDirectory(options);
  const configured = options.configuredPath.trim();
  if (configured) {
    push({
      path: resolveConfiguredPath(configured, base, options.homeDirectory),
      source: "setting",
      origin: "elisa.languageServer.path",
    });
  }
  const environment = options.environmentPath.trim();
  if (environment) {
    push({
      path: resolveConfiguredPath(environment, base, options.homeDirectory),
      source: "environment",
      origin: "ELISA_LSP",
    });
  }

  if (classifyPlatform(options.platform) !== "supported") {
    return candidates;
  }

  if (options.trusted) {
    for (const candidate of nearbyCandidates(options)) {
      push(candidate);
    }
  }

  for (const entry of options.environmentPathValue.split(options.pathDelimiter)) {
    if (!entry) {
      continue;
    }
    push({
      path: path.join(entry, executableName(options.platform)),
      source: "path",
      origin: entry,
    });
  }
  return candidates;
}

export function explicitCandidates(candidates: readonly DiscoveryCandidate[]): DiscoveryCandidate[] {
  return candidates.filter(
    (candidate) => candidate.source === "setting" || candidate.source === "environment",
  );
}

export function automaticCandidates(
  candidates: readonly DiscoveryCandidate[],
): DiscoveryCandidate[] {
  return candidates.filter(
    (candidate) => candidate.source === "nearby" || candidate.source === "path",
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  const finiteValue = Number.isFinite(value) ? value : minimum;
  return Math.min(Math.max(finiteValue, minimum), maximum);
}

export async function probeInBatches(
  candidates: readonly DiscoveryCandidate[],
  probe: FileSystemProbe,
  platform: NodeJS.Platform,
  concurrency: number,
): Promise<CandidateProbe[]> {
  const results: CandidateProbe[] = [];
  const limit = clamp(concurrency, 1, Math.max(candidates.length, 1));
  for (let start = 0; start < candidates.length; start += limit) {
    const batch = candidates.slice(start, start + limit);
    const batchResults = await Promise.all(
      batch.map((candidate) => probe.probeFile(candidate, platform)),
    );
    results.push(...batchResults);
    if (batchResults.some((result) => result.status === "ok")) {
      break;
    }
  }
  return results;
}

export async function resolveServer(
  options: DiscoveryOptions,
  dependencies: ResolveDependencies,
): Promise<DiscoveryOutcome> {
  const candidates = buildCandidates(options);
  const explicit = explicitCandidates(candidates);
  for (const candidate of explicit) {
    const result = await dependencies.probe.probeFile(candidate, options.platform);
    if (result.status !== "ok") {
      return {
        kind: "invalid-explicit",
        setting: candidate.origin,
        candidate,
        status: result.status,
        detail: result.detail,
      };
    }
    return {
      kind: "resolved",
      server: { executable: candidate.path, source: candidate.source, origin: candidate.origin },
    };
  }

  const automatic = automaticCandidates(candidates);
  const probes = await probeInBatches(
    automatic,
    dependencies.probe,
    options.platform,
    dependencies.concurrency ?? 4,
  );
  const resolved = probes.find((result) => result.status === "ok");
  if (resolved) {
    return {
      kind: "resolved",
      server: {
        executable: resolved.candidate.path,
        source: resolved.candidate.source,
        origin: resolved.candidate.origin,
      },
    };
  }
  return { kind: "missing", probes };
}

interface ProbeResult {
  readonly status: CandidateStatus;
  readonly detail?: string;
}

/** Deduplicates identical path probes and enforces one global async-I/O limit. */
class BoundedCachingProbe implements FileSystemProbe {
  private active = 0;
  private readonly pending: Array<() => void> = [];
  private readonly cache = new Map<string, Promise<ProbeResult>>();

  constructor(
    private readonly delegate: FileSystemProbe,
    private readonly limit: number,
  ) {}

  probeFile(
    candidate: DiscoveryCandidate,
    platform: NodeJS.Platform,
  ): Promise<CandidateProbe> {
    const key = `${platform}\0${candidate.path}`;
    let result = this.cache.get(key);
    if (!result) {
      result = this.enqueue(candidate, platform);
      this.cache.set(key, result);
    }
    return result.then((probeResult) => ({ candidate, ...probeResult }));
  }

  private enqueue(
    candidate: DiscoveryCandidate,
    platform: NodeJS.Platform,
  ): Promise<ProbeResult> {
    return new Promise((resolveResult, rejectResult) => {
      const start = (): void => {
        this.active += 1;
        const release = (): void => {
          this.active -= 1;
          this.pending.shift()?.();
        };
        void Promise.resolve()
          .then(() => this.delegate.probeFile(candidate, platform))
          .then(
            ({ status, detail }) => {
              resolveResult({ status, detail });
              release();
            },
            (error: unknown) => {
              rejectResult(error);
              release();
            },
          );
      };
      if (this.active < this.limit) {
        start();
      } else {
        this.pending.push(start);
      }
    });
  }
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(values.length, concurrency) },
    async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= values.length) {
          return;
        }
        results[index] = await operation(values[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

/**
 * Resolve multi-root automatic discovery independently for each root. Sharing
 * one process is safe only when every root selects the same executable. An
 * explicit setting or ELISA_LSP is already a shared override, so it follows
 * the normal precedence path without per-root probing.
 */
export async function resolveServerForWorkspaceRoots(
  options: DiscoveryOptions,
  dependencies: ResolveDependencies,
): Promise<DiscoveryOutcome> {
  if (options.workspaceRoots.length > MAX_WORKSPACE_ROOTS) {
    return {
      kind: "workspace-limit",
      detail: `Elisa-LSP supports at most ${MAX_WORKSPACE_ROOTS} workspace folders in one session. Remove folders to continue.`,
    };
  }
  if (
    options.workspaceRoots.length <= 1 ||
    options.configuredPath.trim() !== "" ||
    options.environmentPath.trim() !== ""
  ) {
    return resolveServer(options, dependencies);
  }

  const concurrency = clamp(
    dependencies.concurrency ?? 4,
    1,
    MAX_DISCOVERY_CONCURRENCY,
  );
  const probe = new BoundedCachingProbe(dependencies.probe, concurrency);
  const outcomes = await mapConcurrent(
    options.workspaceRoots,
    concurrency,
    (root) =>
      resolveServer(
        { ...options, workspaceRoots: [root] },
        { probe, concurrency },
      ),
  );

  if (outcomes.every((outcome) => outcome.kind === "missing")) {
    // Preserve the regular aggregate probe report for setup/health diagnostics.
    return resolveServer(options, { probe, concurrency });
  }

  const first = outcomes[0];
  if (
    first?.kind === "resolved" &&
    outcomes.every(
      (outcome) =>
        outcome.kind === "resolved" &&
        outcome.server.executable === first.server.executable,
    )
  ) {
    return first;
  }

  return {
    kind: "configuration-conflict",
    detail:
      "Automatic discovery resolves different server contexts for these workspace folders. Set elisa.languageServer.path to the same executable for all folders, or remove differing nearby builds.",
  };
}

export function discoveryCacheKey(options: DiscoveryOptions): string {
  return JSON.stringify({
    configuredPath: options.configuredPath.trim(),
    environmentPath: options.environmentPath.trim(),
    workspaceRoots: options.workspaceRoots,
    extensionPath: options.extensionPath,
    platform: options.platform,
    trusted: options.trusted,
    environmentPathValue: options.environmentPathValue,
    maxAncestorDepth: options.maxAncestorDepth ?? 5,
  });
}

export class DiscoveryCache {
  private key: string | undefined;
  private outcome: DiscoveryOutcome | undefined;

  get(key: string): DiscoveryOutcome | undefined {
    return this.key === key ? this.outcome : undefined;
  }

  put(key: string, outcome: DiscoveryOutcome): void {
    this.key = key;
    this.outcome = outcome;
  }

  clear(): void {
    this.key = undefined;
    this.outcome = undefined;
  }
}

export function describeStatus(probe: CandidateProbe): string {
  switch (probe.status) {
    case "ok":
      return "usable";
    case "missing":
      return "missing";
    case "not-a-file":
      return "not a regular file";
    case "not-executable":
      return "not executable";
    case "inaccessible":
      return `inaccessible${probe.detail ? ` (${probe.detail})` : ""}`;
    case "unsupported-host":
      return "unsupported on this host";
  }
}

export class NodeFileProbe implements FileSystemProbe {
  async probeFile(
    candidate: DiscoveryCandidate,
    platform: NodeJS.Platform,
  ): Promise<CandidateProbe> {
    if (classifyPlatform(platform) === "unsupported") {
      return { candidate, status: "unsupported-host" };
    }
    try {
      const stat = await fs.stat(candidate.path);
      if (!stat.isFile()) {
        return { candidate, status: "not-a-file" };
      }
      if (platform !== "win32" && (stat.mode & 0o111) === 0) {
        return { candidate, status: "not-executable" };
      }
      return { candidate, status: "ok" };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EACCES" || code === "EPERM") {
        return { candidate, status: "inaccessible", detail: code };
      }
      if (code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP") {
        return { candidate, status: "missing", detail: code };
      }
      return { candidate, status: "missing", detail: code ?? String(error) };
    }
  }
}
