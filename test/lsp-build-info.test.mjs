import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildPipelineSha256,
  compilerSourcesSha256,
  inspectLspBuild,
  lspInputsSha256,
  sha256File,
} from "../scripts/lspBuildInfo.mjs";

test("LSP build inspection binds the binary to all source inputs", () => {
  const workspace = mkdtempSync(join(tmpdir(), "elisa-build-info-"));
  const lspRoot = join(workspace, "Elisa-LSP");
  const compilerRoot = join(workspace, "Elisa-compiler");
  const binaryPath = join(lspRoot, "build", "elisa-lsp");
  const manifestPath = join(lspRoot, "build", "manifest.json");
  mkdirSync(join(lspRoot, "src"), { recursive: true });
  mkdirSync(join(lspRoot, "build"), { recursive: true });
  mkdirSync(join(lspRoot, "scripts"), { recursive: true });
  mkdirSync(join(compilerRoot, "src"), { recursive: true });
  mkdirSync(join(compilerRoot, "elisacore_std"), { recursive: true });
  writeFileSync(join(lspRoot, "src", "main.elisa"), "def main(): pass\n");
  writeFileSync(join(lspRoot, "src", "transport.c"), "int transport;\n");
  writeFileSync(join(lspRoot, "src", "ignored.txt"), "not a build input\n");
  writeFileSync(join(lspRoot, "project.json"), "{}\n");
  writeFileSync(join(lspRoot, "build.sh"), "#!/bin/sh\n# build fixture\n");
  writeFileSync(
    join(lspRoot, "scripts", "build_hashes.py"),
    "# hash helper fixture\n",
  );
  writeFileSync(
    join(lspRoot, "scripts", "generate_diagnostic_codes.py"),
    "# generated-code helper fixture\n",
  );
  writeFileSync(join(compilerRoot, "src", "frontend.elisa"), "module Frontend\n");
  writeFileSync(
    join(compilerRoot, "elisacore_std", "prelude.elisa"),
    "module Prelude\n",
  );
  writeFileSync(binaryPath, "test binary\n");

  try {
    const manifest = {
      schema_version: 3,
      artifact_sha256: sha256File(binaryPath),
      build_pipeline_sha256: buildPipelineSha256(lspRoot),
      lsp_inputs_sha256: lspInputsSha256(lspRoot),
      compiler_sources_sha256: compilerSourcesSha256(compilerRoot),
    };
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const fresh = inspectLspBuild(lspRoot);
    assert.equal(fresh.available, true);
    assert.equal(fresh.current, true);
    assert.equal(fresh.reason, undefined);
    assert.equal(
      fresh.currentBuildPipelineSha256,
      manifest.build_pipeline_sha256,
    );

    writeFileSync(join(lspRoot, "src", "main.elisa"), "def main(): return 1\n");
    const staleLsp = inspectLspBuild(lspRoot);
    assert.equal(staleLsp.current, false);
    assert.match(staleLsp.reason, /LSP sources\/project\.json/);

    writeFileSync(join(lspRoot, "src", "main.elisa"), "def main(): pass\n");
    writeFileSync(join(compilerRoot, "src", "frontend.elisa"), "module Changed\n");
    const staleCompiler = inspectLspBuild(lspRoot);
    assert.equal(staleCompiler.current, false);
    assert.match(staleCompiler.reason, /Elisa-compiler sources/);

    writeFileSync(join(compilerRoot, "src", "frontend.elisa"), "module Frontend\n");
    writeFileSync(
      join(compilerRoot, "elisacore_std", "prelude.elisa"),
      "module ChangedPrelude\n",
    );
    const staleStandardLibrary = inspectLspBuild(lspRoot);
    assert.equal(staleStandardLibrary.current, false);
    assert.match(staleStandardLibrary.reason, /Elisa-compiler sources/);

    writeFileSync(
      join(compilerRoot, "elisacore_std", "prelude.elisa"),
      "module Prelude\n",
    );

    const buildScriptPath = join(lspRoot, "build.sh");
    const buildScriptBytes = readFileSync(buildScriptPath);
    writeFileSync(buildScriptPath, `${buildScriptBytes.toString()}# changed\n`);
    const staleBuildScript = inspectLspBuild(lspRoot);
    assert.equal(staleBuildScript.current, false);
    assert.match(staleBuildScript.reason, /build-pipeline inputs/);
    writeFileSync(buildScriptPath, buildScriptBytes);

    const hashHelperPath = join(lspRoot, "scripts", "build_hashes.py");
    const hashHelperBytes = readFileSync(hashHelperPath);
    writeFileSync(hashHelperPath, `${hashHelperBytes.toString()}# changed\n`);
    const staleHashHelper = inspectLspBuild(lspRoot);
    assert.equal(staleHashHelper.current, false);
    assert.match(staleHashHelper.reason, /build-pipeline inputs/);
    writeFileSync(hashHelperPath, hashHelperBytes);

    const diagnosticCodeGeneratorPath = join(
      lspRoot,
      "scripts",
      "generate_diagnostic_codes.py",
    );
    const diagnosticCodeGeneratorBytes = readFileSync(diagnosticCodeGeneratorPath);
    writeFileSync(
      diagnosticCodeGeneratorPath,
      `${diagnosticCodeGeneratorBytes.toString()}# changed\n`,
    );
    const staleDiagnosticCodeGenerator = inspectLspBuild(lspRoot);
    assert.equal(staleDiagnosticCodeGenerator.current, false);
    assert.match(staleDiagnosticCodeGenerator.reason, /build-pipeline inputs/);
    writeFileSync(diagnosticCodeGeneratorPath, diagnosticCodeGeneratorBytes);

    writeFileSync(binaryPath, "replaced binary\n");
    const replacedBinary = inspectLspBuild(lspRoot);
    assert.equal(replacedBinary.current, false);
    assert.match(replacedBinary.reason, /binary does not match/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
