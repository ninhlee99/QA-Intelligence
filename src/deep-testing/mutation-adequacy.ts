export function assessMutationAdequacy(input: Readonly<{ mutants: readonly Readonly<{ id: string; critical: boolean; outcome: "killed" | "survived" | "invalid" }>[]; minimum_score: number }>): Readonly<{ passed: boolean; score: number; surviving: readonly string[]; blockers: readonly string[] }> {
  const valid = input.mutants.filter((item) => item.outcome !== "invalid"); const killed = valid.filter((item) => item.outcome === "killed").length; const score = valid.length === 0 ? 0 : killed / valid.length;
  const surviving = valid.filter((item) => item.outcome === "survived").map((item) => item.id); const blockers: string[] = [];
  if (score < input.minimum_score) blockers.push("mutation score below threshold");
  if (valid.some((item) => item.critical && item.outcome === "survived")) blockers.push("critical mutant survived");
  return { passed: blockers.length === 0, score, surviving, blockers };
}
