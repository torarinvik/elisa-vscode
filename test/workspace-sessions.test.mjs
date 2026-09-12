import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";
import workspaceSessions from "../out/workspaceSessions.js";

const { describeSettingDivergence, distinctSettingValues, routeDocument } = workspaceSessions;

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
  assert.match(warning, /first folder's value/);
  assert.equal(
    describeSettingDivergence("elisa.languageServer.path", [{ folder: rootA, value: "" }]),
    undefined,
  );
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
