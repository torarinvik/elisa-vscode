import * as path from "node:path";

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
  const rendered = distinct.map((value) => (value.length > 0 ? value : "<empty>")).join(", ");
  return `${settingName} differs across workspace folders (${rendered}); one shared server session uses the first folder's value`;
}
