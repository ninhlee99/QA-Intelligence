import { readFile, realpath, unlink } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export type EvidenceRetentionPolicy = Readonly<{
  passed_days: number;
  failed_days: number;
  flaky_days: number;
  other_days: number;
}>;

export async function applyEvidenceRetention(input: Readonly<{
  manifest_path: string;
  allowed_roots: readonly string[];
  now: string;
  policy: EvidenceRetentionPolicy;
  confirm_purge: boolean;
  legal_hold?: boolean;
}>): Promise<
  | Readonly<{ ok: true; mode: "preview" | "purge" | "legal_hold"; candidates: readonly string[]; deleted: readonly string[]; retained: readonly string[]; warnings: readonly string[] }>
  | Readonly<{ ok: false; message: string }>
> {
  try {
    if (input.allowed_roots.length === 0) return { ok: false, message: "Evidence retention requires at least one allowed root." };
    for (const value of Object.values(input.policy)) {
      if (!Number.isFinite(value) || value < 0) return { ok: false, message: "Evidence retention days must be finite non-negative numbers." };
    }
    const now = Date.parse(input.now);
    if (!Number.isFinite(now)) return { ok: false, message: "Evidence retention now must be a valid timestamp." };
    const roots = await Promise.all(input.allowed_roots.map((root) => realpath(resolve(root))));
    const manifestPath = await realpath(resolve(input.manifest_path));
    if (!roots.some((root) => isWithin(root, manifestPath))) return { ok: false, message: "Evidence manifest is outside allowed roots." };
    const manifest: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
    if (!isRecord(manifest) || manifest["schema_version"] !== "1.0.0" || !Array.isArray(manifest["entries"])) {
      return { ok: false, message: "Unsupported evidence manifest schema." };
    }
    const generatedAt = Date.parse(String(manifest["generated_at"] ?? ""));
    if (!Number.isFinite(generatedAt)) return { ok: false, message: "Evidence manifest generated_at is invalid." };
    const warnings: string[] = [];
    const candidates: string[] = [];
    const retained: string[] = [];
    const seen = new Set<string>();
    for (const entry of manifest["entries"]) {
      if (!isRecord(entry) || typeof entry["ref"] !== "string" || !isAbsolute(entry["ref"])) continue;
      const ref = entry["ref"];
      if (seen.has(ref)) continue;
      seen.add(ref);
      let path: string;
      try {
        path = await realpath(ref);
      } catch {
        warnings.push(`Evidence file unavailable: ${ref}`);
        continue;
      }
      if (!roots.some((root) => isWithin(root, path))) {
        warnings.push(`Evidence file outside allowed roots; retained: ${ref}`);
        retained.push(ref);
        continue;
      }
      const ttl = ttlDays(String(entry["outcome"] ?? ""), input.policy) * 86_400_000;
      if (now - generatedAt >= ttl) candidates.push(ref);
      else retained.push(ref);
    }
    if (input.legal_hold === true) {
      return { ok: true, mode: "legal_hold", candidates: [], deleted: [], retained: [...retained, ...candidates], warnings };
    }
    if (!input.confirm_purge) return { ok: true, mode: "preview", candidates, deleted: [], retained, warnings };
    const deleted: string[] = [];
    for (const ref of candidates) {
      await unlink(ref);
      deleted.push(ref);
    }
    return { ok: true, mode: "purge", candidates, deleted, retained, warnings };
  } catch (error) {
    return { ok: false, message: `Evidence retention failed: ${(error as Error).message}` };
  }
}

function ttlDays(outcome: string, policy: EvidenceRetentionPolicy): number {
  if (outcome === "passed") return policy.passed_days;
  if (outcome === "failed") return policy.failed_days;
  if (outcome === "flaky") return policy.flaky_days;
  return policy.other_days;
}

function isWithin(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
