import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import commandIdsModule from "../out/commandIds.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const implemented = Object.values(commandIdsModule.commandIds).sort();

test("implemented commands and contributed commands stay in lockstep", () => {
  const contributed = manifest.contributes.commands
    .map((command) => command.command)
    .sort();
  assert.deepEqual(implemented, contributed);
});

test("every contributed command is categorized and well formed", () => {
  for (const command of manifest.contributes.commands) {
    assert.match(command.command, /^elisa\.[a-zA-Z]+$/);
    assert.equal(typeof command.title, "string");
    assert.ok(command.title.length > 0, `${command.command} has a title`);
    assert.equal(command.category, "Elisa");
  }
});
