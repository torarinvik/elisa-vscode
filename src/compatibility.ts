export interface LegendComparison {
  readonly missingFromServer: readonly string[];
  readonly unexpectedFromServer: readonly string[];
  readonly orderChanged: boolean;
}

export function compareLegends(
  declared: readonly string[],
  server: readonly string[] | undefined,
): LegendComparison | undefined {
  if (!server || server.length === 0) {
    return undefined;
  }
  const declaredSet = new Set(declared);
  const serverSet = new Set(server);
  const missingFromServer = declared.filter((name) => !serverSet.has(name));
  const unexpectedFromServer = server.filter((name) => !declaredSet.has(name));
  const orderChanged =
    missingFromServer.length === 0 &&
    unexpectedFromServer.length === 0 &&
    declared.some((name, index) => server[index] !== name);
  if (missingFromServer.length === 0 && unexpectedFromServer.length === 0 && !orderChanged) {
    return undefined;
  }
  return { missingFromServer, unexpectedFromServer, orderChanged };
}

export function describeLegendComparison(comparison: LegendComparison): string {
  const details: string[] = [];
  if (comparison.missingFromServer.length > 0) {
    details.push(`server is missing ${comparison.missingFromServer.join(", ")}`);
  }
  if (comparison.unexpectedFromServer.length > 0) {
    details.push(`server added ${comparison.unexpectedFromServer.join(", ")}`);
  }
  if (comparison.orderChanged) {
    details.push("legend order differs");
  }
  return details.join("; ");
}
