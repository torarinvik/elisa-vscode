export interface InspectedSettingValue {
  readonly defaultValue?: unknown;
  readonly globalValue?: unknown;
  readonly workspaceValue?: unknown;
  readonly workspaceFolderValue?: unknown;
}

export interface SettingSelection {
  readonly value: unknown;
  readonly workspaceOverrideIgnored: boolean;
}

/** Prevent an untrusted repository from controlling execution-sensitive settings. */
export function selectTrustedSettingValue(
  effectiveValue: unknown,
  inspected: InspectedSettingValue | undefined,
  trusted: boolean,
): SettingSelection {
  if (trusted) {
    return { value: effectiveValue, workspaceOverrideIgnored: false };
  }

  const workspaceOverrideIgnored =
    inspected?.workspaceValue !== undefined || inspected?.workspaceFolderValue !== undefined;
  const value = inspected?.globalValue !== undefined
    ? inspected.globalValue
    : inspected?.defaultValue;

  return { value, workspaceOverrideIgnored };
}
