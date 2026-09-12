import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const required = [
  "package.json",
  "package.nls.json",
  "dist/extension.js",
  "language-configuration.json",
  "syntaxes/elisa.tmLanguage.json",
  "README.md",
  "LICENSE",
];

const forbidden = [
  "src/",
  "test/",
  "scripts/",
  "node_modules/",
  "out/",
  "benchmarks/",
  "package-lock.json",
  "IMPLEMENTATION_PLAN.md",
  ".map",
];

function packagedEntries() {
  const output = execFileSync("npx", ["vsce", "ls"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.endsWith(".vsix"));
}

const entries = packagedEntries();
const missing = required.filter((entry) => !entries.includes(entry));
const leaked = forbidden.filter((entry) => entries.some((line) => line.includes(entry)));

if (missing.length > 0 || leaked.length > 0) {
  console.error("VSIX content audit failed");
  if (missing.length > 0) {
    console.error(`missing required entries: ${missing.join(", ")}`);
  }
  if (leaked.length > 0) {
    console.error(`forbidden entries present: ${leaked.join(", ")}`);
  }
  process.exit(1);
}

console.log(`VSIX content audit OK: ${entries.length} packaged entries, no leaked build inputs`);
