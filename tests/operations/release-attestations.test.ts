import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyReleaseAttestations } from "../../src/operations/release-attestations.js";

test("production attestations require existing immutable evidence with matching sha256", async () => {
  const root = await mkdtemp(join(tmpdir(), "qa-attest-"));
  const evidence = join(root, "approval.md"); await writeFile(evidence, "approved", "utf8");
  const sha256 = createHash("sha256").update("approved").digest("hex");
  const result = await verifyReleaseAttestations({ allowed_root: root, now: "2026-08-13T00:00:00.000Z", attestations: [
    { kind: "security", owner: "security-team", evidence_path: evidence, sha256, approved_at: "2026-08-12T00:00:00.000Z", expires_at: "2026-09-12T00:00:00.000Z" },
    { kind: "rollback", owner: "release-team", evidence_path: evidence, sha256, approved_at: "2026-08-12T00:00:00.000Z", expires_at: "2026-09-12T00:00:00.000Z" },
    { kind: "incident_owner", owner: "qa-oncall", evidence_path: evidence, sha256, approved_at: "2026-08-12T00:00:00.000Z", expires_at: "2026-09-12T00:00:00.000Z" },
  ] });
  assert.equal(result.ok, true);
});

test("tampered or expired attestations fail closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "qa-attest-")); const evidence = join(root, "approval.md"); await writeFile(evidence, "changed", "utf8");
  const result = await verifyReleaseAttestations({ allowed_root: root, now: "2026-08-13T00:00:00.000Z", attestations: [{ kind: "security", owner: "security-team", evidence_path: evidence, sha256: "0".repeat(64), approved_at: "2026-07-01T00:00:00.000Z", expires_at: "2026-08-01T00:00:00.000Z" }] });
  assert.equal(result.ok, false);
});
