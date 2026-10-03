function unavailable(reason, profile) {
  return {
    available: false,
    reason,
    ...(typeof profile === "string" ? { profile } : {}),
  };
}

export function serverBuildBenchmarkGate(build) {
  if (!build?.available) {
    return unavailable(build?.reason ?? "language-server build is unavailable");
  }
  if (!build.current) {
    return unavailable(
      `refusing to benchmark a stale server build: ${build.reason ?? "source fingerprints differ"}; rebuild the sibling server first`,
      build.manifest?.profile,
    );
  }
  if (build.manifest?.profile !== "release") {
    return unavailable(
      `refusing to include server timings from profile ${String(build.manifest?.profile ?? "unknown")}; build the sibling server with --release`,
      build.manifest?.profile,
    );
  }
  if (
    typeof build.binarySha256 !== "string" ||
    build.manifest?.artifact_sha256 !== build.binarySha256 ||
    typeof build.manifest?.lsp_inputs_sha256 !== "string" ||
    build.manifest.lsp_inputs_sha256 !== build.currentLspInputsSha256 ||
    typeof build.manifest?.compiler_sources_sha256 !== "string" ||
    build.manifest.compiler_sources_sha256 !== build.currentCompilerSourcesSha256
  ) {
    return unavailable("refusing to benchmark incomplete or inconsistent build provenance", build.manifest?.profile);
  }
  return { available: true };
}

export function assertBuildSnapshotUnchanged(before, after) {
  const beforeGate = serverBuildBenchmarkGate(before);
  if (!beforeGate.available) {
    throw new Error(`benchmark started without an eligible release snapshot: ${beforeGate.reason}`);
  }
  const afterGate = serverBuildBenchmarkGate(after);
  if (!afterGate.available) {
    throw new Error(`server build became ineligible during benchmark: ${afterGate.reason}`);
  }

  const comparableFields = [
    ["binary", before.binarySha256, after.binarySha256],
    ["LSP source snapshot", before.manifest.lsp_inputs_sha256, after.manifest.lsp_inputs_sha256],
    ["compiler source snapshot", before.manifest.compiler_sources_sha256, after.manifest.compiler_sources_sha256],
    ["build profile", before.manifest.profile, after.manifest.profile],
  ];
  for (const [label, initial, final] of comparableFields) {
    if (initial !== final) {
      throw new Error(`server ${label} changed during benchmark; discard the measurements and retry`);
    }
  }
}
