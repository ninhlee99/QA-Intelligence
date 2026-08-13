import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const HOSTS = ["codex", "claude-code", "cursor"] as const;

test("every supported host ships the testcase-design skill with the same token-efficient handoff", async () => {
  const skillBodies = await Promise.all(
    HOSTS.map((host) => readFile(join(process.cwd(), "hosts", host, "skills", "testcase", "SKILL.md"), "utf8")),
  );

  assert.equal(new Set(skillBodies).size, 1, "host skill behavior must not drift");
  const skill = skillBodies[0]!;
  assert.match(skill, /^---\nname: testcase\n/m);
  assert.match(skill, /generate_test_cases/);
  assert.match(skill, /assess_test_case_quality/);
  assert.match(skill, /Do not execute browser tests/);
  assert.match(skill, /test_cases/);
  assert.match(skill, /generated_assertions/);
  assert.match(skill, /findings/);
});
