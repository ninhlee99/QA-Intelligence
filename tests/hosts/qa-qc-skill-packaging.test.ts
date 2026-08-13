import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const HOSTS = ["codex", "claude-code", "cursor"] as const;

async function skillsNamed(name: "qa" | "qc"): Promise<string[]> {
  return Promise.all(HOSTS.map((host) => readFile(join(process.cwd(), "hosts", host, "skills", name, "SKILL.md"), "utf8")));
}

test("QA and QC responsibilities are separated consistently across supported hosts", async () => {
  const qa = await skillsNamed("qa");
  const qc = await skillsNamed("qc");

  assert.equal(new Set(qa).size, 1, "QA skill must not drift between hosts");
  assert.equal(new Set(qc).size, 1, "QC skill must not drift between hosts");
  assert.match(qa[0]!, /assess_requirement_quality/);
  assert.match(qa[0]!, /generate_test_cases/);
  assert.match(qa[0]!, /Do not claim an executed pass/);
  assert.match(qc[0]!, /run_expert_qa/);
  assert.match(qc[0]!, /evidence_capture_status/);
  assert.match(qc[0]!, /validate_expert_claim/);
});
