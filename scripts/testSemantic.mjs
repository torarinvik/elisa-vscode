import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  "test/semantic-golden.test.mjs",
  "test/semantic-token-manifest.test.mjs",
];

console.log(
  "Running server-backed semantic checks; the sibling LSP binary and schema must match current sources.",
);
const result = spawnSync(process.execPath, ["--test", ...files], {
  cwd: root,
  env: { ...process.env, ELISA_REQUIRE_FRESH_LSP: "1" },
  stdio: "inherit",
});

if (result.error) {
  console.error(`could not start Node test runner: ${result.error.message}`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
