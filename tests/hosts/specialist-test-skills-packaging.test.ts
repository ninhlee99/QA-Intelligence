import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const HOSTS = ["codex", "claude-code", "cursor"] as const;

async function sameSkill(name: string): Promise<string> {
  const bodies = await Promise.all(HOSTS.map((host) => readFile(join(process.cwd(), "hosts", host, "skills", name, "SKILL.md"), "utf8")));
  assert.equal(new Set(bodies).size, 1, `${name} skill must not drift between hosts`);
  return bodies[0]!;
}

test("specialist testing skills keep exploratory, retest, and defect responsibilities narrow", async () => {
  const exploratory = await sameSkill("exploratory");
  const retest = await sameSkill("retest");
  const defect = await sameSkill("defect-triage");
  assert.match(exploratory, /generate_exploratory_charter/);
  assert.match(exploratory, /execute_exploratory_session/);
  assert.match(exploratory, /not a penetration test/i);
  assert.match(retest, /run_regression_suite/);
  assert.match(retest, /case_ids/);
  assert.match(retest, /related_defect_ids/);
  assert.match(defect, /draft_defects_from_qa_run/);
  assert.match(defect, /assess_defect_quality/);
  assert.match(defect, /confirmed_cause/);
});
