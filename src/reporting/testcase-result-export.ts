import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type TestcaseResultExportInput = Readonly<{
  output_dir: string;
  run_id: string;
  target_url: string;
  generated_at: string;
  test_cases: readonly Readonly<{
    test_case_id: string;
    purpose: string;
    variant: string;
    outcome: string;
    skip_reason?: string;
    evidence: readonly string[];
  }>[];
}>;

export async function exportTestcaseResults(input: TestcaseResultExportInput): Promise<
  Readonly<{ ok: true; json_path: string; csv_path: string }> | Readonly<{ ok: false; message: string }>
> {
  try {
    await mkdir(input.output_dir, { recursive: true });
    const rows = input.test_cases.map((testCase) => ({
      test_case_id: testCase.test_case_id,
      purpose: testCase.purpose,
      variant: testCase.variant,
      status: testCase.outcome,
      skip_reason: testCase.skip_reason ?? "",
      evidence: [...testCase.evidence],
    }));
    const jsonPath = join(input.output_dir, "testcase-results.json");
    const csvPath = join(input.output_dir, "testcase-results.csv");
    await writeFile(jsonPath, JSON.stringify({
      schema_version: "1.0.0",
      run_id: input.run_id,
      target_url: input.target_url,
      generated_at: input.generated_at,
      test_cases: rows,
    }, null, 2), "utf8");
    const header = ["test_case_id", "purpose", "variant", "status", "skip_reason", "evidence"];
    const csv = [header, ...rows.map((row) => [
      row.test_case_id, row.purpose, row.variant, row.status, row.skip_reason, row.evidence.join(";"),
    ])].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
    await writeFile(csvPath, csv, "utf8");
    return { ok: true, json_path: jsonPath, csv_path: csvPath };
  } catch (error) {
    return { ok: false, message: `Failed to export testcase results: ${(error as Error).message}` };
  }
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
