import * as path from "node:path";
import { resolveConfiguredPath } from "./serverDiscovery";

export type DocumentOwnership =
  | { readonly kind: "folder"; readonly folder: string }
  | { readonly kind: "outside-roots" }
  | { readonly kind: "untitled" };

export interface DocumentIdentity {
  readonly scheme: string;
  readonly fsPath: string;
}

export interface FolderSettingValue {
  readonly folder: string;
  readonly value: string;
  readonly valid?: boolean;
  /**
   * Base used when a relative setting belongs to this folder. Shared settings
   * omit this and resolve against the common workspace base instead.
   */
  readonly baseDirectory?: string;
}

export interface WorkspaceServerContext {
  readonly roots: string;
  readonly paths: string;
  readonly trusted: boolean;
}

export function workspaceServerContextChanged(
  previous: WorkspaceServerContext,
  next: WorkspaceServerContext,
): boolean {
  return (
    previous.roots !== next.roots ||
    previous.paths !== next.paths ||
    previous.trusted !== next.trusted
  );
}

function normalize(root: string): string {
  return path.normalize(path.resolve(root));
}

function contains(root: string, candidate: string): boolean {
  if (candidate === root) {
    return true;
  }
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return candidate.startsWith(prefix);
}

export function routeDocument(
  document: DocumentIdentity,
  roots: readonly string[],
): DocumentOwnership {
  if (document.scheme === "untitled") {
    return { kind: "untitled" };
  }
  if (document.scheme !== "file") {
    return { kind: "outside-roots" };
  }
  const candidate = path.normalize(document.fsPath);
  let owner: string | undefined;
  for (const root of roots) {
    const normalized = normalize(root);
    if (contains(normalized, candidate)) {
      if (!owner || normalized.length > owner.length) {
        owner = normalized;
      }
    }
  }
  return owner ? { kind: "folder", folder: owner } : { kind: "outside-roots" };
}

export function distinctSettingValues(values: readonly FolderSettingValue[]): string[] {
  const distinct = new Set<string>();
  for (const entry of values) {
    distinct.add(entry.value.trim());
  }
  return [...distinct];
}

export function settingValuesAreConsistent(values: readonly FolderSettingValue[]): boolean {
  return (
    values.every((entry) => entry.valid !== false) &&
    distinctSettingValues(values).length <= 1
  );
}

/**
 * Resolve each folder's effective server path before deciding whether one
 * shared server can honor all settings. Empty means automatic discovery.
 */
export function resolveServerPathValues(
  values: readonly FolderSettingValue[],
  sharedBaseDirectory: string,
  homeDirectory: string,
): FolderSettingValue[] {
  return values.map((entry) => {
    const configured = entry.value.trim();
    return {
      folder: entry.folder,
      ...(entry.valid === undefined ? {} : { valid: entry.valid }),
      value: configured
        ? resolveConfiguredPath(
            configured,
            entry.baseDirectory ?? sharedBaseDirectory,
            homeDirectory,
          )
        : "",
    };
  });
}

/** Stable in-memory comparison key; callers must not log this value. */
export function folderValuesSignature(values: readonly FolderSettingValue[]): string {
  return JSON.stringify(values.map(({ folder, value, valid }) => [folder, value, valid ?? true]));
}

export function describeSettingDivergence(
  settingName: string,
  values: readonly FolderSettingValue[],
): string | undefined {
  if (values.length <= 1) {
    return undefined;
  }
  const distinct = distinctSettingValues(values);
  if (distinct.length <= 1) {
    return undefined;
  }
  return `${settingName} differs across workspace folders; the shared language-server session cannot apply different values per folder`;
}
