import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { extname, isAbsolute } from "node:path";

export type EvidenceManifestInput = Readonly<{
  manifest_path: string;
  run_id: string;
  generated_at: string;
  test_cases: readonly Readonly<{
    test_case_id: string;
    outcome: string;
    evidence: readonly string[];
  }>[];
}>;

export type EvidenceManifestResult =
  | Readonly<{ ok: true; manifest_path: string; entry_count: number; warnings: readonly string[] }>
  | Readonly<{ ok: false; message: string }>;

/** Writes a compact integrity index; artifact bytes remain on disk and never enter MCP output. */
export async function writeEvidenceManifest(input: EvidenceManifestInput): Promise<EvidenceManifestResult> {
  try {
    const warnings: string[] = [];
    const entries: Record<string, unknown>[] = [];
    for (const testCase of input.test_cases) {
      for (const ref of testCase.evidence) {
        const entry: Record<string, unknown> = {
          test_case_id: testCase.test_case_id,
          outcome: testCase.outcome,
          kind: evidenceKind(ref),
          ref,
        };
        if (isFileEvidence(ref)) {
          try {
            const bytes = await readFile(ref);
            const info = await stat(ref);
            entry["size_bytes"] = info.size;
            entry["sha256"] = createHash("sha256").update(bytes).digest("hex");
          } catch {
            entry["integrity"] = "unavailable";
            warnings.push(`Evidence file unavailable: ${ref}`);
          }
        }
        entries.push(entry);
      }
    }
    await writeFile(input.manifest_path, JSON.stringify({
      schema_version: "1.0.0",
      run_id: input.run_id,
      generated_at: input.generated_at,
      entries,
      warnings,
    }, null, 2), "utf8");
    return { ok: true, manifest_path: input.manifest_path, entry_count: entries.length, warnings };
  } catch (error) {
    return { ok: false, message: `Failed to write evidence manifest: ${(error as Error).message}` };
  }
}

function isFileEvidence(ref: string): boolean {
  return isAbsolute(ref) || [".png", ".webm", ".zip", ".json", ".har"].includes(extname(ref).toLowerCase());
}

function evidenceKind(ref: string): string {
  const extension = extname(ref).toLowerCase();
  if (extension === ".png") return "screenshot";
  if (extension === ".webm") return "video";
  if (extension === ".zip") return "trace";
  if (extension === ".har") return "network_har";
  if (isAbsolute(ref)) return "file_artifact";
  if (ref.startsWith("capture:")) return "dom_capture";
  if (ref.startsWith("network-obs:")) return "network_observation";
  return "reference";
}
