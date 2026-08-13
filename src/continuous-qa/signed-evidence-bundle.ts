import { createHash, sign, verify, type KeyLike } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

export type EvidenceBundle = Readonly<{ schema_version: "1.0.0"; release: string; artifacts: readonly Readonly<{ path: string; sha256: string }>[]; created_at: string }>;
export async function createSignedEvidenceBundle(input: Readonly<{ release: string; artifact_paths: readonly string[]; created_at: string; private_key: KeyLike }>): Promise<Readonly<{ bundle: EvidenceBundle; signature: string }>> {
  const artifacts = [];
  for (const path of [...input.artifact_paths].sort()) artifacts.push({ path, sha256: createHash("sha256").update(await readFile(path)).digest("hex") });
  const bundle: EvidenceBundle = { schema_version: "1.0.0", release: input.release, artifacts, created_at: input.created_at };
  return { bundle, signature: sign(null, Buffer.from(canonical(bundle)), input.private_key).toString("base64") };
}
export async function verifySignedEvidenceBundle(input: Readonly<{ bundle: EvidenceBundle; signature: string; public_key: KeyLike }>): Promise<Readonly<{ valid: boolean; reasons: readonly string[] }>> {
  const reasons: string[] = [];
  if (!verify(null, Buffer.from(canonical(input.bundle)), input.public_key, Buffer.from(input.signature, "base64"))) reasons.push("bundle signature invalid");
  for (const artifact of input.bundle.artifacts) {
    const digest = await readFile(artifact.path).then((bytes) => createHash("sha256").update(bytes).digest("hex")).catch(() => "missing");
    if (digest !== artifact.sha256) reasons.push(`artifact integrity mismatch: ${artifact.path}`);
  }
  return { valid: reasons.length === 0, reasons };
}
function canonical(bundle: EvidenceBundle): string { return JSON.stringify(bundle); }
