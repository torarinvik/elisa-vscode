import { execFileSync, spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const watch = process.argv.includes("--watch");

function buildIdentifier() {
  const version = require(resolve(root, "package.json")).version;
  let revision = "unknown";
  try {
    revision = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  } catch {
    revision = "unknown";
  }
  let dirty = "";
  try {
    if (
      execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim()
        .length > 0
    ) {
      dirty = ".dirty";
    }
  } catch {
    dirty = "";
  }
  return `${version}+${revision}${dirty}`;
}

function typecheckOnce() {
  const tsc = require.resolve("typescript/bin/tsc");
  const result = spawnSync(process.execPath, [tsc, "-p", "."], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function startWatch() {
  const tsc = require.resolve("typescript/bin/tsc");
  const tscWatch = spawn(
    process.execPath,
    [tsc, "--watch", "--preserveWatchOutput", "-p", "."],
    { cwd: root, stdio: "inherit" },
  );
  const esbuild = await import("esbuild");
  const context = await esbuild.context(await buildOptions(esbuild));
  await context.watch();
  const shutdown = async () => {
    tscWatch.kill("SIGINT");
    await context.dispose();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function buildOptions(esbuild) {
  const identifier = buildIdentifier();
  return {
    entryPoints: [resolve(root, "out", "extension.js")],
    bundle: true,
    platform: "node",
    target: "node18",
    external: ["vscode"],
    outfile: resolve(root, "dist", "extension.js"),
    allowOverwrite: true,
    sourcemap: "external",
    logLevel: "info",
    define: {
      "process.env.ELISA_VSCODE_BUILD_ID": JSON.stringify(identifier),
    },
  };
}

if (watch) {
  typecheckOnce();
  await startWatch();
} else {
  rmSync(resolve(root, "dist"), { recursive: true, force: true });
  typecheckOnce();
  const esbuild = await import("esbuild");
  await esbuild.build(await buildOptions(esbuild));
}
