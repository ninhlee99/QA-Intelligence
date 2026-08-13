import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { relative, resolve } from "node:path";

export type ReleaseAttestation = Readonly<{ kind: "security" | "rollback" | "incident_owner"; owner: string; evidence_path: string; sha256: string; approved_at: string; expires_at: string }>;

export async function verifyReleaseAttestations(input: Readonly<{ allowed_root: string; now: string; attestations: readonly ReleaseAttestation[] }>): Promise<Readonly<{ ok: true; evidence: readonly string[] }> | Readonly<{ ok: false; reasons: readonly string[] }>> {
  const reasons: string[] = [];
  const evidence: string[] = [];
  const required = ["security", "rollback", "incident_owner"] as const;
  for (const kind of required) if (input.attestations.filter((item) => item.kind === kind).length !== 1) reasons.push(`${kind} requires exactly one attestation`);
  const root = await realpath(resolve(input.allowed_root)).catch(() => resolve(input.allowed_root));
  for (const item of input.attestations) {
    if (!item.owner.trim()) reasons.push(`${item.kind} owner is required`);
    const path = await realpath(resolve(item.evidence_path)).catch(() => "");
    const rel = path ? relative(root, path) : "..";
    if (!path || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) { reasons.push(`${item.kind} evidence escapes allowed root or is missing`); continue; }
    const bytes = await readFile(path);
    if (createHash("sha256").update(bytes).digest("hex") !== item.sha256) reasons.push(`${item.kind} evidence digest mismatch`);
    const approved = Date.parse(item.approved_at); const expires = Date.parse(item.expires_at); const now = Date.parse(input.now);
    if (!Number.isFinite(approved) || !Number.isFinite(expires) || approved > now || expires <= now) reasons.push(`${item.kind} attestation is invalid or expired`);
    evidence.push(`${item.kind}:${item.evidence_path}#sha256=${item.sha256}`);
  }
  return reasons.length > 0 ? { ok: false, reasons } : { ok: true, evidence };
}
