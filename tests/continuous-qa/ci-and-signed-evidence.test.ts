import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildCiQualityDecision } from "../../src/continuous-qa/ci-quality-decision.js";
import { createSignedEvidenceBundle, verifySignedEvidenceBundle } from "../../src/continuous-qa/signed-evidence-bundle.js";

test("CI quality decision is machine-readable and blocks on any retained blocker", () => {
  assert.equal(buildCiQualityDecision({ release: "r1", selected_case_ids: ["TC-1"], blockers: ["flake"], evidence_refs: ["report:x"], generated_at: "2026-08-13T00:00:00Z" }).decision, "block");
});

test("signed evidence bundle verifies signature and artifact bytes", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "qa-bundle-")), "report.json"); await writeFile(path, "original");
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const signed = await createSignedEvidenceBundle({ release: "r1", artifact_paths: [path], created_at: "2026-08-13T00:00:00Z", private_key: privateKey });
  assert.equal((await verifySignedEvidenceBundle({ ...signed, public_key: publicKey })).valid, true);
  await writeFile(path, "tampered");
  assert.equal((await verifySignedEvidenceBundle({ ...signed, public_key: publicKey })).valid, false);
});
