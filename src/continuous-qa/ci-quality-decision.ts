export type CiQualityDecision = Readonly<{ schema_version: "1.0.0"; decision: "pass" | "block"; release: string; selected_case_ids: readonly string[]; blockers: readonly string[]; evidence_refs: readonly string[]; generated_at: string }>;
export function buildCiQualityDecision(input: Omit<CiQualityDecision, "schema_version" | "decision">): CiQualityDecision {
  return { schema_version: "1.0.0", decision: input.blockers.length === 0 ? "pass" : "block", ...input };
}
