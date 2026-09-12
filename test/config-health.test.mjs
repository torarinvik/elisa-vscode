import assert from "node:assert/strict";
import test from "node:test";
import config from "../out/config.js";
import health from "../out/health.js";

const { classifySettingsChange, parseSettings } = config;
const { formatHealthReport, redactHome, sanitizeLine } = health;

test("absent, null, and undefined settings fall back to the documented default", () => {
  assert.deepEqual(parseSettings({}), { languageServerPath: "", diagnostics: [] });
  assert.deepEqual(parseSettings({ languageServerPath: null }), {
    languageServerPath: "",
    diagnostics: [],
  });
  assert.deepEqual(parseSettings({ languageServerPath: undefined }), {
    languageServerPath: "",
    diagnostics: [],
  });
});

test("settings parsing trims strings and reports wrong types", () => {
  assert.deepEqual(parseSettings({ languageServerPath: "  /opt/elisa-lsp  " }), {
    languageServerPath: "/opt/elisa-lsp",
    diagnostics: [],
  });
  const wrongType = parseSettings({ languageServerPath: 7 });
  assert.equal(wrongType.languageServerPath, "");
  assert.equal(wrongType.diagnostics.length, 1);
  assert.match(wrongType.diagnostics[0].key, /elisa\.languageServer\.path/);
});

test("NUL characters are rejected instead of passed to process spawn", () => {
  const parsed = parseSettings({ languageServerPath: "/opt/\0elisa-lsp" });
  assert.equal(parsed.languageServerPath, "");
  assert.equal(parsed.diagnostics.length, 1);
});

test("settings changes are classified", () => {
  const before = parseSettings({ languageServerPath: "/opt/one" });
  const same = parseSettings({ languageServerPath: "/opt/one" });
  const changed = parseSettings({ languageServerPath: "/opt/two" });
  assert.equal(classifySettingsChange(before, same), "none");
  assert.equal(classifySettingsChange(before, changed), "session-restart");
});

test("home directories are redacted from reports", () => {
  assert.equal(redactHome("/Users/elisa/src", "/Users/elisa"), "~/src");
  assert.equal(redactHome("/Users/elisa", "/Users/elisa"), "~");
  assert.equal(redactHome("/opt/elisa", "/Users/elisa"), "/opt/elisa");
  assert.equal(sanitizeLine("line one\nline two", "/Users/elisa"), "line one line two");
});

test("health reports include state, provenance, and no source text", () => {
  const report = formatHealthReport(
    {
      extensionVersion: "0.1.0",
      buildIdentifier: "test-build",
      hostKind: "desktop",
      platform: "darwin",
      architecture: "arm64",
      workspaceCount: 1,
      trusted: true,
      languageIdConfigured: true,
      serverPathSource: "setting (elisa.languageServer.path)",
      serverExecutable: "/Users/elisa/bin/elisa-lsp",
      serverState: "ready",
      serverIdentity: "elisa-lsp 1.2.3",
      encoding: "utf-16",
      capabilities: ["hover", "semantic tokens"],
      lastFailure: undefined,
      resourceLimits: [],
    },
    { homeDirectory: "/Users/elisa" },
  );
  assert.match(report, /Server lifecycle state: ready/);
  assert.match(report, /setting \(elisa\.languageServer\.path\)/);
  assert.match(report, /~\/bin\/elisa-lsp/);
  assert.match(report, /semantic tokens/);
  assert.doesNotMatch(report, /\/Users\/elisa\/bin/);
});

test("failure details are single-lined and redacted", () => {
  const report = formatHealthReport(
    {
      extensionVersion: "0.1.0",
      buildIdentifier: "test-build",
      hostKind: "desktop",
      platform: "darwin",
      architecture: "arm64",
      workspaceCount: 0,
      trusted: false,
      languageIdConfigured: true,
      serverPathSource: undefined,
      serverExecutable: undefined,
      serverState: "failed",
      serverIdentity: undefined,
      encoding: undefined,
      capabilities: [],
      lastFailure: {
        kind: "missing-server",
        message: "No server\nfound",
        detail: "/Users/elisa/secret",
        time: 0,
      },
      resourceLimits: [],
    },
    { homeDirectory: "/Users/elisa" },
  );
  assert.match(report, /Last failure: missing-server \(No server found: ~\/secret\)/);
});
