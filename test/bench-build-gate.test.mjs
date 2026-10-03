import assert from "node:assert/strict";
import test from "node:test";
import {
  assertBuildSnapshotUnchanged,
  serverBuildBenchmarkGate,
} from "../scripts/benchBuildGate.mjs";

function build(overrides = {}) {
  const { manifest: manifestOverrides, ...buildOverrides } = overrides;
  const manifest = {
    profile: "release",
    artifact_sha256: "binary-a",
    lsp_inputs_sha256: "lsp-a",
    compiler_sources_sha256: "compiler-a",
    ...manifestOverrides,
  };
  return {
    available: true,
    current: true,
    binarySha256: "binary-a",
    currentLspInputsSha256: "lsp-a",
    currentCompilerSourcesSha256: "compiler-a",
    manifest,
    ...buildOverrides,
  };
}

test("server timing gate accepts only a complete current release snapshot", () => {
  assert.deepEqual(serverBuildBenchmarkGate(build()), { available: true });
  assert.match(
    serverBuildBenchmarkGate(build({ manifest: { profile: "debug" } })).reason,
    /profile debug.*--release/,
  );
  assert.match(
    serverBuildBenchmarkGate(build({ current: false, reason: "source changed" })).reason,
    /stale server build.*source changed/,
  );
  assert.match(
    serverBuildBenchmarkGate(build({ manifest: { artifact_sha256: "wrong" } })).reason,
    /incomplete or inconsistent build provenance/,
  );
  assert.match(
    serverBuildBenchmarkGate({ available: false, reason: "binary missing" }).reason,
    /binary missing/,
  );
});

test("server timing gate rejects a release whose recorded source hashes are stale", () => {
  assert.match(
    serverBuildBenchmarkGate(build({ currentCompilerSourcesSha256: "new-compiler" })).reason,
    /incomplete or inconsistent build provenance/,
  );
  assert.match(
    serverBuildBenchmarkGate(build({ currentLspInputsSha256: "new-lsp" })).reason,
    /incomplete or inconsistent build provenance/,
  );
});

test("benchmark snapshot check rejects changes during the measurement window", () => {
  const before = build();
  assert.doesNotThrow(() => assertBuildSnapshotUnchanged(before, build()));
  assert.throws(
    () => assertBuildSnapshotUnchanged(before, build({ binarySha256: "binary-b", manifest: { artifact_sha256: "binary-b" } })),
    /binary changed during benchmark/,
  );
  assert.throws(
    () => assertBuildSnapshotUnchanged(before, build({ manifest: { lsp_inputs_sha256: "lsp-b" }, currentLspInputsSha256: "lsp-b" })),
    /LSP source snapshot changed during benchmark/,
  );
  assert.throws(
    () => assertBuildSnapshotUnchanged(before, build({ manifest: { compiler_sources_sha256: "compiler-b" }, currentCompilerSourcesSha256: "compiler-b" })),
    /compiler source snapshot changed during benchmark/,
  );
  assert.throws(
    () => assertBuildSnapshotUnchanged(before, build({ manifest: { profile: "debug" } })),
    /became ineligible during benchmark.*profile debug/,
  );
});
