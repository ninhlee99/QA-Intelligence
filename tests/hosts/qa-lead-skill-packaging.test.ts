import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
const HOSTS = ["codex", "claude-code", "cursor"] as const;
test("QA lead skill is token-efficient and identical across supported hosts", async () => {
  const bodies = await Promise.all(HOSTS.map((host) => readFile(join(process.cwd(), "hosts", host, "skills", "qa-lead", "SKILL.md"), "utf8")));
  assert.equal(new Set(bodies).size, 1); assert.ok(Buffer.byteLength(bodies[0]!) < 3000);
  assert.match(bodies[0]!, /assess_continuous_qa/); assert.match(bodies[0]!, /assess_deep_testing/); assert.match(bodies[0]!, /release sign-off human/i);
});
