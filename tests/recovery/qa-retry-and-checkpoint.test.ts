import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FileCampaignCheckpoints } from "../../src/recovery/file-campaign-checkpoints.js";
import { decideQaRetry } from "../../src/recovery/qa-retry-policy.js";

test("retry policy retries only bounded transient/infrastructure failures", () => {
  assert.equal(decideQaRetry({ failure_class: "infrastructure", attempt: 1, max_attempts: 2, critical_journey: false }).retry, true);
  assert.equal(decideQaRetry({ failure_class: "product_assertion", attempt: 1, max_attempts: 2, critical_journey: false }).retry, false);
  assert.equal(decideQaRetry({ failure_class: "policy", attempt: 1, max_attempts: 2, critical_journey: false }).retry, false);
  assert.equal(decideQaRetry({ failure_class: "transient_dependency", attempt: 2, max_attempts: 2, critical_journey: false }).retry, false);
  assert.equal(decideQaRetry({ failure_class: "product_assertion", attempt: 1, max_attempts: 2, critical_journey: true }).action, "block_release");
});

test("campaign resumes exact completed cases and rejects changed input", async () => {
  const store = new FileCampaignCheckpoints(await mkdtemp(join(tmpdir(), "qa-checkpoints-")));
  assert.equal((await store.resume("campaign-1", "TC-1", "sha:a")).status, "run");
  await store.record({ campaign_id: "campaign-1", case_id: "TC-1", input_digest: "sha:a", outcome: "passed", evidence: ["capture:1"], completed_at: "2026-08-13T00:00:00.000Z" });
  const resumed = await store.resume("campaign-1", "TC-1", "sha:a");
  assert.equal(resumed.status, "resume");
  const conflict = await store.resume("campaign-1", "TC-1", "sha:changed");
  assert.equal(conflict.status, "conflict");
});
