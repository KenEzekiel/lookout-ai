import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createDisclosure, loadDisclosure } from "../tools/disclosure.js";
import { directory } from "./helpers.js";

test("private disclosure terms are normalized and never returned in findings", () => {
  const policy = createDisclosure(["plum-private-marker"]);
  assert.deepEqual(policy.findings("PLUM-PRIVATE-MARKER"), ["blocked_term"]);
  assert.throws(() => policy.assert("plum-private-marker"), /disclosure_refused/);
  assert.equal(policy.assert("Checked two project files."), "Checked two project files.");
});

test("generic credential and absolute-path patterns block disclosure", () => {
  const policy = createDisclosure();
  const cases = [
    `xoxb-${"a".repeat(25)}`,
    `xapp-${"z".repeat(25)}`,
    `sk-${"q".repeat(24)}`,
    ["", "home", "someone", "project"].join("/"),
    ["C:", "People", "someone", "project"].join("\\"),
    `api_key=${"q".repeat(24)}`,
  ];
  for (const value of cases) assert.notEqual(policy.findings(value).length, 0);
});

test("optional private policy loads locally and invalid policy fails closed", async (t) => {
  const path = join(await directory(t), "policy.json");
  assert.equal((await loadDisclosure(path)).findings("Ordinary result").length, 0);
  await writeFile(path, JSON.stringify({ blockedTerms: ["plum-private-marker"] }));
  assert.deepEqual((await loadDisclosure(path)).findings("plum-private-marker"), ["blocked_term"]);
  await writeFile(path, "{}");
  await assert.rejects(loadDisclosure(path), /disclosure_policy_invalid/);
});
