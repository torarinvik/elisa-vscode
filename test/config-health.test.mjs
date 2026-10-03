import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import config from "../out/config.js";
import health from "../out/health.js";
import trust from "../out/trust.js";

const { classifySettingsChange, parseSettings } = config;
const { formatHealthReport, redactHome, sanitizeLine } = health;
const { selectTrustedSettingValue } = trust;
const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("Restricted Mode limits workspace-controlled executable and tracing settings", () => {
  const restricted = manifest.capabilities?.untrustedWorkspaces;
  assert.equal(restricted?.supported, "limited");
  assert.deepEqual(restricted?.restrictedConfigurations, [
    "elisa.languageServer.path",
    "elisa.trace.server",
  ]);
});

test("trusted workspaces use the effective language-server path", () => {
  assert.deepEqual(
    selectTrustedSettingValue(
      "/workspace/bin/elisa-lsp",
      {
        globalValue: "/user/bin/elisa-lsp",
        workspaceValue: "/workspace/bin/elisa-lsp",
      },
      true,
    ),
    { value: "/workspace/bin/elisa-lsp", workspaceOverrideIgnored: false },
  );
});

test("untrusted workspaces ignore workspace executable overrides", () => {
  assert.deepEqual(
    selectTrustedSettingValue(
      "/workspace/bin/elisa-lsp",
      {
        defaultValue: "",
        globalValue: "/user/bin/elisa-lsp",
        workspaceValue: "/workspace/bin/elisa-lsp",
      },
      false,
    ),
    { value: "/user/bin/elisa-lsp", workspaceOverrideIgnored: true },
  );
});

test("untrusted folder overrides are ignored while global/default values remain usable", () => {
  assert.deepEqual(
    selectTrustedSettingValue(
      "/folder/bin/elisa-lsp",
      { defaultValue: "", workspaceFolderValue: "/folder/bin/elisa-lsp" },
      false,
    ),
    { value: "", workspaceOverrideIgnored: true },
  );
  assert.deepEqual(
    selectTrustedSettingValue("", { defaultValue: "" }, false),
    { value: "", workspaceOverrideIgnored: false },
  );
});

test("untrusted tracing overrides are ignored just like executable overrides", () => {
  assert.deepEqual(
    selectTrustedSettingValue(
      "verbose",
      { defaultValue: "off", workspaceValue: "verbose" },
      false,
    ),
    { value: "off", workspaceOverrideIgnored: true },
  );
});

test("absent, null, and undefined settings fall back to the documented default", () => {
  assert.deepEqual(parseSettings({}), {
    languageServerPath: "",
    trace: "off",
    diagnostics: [],
  });
  assert.deepEqual(parseSettings({ languageServerPath: null }), {
    languageServerPath: "",
    trace: "off",
    diagnostics: [],
  });
  assert.deepEqual(parseSettings({ languageServerPath: undefined }), {
    languageServerPath: "",
    trace: "off",
    diagnostics: [],
  });
});

test("settings parsing trims strings and reports wrong types", () => {
  assert.deepEqual(parseSettings({ languageServerPath: "  /opt/elisa-lsp  " }), {
    languageServerPath: "/opt/elisa-lsp",
    trace: "off",
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
  const traced = parseSettings({ languageServerPath: "/opt/one", trace: "verbose" });
  assert.equal(classifySettingsChange(before, traced), "presentation");
});

test("trace levels are validated and normalized", () => {
  assert.equal(parseSettings({ trace: "VERBOSE" }).trace, "verbose");
  assert.equal(parseSettings({ trace: "messages" }).trace, "messages");
  const invalid = parseSettings({ trace: "everything" });
  assert.equal(invalid.trace, "off");
  assert.equal(invalid.diagnostics.length, 1);
  assert.match(invalid.diagnostics[0].key, /elisa\.trace\.server/);
  const wrongType = parseSettings({ trace: 2 });
  assert.equal(wrongType.trace, "off");
  assert.equal(wrongType.diagnostics.length, 1);
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
      trace: "off",
      lastFailure: undefined,
      resourceLimits: [],
      warnings: [],
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
      trace: "off",
      lastFailure: {
        kind: "missing-server",
        message: "No server\nfound",
        detail: "/Users/elisa/secret",
        time: 0,
      },
      resourceLimits: [],
      warnings: ["elisa.languageServer.path differs across workspace folders"],
    },
    { homeDirectory: "/Users/elisa" },
  );
  assert.match(report, /Last failure: missing-server \(No server found: ~\/secret\)/);
  assert.match(report, /Warning: elisa\.languageServer\.path differs/);
});
