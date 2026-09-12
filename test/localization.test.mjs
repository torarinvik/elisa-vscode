import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const nls = JSON.parse(readFileSync(resolve(root, "package.nls.json"), "utf8"));

function collectLocalizationKeys(value, keys) {
  if (typeof value === "string") {
    const match = /^%(.+)%$/.exec(value);
    if (match) {
      keys.add(match[1]);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectLocalizationKeys(entry, keys);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) {
      collectLocalizationKeys(entry, keys);
    }
  }
}

test("every manifest localization key resolves to a default English string", () => {
  const keys = new Set();
  collectLocalizationKeys(manifest, keys);
  assert.ok(keys.size > 0, "the manifest uses localization keys");
  for (const key of keys) {
    assert.equal(typeof nls[key], "string", `package.nls.json defines ${key}`);
    assert.ok(nls[key].trim().length > 0, `${key} is not empty`);
  }
});

test("package.nls.json does not define unused keys", () => {
  const used = new Set();
  collectLocalizationKeys(manifest, used);
  for (const key of Object.keys(nls)) {
    assert.ok(used.has(key), `package.nls.json key ${key} is used by the manifest`);
  }
});
