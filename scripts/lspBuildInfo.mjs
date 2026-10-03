import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { extname, relative, resolve, sep } from "node:path";

const lspInputExtensions = new Set([".elisa", ".elisai", ".c", ".h"]);
const compilerInputExtensions = new Set([".elisa", ".elisai"]);
const buildPipelineFiles = [
  "build.sh",
  "project.json",
  "scripts/build_hashes.py",
  "scripts/generate_diagnostic_codes.py",
];

function compareCodePoints(left, right) {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0));
  const rightPoints = Array.from(right, (character) => character.codePointAt(0));
  const commonLength = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < commonLength; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) {
      return leftPoints[index] - rightPoints[index];
    }
  }
  return leftPoints.length - rightPoints.length;
}

function compareRelativePaths(left, right) {
  const leftParts = left.split("/");
  const rightParts = right.split("/");
  const commonLength = Math.min(leftParts.length, rightParts.length);
  for (let index = 0; index < commonLength; index += 1) {
    const order = compareCodePoints(leftParts[index], rightParts[index]);
    if (order !== 0) {
      return order;
    }
  }
  return leftParts.length - rightParts.length;
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest();
}

export function sha256File(path) {
  return sha256Bytes(readFileSync(path)).toString("hex");
}

export function buildPipelineSha256(lspRoot) {
  const digest = createHash("sha256");
  digest.update("elisa-lsp-build-pipeline-v1\0");
  for (const relativePath of buildPipelineFiles) {
    const relativeBytes = Buffer.from(relativePath, "utf8");
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(relativeBytes.length));
    digest.update(length);
    digest.update(relativeBytes);
    digest.update(sha256Bytes(readFileSync(resolve(lspRoot, relativePath))));
  }
  return digest.digest("hex");
}

function sourceTreeSha256(root, extensions) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else if (
        extensions.has(extname(entry.name)) &&
        (entry.isFile() || (entry.isSymbolicLink() && statSync(path).isFile()))
      ) {
        files.push(path);
      }
    }
  };
  visit(root);
  files.sort((left, right) =>
    compareRelativePaths(relative(root, left), relative(root, right)),
  );

  const digest = createHash("sha256");
  for (const path of files) {
    const relativePath = relative(root, path).split(sep).join("/");
    const relativeBytes = Buffer.from(relativePath, "utf8");
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(relativeBytes.length));
    digest.update(length);
    digest.update(relativeBytes);
    digest.update(sha256Bytes(readFileSync(path)));
  }
  return digest.digest("hex");
}

export function lspInputsSha256(lspRoot) {
  const sourceHash = sourceTreeSha256(
    resolve(lspRoot, "src"),
    lspInputExtensions,
  );
  const projectHash = sha256File(resolve(lspRoot, "project.json"));
  return createHash("sha256").update(sourceHash + projectHash).digest("hex");
}

export function compilerSourcesSha256(compilerRoot) {
  const sourceHash = sourceTreeSha256(
    resolve(compilerRoot, "src"),
    compilerInputExtensions,
  );
  const standardLibraryHash = sourceTreeSha256(
    resolve(compilerRoot, "elisacore_std"),
    compilerInputExtensions,
  );
  return createHash("sha256")
    .update("compiler-src\0")
    .update(Buffer.from(sourceHash, "hex"))
    .update("compiler-elisacore_std\0")
    .update(Buffer.from(standardLibraryHash, "hex"))
    .digest("hex");
}

export function inspectLspBuild(lspRoot) {
  const serverBinary = resolve(lspRoot, "build", "elisa-lsp");
  const manifestPath = resolve(lspRoot, "build", "manifest.json");
  if (!existsSync(serverBinary)) {
    return { available: false, reason: "build/elisa-lsp is missing" };
  }
  if (!existsSync(manifestPath)) {
    return { available: false, reason: "build/manifest.json is missing" };
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return { available: false, reason: "build/manifest.json is invalid" };
  }

  const binarySha256 = sha256File(serverBinary);
  const reasons = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return {
      available: true,
      current: false,
      reason: "build manifest has an invalid shape",
      binarySha256,
      manifest,
    };
  }
  if (manifest.schema_version !== 3) {
    reasons.push("build manifest schema is unsupported; rebuild Elisa-LSP");
  }
  if (manifest.artifact_sha256 !== binarySha256) {
    reasons.push("server binary does not match build/manifest.json");
  }

  let currentLspInputsSha256;
  try {
    currentLspInputsSha256 = lspInputsSha256(lspRoot);
  } catch {
    reasons.push("current LSP sources or project.json could not be fingerprinted");
  }
  if (
    currentLspInputsSha256 &&
    manifest.lsp_inputs_sha256 !== currentLspInputsSha256
  ) {
    reasons.push("LSP sources/project.json differ from the built snapshot");
  }

  let currentBuildPipelineSha256;
  try {
    currentBuildPipelineSha256 = buildPipelineSha256(lspRoot);
  } catch {
    reasons.push("current LSP build-pipeline inputs could not be fingerprinted");
  }
  if (
    currentBuildPipelineSha256 &&
    manifest.build_pipeline_sha256 !== currentBuildPipelineSha256
  ) {
    reasons.push("LSP build-pipeline inputs differ from the built snapshot");
  }

  const compilerRoot = resolve(lspRoot, "..", "Elisa-compiler");
  let currentCompilerSourcesSha256;
  try {
    currentCompilerSourcesSha256 = compilerSourcesSha256(compilerRoot);
  } catch {
    reasons.push("current Elisa-compiler sources could not be fingerprinted");
  }
  if (
    currentCompilerSourcesSha256 &&
    manifest.compiler_sources_sha256 !== currentCompilerSourcesSha256
  ) {
    reasons.push("Elisa-compiler sources differ from the built snapshot");
  }

  return {
    available: true,
    current: reasons.length === 0,
    reason: reasons.length === 0 ? undefined : reasons.join("; "),
    binarySha256,
    manifest,
    currentLspInputsSha256,
    currentBuildPipelineSha256,
    currentCompilerSourcesSha256,
  };
}
