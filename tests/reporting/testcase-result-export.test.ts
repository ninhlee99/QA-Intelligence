import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { exportTestcaseResults } from "../../src/reporting/testcase-result-export.js";

test("exportTestcaseResults writes reusable JSON and CSV with status and evidence", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qa-testcase-export-"));
  const result = await exportTestcaseResults({
    output_dir: dir,
    run_id: "run-1",
    target_url: "https://test.invalid",
    generated_at: "2026-08-12T00:00:00.000Z",
    test_cases: [{ test_case_id: "TC-1", purpose: "Login, quoted", variant: "positive", outcome: "passed", evidence: ["/tmp/a.webm"] }],
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  const json = JSON.parse(await readFile(result.json_path, "utf8")) as { test_cases: Array<{ status: string }> };
  assert.equal(json.test_cases[0]?.status, "passed");
  const csv = await readFile(result.csv_path, "utf8");
  assert.match(csv, /test_case_id,purpose,variant,status,skip_reason,evidence/);
  assert.match(csv, /"Login, quoted"/);
  assert.match(csv, /\/tmp\/a\.webm/);
});
