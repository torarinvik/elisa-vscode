import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";
import discovery from "../out/serverDiscovery.js";

const {
  DiscoveryCache,
  buildCandidates,
  classifyPlatform,
  describeStatus,
  discoveryCacheKey,
  executableName,
  expandHome,
  probeInBatches,
  resolveConfiguredPath,
  resolveServer,
} = discovery;

const homeDirectory = path.join(path.sep, "home", "elisa");
const extensionPath = path.join(path.sep, "ext", "elisa-vscode");
const workspaceRoot = path.join(path.sep, "work", "my project");

function options(overrides = {}) {
  return {
    configuredPath: "",
    environmentPath: "",
    workspaceRoots: [workspaceRoot],
    extensionPath,
    homeDirectory,
    platform: "darwin",
    environmentPathValue: "",
    pathDelimiter: ":",
    trusted: true,
    ...overrides,
  };
}

function fakeProbe(statuses) {
  const probed = [];
  return {
    probed,
    probeFile(candidate) {
      probed.push(candidate.path);
      const status = statuses.get(path.normalize(candidate.path)) ?? "missing";
      return Promise.resolve({ candidate, status });
    },
  };
}

test("executable names follow the platform convention", () => {
  assert.equal(executableName("win32"), "elisa-lsp.exe");
  assert.equal(executableName("darwin"), "elisa-lsp");
  assert.equal(executableName("linux"), "elisa-lsp");
});

test("platform support is explicit", () => {
  assert.equal(classifyPlatform("darwin"), "supported");
  assert.equal(classifyPlatform("linux"), "supported");
  assert.equal(classifyPlatform("win32"), "experimental");
  assert.equal(classifyPlatform("aix"), "unsupported");
});

test("tilde expansion only handles a leading tilde", () => {
  assert.equal(expandHome("~/server", homeDirectory), path.join(homeDirectory, "server"));
  assert.equal(expandHome("~", homeDirectory), homeDirectory);
  assert.equal(expandHome("~/nested/file", homeDirectory), path.join(homeDirectory, "nested/file"));
  assert.equal(expandHome("/absolute/~keep", homeDirectory), "/absolute/~keep");
  assert.equal(expandHome("relative/~keep", homeDirectory), "relative/~keep");
});

test("relative configured paths resolve against the first workspace root", () => {
  assert.equal(
    resolveConfiguredPath("build/elisa-lsp", workspaceRoot, homeDirectory),
    path.resolve(workspaceRoot, "build/elisa-lsp"),
  );
  assert.equal(
    resolveConfiguredPath("~/bin/elisa-lsp", workspaceRoot, homeDirectory),
    path.join(homeDirectory, "bin/elisa-lsp"),
  );
  assert.equal(
    resolveConfiguredPath("  /opt/elisa-lsp  ", workspaceRoot, homeDirectory),
    path.normalize("/opt/elisa-lsp"),
  );
});

test("candidate precedence is setting, environment, nearby, then PATH", () => {
  const candidates = buildCandidates(
    options({
      configuredPath: "/opt/custom/elisa-lsp",
      environmentPath: "/opt/env/elisa-lsp",
      environmentPathValue: "/usr/local/bin:/usr/bin",
    }),
  );
  const sources = candidates.map((candidate) => candidate.source);
  assert.deepEqual(sources.slice(0, 2), ["setting", "environment"]);
  assert.ok(sources.includes("nearby"));
  assert.ok(sources.includes("path"));
  assert.ok(
    sources.lastIndexOf("nearby") < sources.indexOf("path"),
    "nearby candidates precede PATH candidates",
  );
});

test("duplicate candidates are deduplicated before filesystem work", () => {
  const duplicate = path.join(workspaceRoot, "build", "elisa-lsp");
  const candidates = buildCandidates(
    options({
      configuredPath: duplicate,
      environmentPath: duplicate,
      environmentPathValue: `${workspaceRoot}/build:${workspaceRoot}/build`,
    }),
  );
  const paths = candidates.map((candidate) => candidate.path);
  assert.equal(new Set(paths).size, paths.length);
});

test("spaces and unicode remain ordinary path characters", () => {
  const configured = path.join(workspaceRoot, "bin dir", "élisa lsp");
  const candidates = buildCandidates(options({ configuredPath: configured }));
  assert.equal(candidates[0].path, path.normalize(configured));
});

test("empty PATH entries are ignored", () => {
  const candidates = buildCandidates(
    options({ environmentPathValue: ":/usr/bin::/opt/bin:" }),
  );
  const pathCandidates = candidates.filter((candidate) => candidate.source === "path");
  assert.equal(pathCandidates.length, 2);
  assert.deepEqual(
    pathCandidates.map((candidate) => candidate.path),
    ["/usr/bin/elisa-lsp", "/opt/bin/elisa-lsp"],
  );
});

test("untrusted workspaces do not receive nearby candidates", () => {
  const candidates = buildCandidates(
    options({ trusted: false, environmentPathValue: "/usr/bin" }),
  );
  assert.equal(candidates.some((candidate) => candidate.source === "nearby"), false);
  assert.equal(candidates.some((candidate) => candidate.source === "path"), true);
});

test("explicit candidates are honored even in untrusted workspaces", () => {
  const candidates = buildCandidates(
    options({ trusted: false, configuredPath: "/opt/elisa-lsp" }),
  );
  assert.equal(candidates[0].source, "setting");
});

test("unsupported platforms receive no automatic candidates", () => {
  const candidates = buildCandidates(
    options({ platform: "aix", environmentPathValue: "/usr/bin" }),
  );
  assert.equal(candidates.length, 0);
});

test("a bad explicit setting produces an actionable invalid-explicit outcome", async () => {
  const probe = fakeProbe(new Map());
  const outcome = await resolveServer(
    options({ configuredPath: "/missing/elisa-lsp", environmentPathValue: "/usr/bin" }),
    { probe },
  );
  assert.equal(outcome.kind, "invalid-explicit");
  assert.equal(outcome.setting, "elisa.languageServer.path");
  assert.equal(outcome.status, "missing");
  assert.equal(probe.probed.length, 1);
});

test("a bad ELISA_LSP value is not silently skipped", async () => {
  const probe = fakeProbe(new Map());
  const outcome = await resolveServer(
    options({ environmentPath: "/missing/elisa-lsp", environmentPathValue: "/usr/bin" }),
    { probe },
  );
  assert.equal(outcome.kind, "invalid-explicit");
  assert.equal(outcome.setting, "ELISA_LSP");
});

test("a valid setting wins without probing environment, nearby, or PATH", async () => {
  const configured = "/opt/custom/elisa-lsp";
  const probe = fakeProbe(new Map([[path.normalize(configured), "ok"]]));
  const outcome = await resolveServer(
    options({
      configuredPath: configured,
      environmentPath: "/opt/env/elisa-lsp",
      environmentPathValue: "/usr/bin",
    }),
    { probe },
  );
  assert.equal(outcome.kind, "resolved");
  assert.equal(outcome.server.source, "setting");
  assert.equal(probe.probed.length, 1);
});

test("nearby candidates resolve before PATH candidates", async () => {
  const nearby = path.normalize(
    buildCandidates(options()).find((candidate) => candidate.source === "nearby").path,
  );
  const probe = fakeProbe(
    new Map([
      [nearby, "ok"],
      ["/usr/bin/elisa-lsp", "ok"],
    ]),
  );
  const outcome = await resolveServer(
    options({ environmentPathValue: "/usr/bin" }),
    { probe },
  );
  assert.equal(outcome.kind, "resolved");
  assert.equal(outcome.server.source, "nearby");
});

test("the first usable PATH candidate wins in order", async () => {
  const probe = fakeProbe(
    new Map([
      ["/usr/bin/elisa-lsp", "not-executable"],
      ["/opt/bin/elisa-lsp", "ok"],
    ]),
  );
  const outcome = await resolveServer(
    options({ environmentPathValue: "/usr/bin:/opt/bin" }),
    { probe, concurrency: 2 },
  );
  assert.equal(outcome.kind, "resolved");
  assert.equal(outcome.server.executable, path.normalize("/opt/bin/elisa-lsp"));
});

test("missing everywhere yields a bounded probe report", async () => {
  const probe = fakeProbe(new Map());
  const outcome = await resolveServer(options(), { probe });
  assert.equal(outcome.kind, "missing");
  assert.ok(outcome.probes.length > 0);
  assert.equal(outcome.probes.every((result) => result.status === "missing"), true);
});

test("bounded concurrency probes at most the requested batch size", async () => {
  let inFlight = 0;
  let peak = 0;
  const candidates = Array.from({ length: 10 }, (_, index) => ({
    path: `/candidate/${index}`,
    source: "path",
    origin: "test",
  }));
  const probe = {
    async probeFile(candidate) {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return { candidate, status: "missing" };
    },
  };
  await probeInBatches(candidates, probe, "darwin", 3);
  assert.ok(peak <= 3, `peak concurrency was ${peak}`);
});

test("status descriptions are human readable", () => {
  const candidate = { path: "/x", source: "path", origin: "test" };
  assert.equal(describeStatus({ candidate, status: "not-executable" }), "not executable");
  assert.equal(describeStatus({ candidate, status: "not-a-file" }), "not a regular file");
  assert.equal(describeStatus({ candidate, status: "inaccessible", detail: "EACCES" }), "inaccessible (EACCES)");
});

test("the discovery cache only serves matching keys", () => {
  const cache = new DiscoveryCache();
  const key = discoveryCacheKey(options());
  assert.equal(cache.get(key), undefined);
  const outcome = { kind: "missing", probes: [] };
  cache.put(key, outcome);
  assert.equal(cache.get(key), outcome);
  assert.equal(cache.get(`${key}-different`), undefined);
  cache.clear();
  assert.equal(cache.get(key), undefined);
});
