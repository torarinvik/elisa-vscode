export interface LegendComparison {
  readonly missingFromServer: readonly string[];
  readonly unexpectedFromServer: readonly string[];
  readonly duplicateInClient: readonly string[];
  readonly duplicateFromServer: readonly string[];
  readonly orderChanged: boolean;
}

export type LegendInspection =
  | { readonly kind: "absent" }
  | {
      readonly kind: "valid";
      readonly values: readonly string[];
      readonly modifiers?: readonly string[];
    }
  | { readonly kind: "invalid"; readonly detail: string };

type StringListInspection =
  | { readonly kind: "valid"; readonly values: readonly string[] }
  | { readonly kind: "invalid"; readonly detail: string };

// Keep initialization-time compatibility work bounded even for an untrusted or
// accidentally malformed language server.
const maxSemanticLegendEntries = 256;
const maxSemanticLegendEntryLength = 128;
const maxSemanticLegendTotalLength = 16_384;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function inspectStringValues(value: unknown, label: string): StringListInspection {
  if (!Array.isArray(value)) {
    return { kind: "invalid", detail: `${label} must be an array` };
  }
  if (value.length > maxSemanticLegendEntries) {
    return {
      kind: "invalid",
      detail: `${label} exceeds the ${maxSemanticLegendEntries}-entry limit`,
    };
  }
  const values: string[] = [];
  let totalLength = 0;
  for (let index = 0; index < value.length; index += 1) {
    const entry: unknown = value[index];
    if (typeof entry !== "string" || entry.length === 0) {
      return {
        kind: "invalid",
        detail: `${label} entry ${index} must be a non-empty string`,
      };
    }
    if (entry.length > maxSemanticLegendEntryLength) {
      return {
        kind: "invalid",
        detail: `${label} entry ${index} exceeds the ${maxSemanticLegendEntryLength}-character limit`,
      };
    }
    totalLength += entry.length;
    if (totalLength > maxSemanticLegendTotalLength) {
      return {
        kind: "invalid",
        detail: `${label} exceeds the ${maxSemanticLegendTotalLength}-character total limit`,
      };
    }
    values.push(entry);
  }
  return { kind: "valid", values };
}

export function inspectDeclaredLegend(packageJson: unknown): LegendInspection {
  const contributes = record(record(packageJson)?.contributes);
  const types = contributes?.semanticTokenTypes;
  if (!Array.isArray(types)) {
    return { kind: "invalid", detail: "client semanticTokenTypes must be an array" };
  }
  if (types.length > maxSemanticLegendEntries) {
    return {
      kind: "invalid",
      detail: `client semanticTokenTypes exceeds the ${maxSemanticLegendEntries}-entry limit`,
    };
  }
  const ids: unknown[] = [];
  for (let index = 0; index < types.length; index += 1) {
    const id = record(types[index])?.id;
    if (typeof id !== "string" || id.length === 0) {
      return {
        kind: "invalid",
        detail: `client semanticTokenTypes entry ${index} must have a non-empty string id`,
      };
    }
    ids.push(id);
  }
  return inspectStringValues(ids, "client semanticTokenTypes");
}

export function inspectServerLegend(initializeResult: unknown): LegendInspection {
  const capabilities = record(record(initializeResult)?.capabilities);
  const provider = capabilities?.semanticTokensProvider;
  if (provider === undefined || provider === null || provider === false) {
    return { kind: "absent" };
  }
  const legend = record(record(provider)?.legend);
  if (!legend) {
    return {
      kind: "invalid",
      detail: "server semanticTokensProvider must include a legend object",
    };
  }
  const tokenTypes = inspectStringValues(legend.tokenTypes, "server semantic tokenTypes");
  if (tokenTypes.kind === "invalid") {
    return tokenTypes;
  }
  const tokenModifiers = inspectStringValues(
    legend.tokenModifiers,
    "server semantic tokenModifiers",
  );
  if (tokenModifiers.kind === "invalid") {
    return tokenModifiers;
  }
  const duplicateModifiers = duplicates(tokenModifiers.values);
  if (duplicateModifiers.length > 0) {
    return {
      kind: "invalid",
      detail: `server semantic tokenModifiers repeats ${duplicateModifiers.join(", ")}`,
    };
  }
  return {
    kind: "valid",
    values: tokenTypes.values,
    modifiers: tokenModifiers.values,
  };
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      repeated.add(value);
    } else {
      seen.add(value);
    }
  }
  return [...repeated];
}

export function compareLegends(
  declared: readonly string[],
  server: readonly string[] | undefined,
): LegendComparison | undefined {
  if (!server) {
    return undefined;
  }
  const declaredSet = new Set(declared);
  const normalizeLegacyId = (name: string): string => {
    if (declaredSet.has(name)) {
      return name;
    }
    const migrated = name.startsWith("elisa.") ? name.replaceAll(".", "-") : name;
    return declaredSet.has(migrated) ? migrated : name;
  };
  const normalizedServer = server.map(normalizeLegacyId);
  const normalizedServerSet = new Set(normalizedServer);
  const missingFromServer = declared.filter((name) => !normalizedServerSet.has(name));
  const unexpectedFromServer = server.filter(
    (name, index) => !declaredSet.has(normalizedServer[index]),
  );
  const duplicateInClient = duplicates(declared);
  const duplicateFromServer = duplicates(normalizedServer);
  const orderChanged =
    missingFromServer.length === 0 &&
    unexpectedFromServer.length === 0 &&
    duplicateInClient.length === 0 &&
    duplicateFromServer.length === 0 &&
    normalizedServer.length === declared.length &&
    declared.some((name, index) => normalizedServer[index] !== name);
  if (
    missingFromServer.length === 0 &&
    unexpectedFromServer.length === 0 &&
    duplicateInClient.length === 0 &&
    duplicateFromServer.length === 0 &&
    !orderChanged
  ) {
    return undefined;
  }
  return {
    missingFromServer,
    unexpectedFromServer,
    duplicateInClient,
    duplicateFromServer,
    orderChanged,
  };
}

export function semanticLegendCompatibilityIssue(
  packageJson: unknown,
  initializeResult: unknown,
): string | undefined {
  const declared = inspectDeclaredLegend(packageJson);
  const server = inspectServerLegend(initializeResult);
  const comparison =
    declared.kind === "valid" && server.kind === "valid"
      ? compareLegends(declared.values, server.values)
      : undefined;
  const problems = [
    declared.kind === "invalid"
      ? `client semantic token contribution is malformed: ${declared.detail}`
      : undefined,
    server.kind === "invalid"
      ? `server semantic token legend is malformed: ${server.detail}`
      : undefined,
    comparison ? describeLegendComparison(comparison) : undefined,
  ].filter((problem): problem is string => problem !== undefined);
  return problems.length > 0 ? problems.join("; ") : undefined;
}

export function describeLegendComparison(comparison: LegendComparison): string {
  const details: string[] = [];
  if (comparison.missingFromServer.length > 0) {
    details.push(`server is missing ${comparison.missingFromServer.join(", ")}`);
  }
  if (comparison.unexpectedFromServer.length > 0) {
    details.push(`server added ${comparison.unexpectedFromServer.join(", ")}`);
  }
  if (comparison.duplicateInClient.length > 0) {
    details.push(`client contribution repeats ${comparison.duplicateInClient.join(", ")}`);
  }
  if (comparison.duplicateFromServer.length > 0) {
    details.push(`server legend repeats ${comparison.duplicateFromServer.join(", ")}`);
  }
  if (comparison.orderChanged) {
    details.push("legend order differs");
  }
  return details.join("; ");
}
