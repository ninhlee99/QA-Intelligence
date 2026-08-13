export type SelectableTestCase = Readonly<{ id: string; traced_paths: readonly string[]; tags: readonly string[]; critical: boolean }>;

export function selectIncrementalTests(input: Readonly<{ changed_paths: readonly string[]; cases: readonly SelectableTestCase[]; critical_smoke_ids: readonly string[] }>): Readonly<{ selected: readonly Readonly<{ id: string; reasons: readonly string[] }>[]; full_regression_required: boolean }> {
  const full = input.changed_paths.some((path) => /(^|\/)(package-lock\.json|package\.json|tsconfig\.json|migrations\/|src\/shared\/|src\/runtime\/)/.test(path));
  const selected = input.cases.flatMap((testCase) => {
    const reasons: string[] = [];
    if (full) reasons.push("shared-infrastructure-change");
    const matched = input.changed_paths.filter((path) => testCase.traced_paths.some((pattern) => matches(pattern, path)));
    if (matched.length > 0) reasons.push(...matched.map((path) => `trace:${path}`));
    if (input.critical_smoke_ids.includes(testCase.id)) reasons.push("mandatory-critical-smoke");
    return reasons.length > 0 ? [{ id: testCase.id, reasons }] : [];
  });
  return { selected, full_regression_required: full };
}

function matches(pattern: string, path: string): boolean {
  if (pattern.endsWith("/**")) return path.startsWith(pattern.slice(0, -3));
  return pattern === path;
}
