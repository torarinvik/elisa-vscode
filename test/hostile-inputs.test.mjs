import assert from "node:assert/strict";
import test from "node:test";
import { fixtureText, hasScope, loadElisaGrammar, tokenAt, tokenizeFile } from "./helpers/grammar.mjs";
import config from "../out/config.js";
import health from "../out/health.js";
import discovery from "../out/serverDiscovery.js";

const { parseSettings } = config;
const { formatHealthReport, sanitizeLine } = health;
const { buildCandidates, probeInBatches } = discovery;

test("a huge PATH is bounded and stops probing at the first hit", async () => {
  const entries = Array.from({ length: 5000 }, (_, index) => `/opt/toolchain-${index}/bin`);
  const candidates = buildCandidates({
    configuredPath: "",
    environmentPath: "",
    workspaceRoots: ["/work"],
    extensionPath: "/ext",
    homeDirectory: "/home/elisa",
    platform: "darwin",
    environmentPathValue: entries.join(":"),
    pathDelimiter: ":",
    trusted: true,
  });
  const pathCandidates = candidates.filter((candidate) => candidate.source === "path");
  assert.equal(pathCandidates.length, 5000);
  let probed = 0;
  const probe = {
    async probeFile(candidate) {
      probed += 1;
      const status = candidate.path.includes("toolchain-2/") ? "ok" : "missing";
      return { candidate, status };
    },
  };
  const results = await probeInBatches(pathCandidates, probe, "darwin", 4);
  assert.ok(probed <= 8, `probed ${probed} candidates after an early hit`);
  assert.equal(results.some((result) => result.status === "ok"), true);
});

test("malformed settings values never throw and always produce diagnostics", () => {
  const hostile = [
    { languageServerPath: { nested: true } },
    { languageServerPath: ["/a", "/b"] },
    { languageServerPath: Number.NaN },
    { languageServerPath: "x".repeat(100000) },
    { languageServerPath: "line\nbreak" },
  ];
  for (const raw of hostile) {
    const parsed = parseSettings(raw);
    assert.equal(typeof parsed.languageServerPath, "string");
    if (typeof raw.languageServerPath !== "string") {
      assert.ok(parsed.diagnostics.length > 0, "wrong types are diagnosed");
    }
  }
});

test("health report details cannot inject new lines", () => {
  const sanitized = sanitizeLine("first\n- fake bullet\r\nsecond", "/home/elisa");
  assert.equal(sanitized, "first - fake bullet second");
  const report = formatHealthReport(
    {
      extensionVersion: "0.1.0",
      buildIdentifier: "test",
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
        message: "line one\nline two",
        detail: "detail\ninjected",
        time: 0,
      },
      resourceLimits: [],
    },
    { homeDirectory: "/home/elisa" },
  );
  const failureLine = report
    .split("\n")
    .find((line) => line.startsWith("- Last failure:"));
  assert.ok(failureLine);
  assert.match(failureLine, /line one line two: detail injected/);
});

test("adversarial long lines tokenize in bounded time", async () => {
  const grammar = await loadElisaGrammar();
  const cases = [
    ".".repeat(20000),
    "{".repeat(20000),
    Array.from({ length: 5000 }, (_, index) => `Pascal${index}`).join("."),
    `f"${"{".repeat(10000)}`,
    '"unterminated ' + "x".repeat(50000),
  ];
  for (const line of cases) {
    const started = Date.now();
    const tokens = tokenizeFile(grammar, `${line}\n`);
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 10000, `tokenizing a ${line.length} character line took ${elapsed} ms`);
    assert.ok(tokens[0].length > 0 || line.length === 0);
  }
});

test("an unterminated string recovers at the next quote", async () => {
  const grammar = await loadElisaGrammar();
  const source = [
    "def broken():",
    '    a: dstr = "unterminated',
    '    b: dstr = "recovered"',
    "def after():",
    "    c: i64 = 1",
  ].join("\n");
  const tokens = tokenizeFile(grammar, source);
  assert.ok(
    hasScope(tokenAt(tokens[2], "recovered"), "string.quoted.double"),
    "recovered text is a string again",
  );
  assert.equal(
    hasScope(tokenAt(tokens[3], "def"), "string.quoted"),
    false,
    "the declaration after the closing quote is not inside a string",
  );
});

test("grammar tokenization is deterministic for the same input", async () => {
  const grammar = await loadElisaGrammar();
  const text = fixtureText("enum-family.elisa");
  const first = JSON.stringify(tokenizeFile(grammar, text));
  const second = JSON.stringify(tokenizeFile(grammar, text));
  assert.equal(first, second);
});

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test("seeded random token soup never throws and always yields ordered tokens", async () => {
  const grammar = await loadElisaGrammar();
  const alphabet = [
    "enum",
    "def",
    "Event",
    "None",
    "resize",
    "(",
    ")",
    "{",
    "}",
    "[",
    "]",
    ":",
    ".",
    "..",
    "..<",
    "<-",
    "->",
    "<<",
    ">>",
    "<=",
    ">=",
    "f\"",
    "\"",
    "'",
    "\\",
    "#",
    " ",
    "\t",
    "\n",
    "\r\n",
    "_",
    "123",
    "0x1F",
    "true",
    "@decorator",
    "λ",
    "élan",
  ];
  const random = seededRandom(20260912);
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const parts = [];
    const length = 20 + Math.floor(random() * 80);
    for (let index = 0; index < length; index += 1) {
      parts.push(alphabet[Math.floor(random() * alphabet.length)]);
    }
    const text = parts.join("");
    const tokens = tokenizeFile(grammar, text);
    for (const lineTokens of tokens) {
      let previousEnd = 0;
      for (const token of lineTokens) {
        assert.ok(token.start >= previousEnd, "tokens are ordered and non-overlapping");
        previousEnd = token.start + token.text.length;
      }
    }
  }
});
