export function assessPerformanceBudget(input: Readonly<{ observations: readonly Readonly<{ name: string; value: number; unit: "ms" | "bytes" }>[]; budgets: Readonly<Record<string, number>> }>): Readonly<{ passed: boolean; violations: readonly string[] }> {
  const violations = input.observations.flatMap((item) => input.budgets[item.name] === undefined || item.value <= input.budgets[item.name]! ? [] : [`${item.name}=${item.value}${item.unit} exceeds ${input.budgets[item.name]}${item.unit}`]);
  const missing = Object.keys(input.budgets).filter((name) => !input.observations.some((item) => item.name === name)).map((name) => `missing observation: ${name}`);
  return { passed: violations.length + missing.length === 0, violations: [...violations, ...missing] };
}
