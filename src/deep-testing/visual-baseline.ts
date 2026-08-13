import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
export type VisualBaseline = Readonly<{ screenshot_path: string; sha256: string; viewport: Readonly<{ width: number; height: number }>; browser: string; comparison: "exact_bytes" }>;
export async function createVisualBaseline(input: Readonly<{ screenshot_path: string; viewport: Readonly<{ width: number; height: number }>; browser: string }>): Promise<VisualBaseline> { return { ...input, sha256: createHash("sha256").update(await readFile(input.screenshot_path)).digest("hex"), comparison: "exact_bytes" }; }
export async function compareVisualBaseline(baseline: VisualBaseline): Promise<Readonly<{ matched: boolean; comparison: "exact_bytes" }>> { const digest = createHash("sha256").update(await readFile(baseline.screenshot_path)).digest("hex"); return { matched: digest === baseline.sha256, comparison: "exact_bytes" }; }
