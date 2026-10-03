import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";
import workspaceSessions from "../out/workspaceSessions.js";

const {
  describeSettingDivergence,
  distinctSettingValues,
  folderValuesSignature,
  resolveServerPathValues,
  routeDocument,
  settingValuesAreConsistent,
  workspaceServerContextChanged,
} = workspaceSessions;

const rootA = path.join(path.sep, "work", "alpha");
const rootB = path.join(path.sep, "work", "alpha", "beta");
const rootC = path.join(path.sep, "work", "gamma");

test("documents route to the innermost containing folder", () => {
  const nested = path.join(rootB, "src", "main.elisa");
  assert.deepEqual(routeDocument({ scheme: "file", fsPath: nested }, [rootA, rootC]), {
    kind: "folder",
    folder: path.normalize(rootA),
  });
  assert.deepEqual(routeDocument({ scheme: "file", fsPath: nested }, [rootA, rootB]), {
    kind: "folder",
    folder: path.normalize(rootB),
  });
});

test("a file exactly at a root boundary belongs to that root", () => {
  assert.deepEqual(routeDocument({ scheme: "file", fsPath: rootA }, [rootA]), {
    kind: "folder",
    folder: path.normalize(rootA),
  });
  assert.deepEqual(
    routeDocument({ scheme: "file", fsPath: `${rootA}-sibling/file.elisa` }, [rootA]),
    { kind: "outside-roots" },
  );
});

test("files outside every root are identified as such", () => {
  assert.deepEqual(
    routeDocument({ scheme: "file", fsPath: path.join(path.sep, "tmp", "loose.elisa") }, [rootA, rootC]),
    { kind: "outside-roots" },
  );
});

test("untitled and non-file documents keep explicit ownership", () => {
  assert.deepEqual(routeDocument({ scheme: "untitled", fsPath: "Untitled-1" }, [rootA]), {
    kind: "untitled",
  });
  assert.deepEqual(
    routeDocument({ scheme: "vscode-vfs", fsPath: "remote/main.elisa" }, [rootA]),
    { kind: "outside-roots" },
  );
});

test("setting divergence is reported only when values actually differ", () => {
  assert.equal(
    describeSettingDivergence("elisa.languageServer.path", [
      { folder: rootA, value: "/one/elisa-lsp" },
      { folder: rootC, value: "/one/elisa-lsp" },
    ]),
    undefined,
  );
  const warning = describeSettingDivergence("elisa.languageServer.path", [
    { folder: rootA, value: "/one/elisa-lsp" },
    { folder: rootC, value: "/two/elisa-lsp" },
  ]);
  assert.match(warning, /differs across workspace folders/);
  assert.match(warning, /cannot apply different values per folder/);
  assert.doesNotMatch(warning, /\/one\/elisa-lsp|\/two\/elisa-lsp|\/work\/alpha|\/work\/gamma/);
  assert.equal(
    describeSettingDivergence("elisa.languageServer.path", [{ folder: rootA, value: "" }]),
    undefined,
  );
});

test("server paths compare after expanding home and resolving their correct base", () => {
  assert.deepEqual(
    resolveServerPathValues(
      [
        { folder: rootA, value: "build/elisa-lsp", baseDirectory: rootA },
        { folder: rootC, value: "build/elisa-lsp", baseDirectory: rootC },
      ],
      rootA,
      "/users/tester",
    ).map(({ value }) => value),
    [path.join(rootA, "build", "elisa-lsp"), path.join(rootC, "build", "elisa-lsp")],
  );
  const homePaths = resolveServerPathValues(
    [
      { folder: rootA, value: "~/bin/elisa-lsp" },
      { folder: rootC, value: "~/bin/elisa-lsp" },
    ],
    rootA,
    "/users/tester",
  );
  assert.deepEqual(
    homePaths.map(({ value }) => value),
    ["/users/tester/bin/elisa-lsp", "/users/tester/bin/elisa-lsp"],
  );
  assert.equal(settingValuesAreConsistent(homePaths), true);
});

test("automatic discovery and explicit paths remain distinct workspace contexts", () => {
  const resolved = resolveServerPathValues(
    [
      { folder: rootA, value: "" },
      { folder: rootC, value: "/opt/elisa-lsp" },
    ],
    rootA,
    "/users/tester",
  );
  assert.deepEqual(distinctSettingValues(resolved), ["", "/opt/elisa-lsp"]);
  assert.equal(settingValuesAreConsistent(resolved), false);
  assert.equal(settingValuesAreConsistent([{ folder: rootA, value: "" }]), true);
  assert.equal(
    settingValuesAreConsistent([
      { folder: rootA, value: "/opt/elisa-lsp" },
      { folder: rootC, value: "/opt/elisa-lsp" },
    ]),
    true,
  );
  assert.equal(settingValuesAreConsistent([{ folder: rootA, value: "", valid: false }]), false);
});

test("workspace path signatures track folder identity and resolved executable without exposing it in diagnostics", () => {
  const one = resolveServerPathValues(
    [{ folder: rootA, value: "/opt/elisa-lsp" }],
    rootA,
    "/users/tester",
  );
  const anotherRoot = resolveServerPathValues(
    [{ folder: rootC, value: "/opt/elisa-lsp" }],
    rootC,
    "/users/tester",
  );
  assert.notEqual(folderValuesSignature(one), folderValuesSignature(anotherRoot));
  const warning = describeSettingDivergence("elisa.languageServer.path", [
    { folder: rootA, value: "/private/one/elisa-lsp" },
    { folder: rootC, value: "/private/two/elisa-lsp" },
  ]);
  assert.doesNotMatch(warning, /\/private\//);
});

test("distinct values trim whitespace and preserve order", () => {
  assert.deepEqual(
    distinctSettingValues([
      { folder: rootA, value: " /one " },
      { folder: rootB, value: "/one" },
      { folder: rootC, value: "" },
    ]),
    ["/one", ""],
  );
});

test("root, executable, and trust transitions invalidate the shared server context", () => {
  const base = { roots: "[\"file:///one\"]", paths: "one-server", trusted: false };
  assert.equal(workspaceServerContextChanged(base, { ...base }), false);
  assert.equal(
    workspaceServerContextChanged(base, { ...base, roots: "[\"file:///two\"]" }),
    true,
  );
  assert.equal(workspaceServerContextChanged(base, { ...base, paths: "two-server" }), true);
  assert.equal(workspaceServerContextChanged(base, { ...base, trusted: true }), true);
});
