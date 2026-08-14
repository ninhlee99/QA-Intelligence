/**
 * Append-only record of which skill/tool ran for a given requirement_ref,
 * so downstream tools can check whether an upstream qa/testcase pass exists
 * before a claim is made eligible. Advisory by design — a missing or absent
 * ledger downgrades claim_pass_allowed, it never blocks execution (same
 * philosophy as lite_mode).
 */
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type SessionLedgerSkill = "testcase" | "qc" | "retest";

export type SessionLedgerEntryInput = Readonly<{
  requirement_ref: string;
  workspace_id: string;
  skill: SessionLedgerSkill;
  tool: string;
  run_id: string;
  recorded_at: string;
  testcase_design_sha256?: string;
}>;

type LedgerFile = Readonly<{
  schema_version: "1.0.0";
  requirement_ref: string;
  entries: readonly SessionLedgerEntryInput[];
}>;

export async function appendSessionLedgerEntry(input: Readonly<{
  ledger_dir: string;
  entry: SessionLedgerEntryInput;
}>): Promise<Readonly<{ ok: true; ledger_path: string }> | Readonly<{ ok: false; message: string }>> {
  const path = join(input.ledger_dir, "ledger.json");
  const temporary = `${path}.tmp`;
  try {
    const existing = await readLedgerFile(path);
    const entries = existing !== undefined ? [...existing.entries, input.entry] : [input.entry];
    const body: LedgerFile = {
      schema_version: "1.0.0",
      requirement_ref: input.entry.requirement_ref,
      entries,
    };
    await mkdir(input.ledger_dir, { recursive: true });
    await writeFile(temporary, `${JSON.stringify(body, null, 2)}\n`, "utf8");
    await rename(temporary, path);
    return { ok: true, ledger_path: path };
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    return { ok: false, message: `Failed to append session ledger entry: ${(error as Error).message}` };
  }
}

export async function lookupSessionLedger(input: Readonly<{
  ledger_dir: string;
  requirement_ref: string;
}>): Promise<
  | Readonly<{ ok: true; found: true; has_upstream_testcase: boolean }>
  | Readonly<{ ok: true; found: false }>
  | Readonly<{ ok: false; message: string }>
> {
  const path = join(input.ledger_dir, "ledger.json");
  try {
    const ledger = await readLedgerFile(path);
    if (ledger === undefined) return { ok: true, found: false };
    return {
      ok: true,
      found: true,
      has_upstream_testcase: ledger.entries.some((entry) => entry.skill === "testcase"),
    };
  } catch (error) {
    return { ok: false, message: `Failed to read session ledger: ${(error as Error).message}` };
  }
}

async function readLedgerFile(path: string): Promise<LedgerFile | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed["entries"])) return undefined;
    return parsed as unknown as LedgerFile;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
