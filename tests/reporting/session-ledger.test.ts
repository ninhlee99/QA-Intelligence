import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { appendSessionLedgerEntry, lookupSessionLedger } from "../../src/reporting/session-ledger.js";

function entry(skill: "testcase" | "qc" | "retest", overrides: Partial<Parameters<typeof appendSessionLedgerEntry>[0]["entry"]> = {}) {
  return {
    requirement_ref: "REQ-1",
    workspace_id: "workspace-1",
    skill,
    tool: "generate_test_cases",
    run_id: "run-1",
    recorded_at: "2026-08-14T00:00:00.000Z",
    ...overrides,
  };
}

test("appendSessionLedgerEntry writes a new ledger with one entry when none exists", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qa-session-ledger-"));
  const result = await appendSessionLedgerEntry({ ledger_dir: dir, entry: entry("testcase") });
  assert.equal(result.ok, true, JSON.stringify(result));

  const lookup = await lookupSessionLedger({ ledger_dir: dir, requirement_ref: "REQ-1" });
  assert.deepEqual(lookup, { ok: true, found: true, has_upstream_testcase: true });
});

test("appendSessionLedgerEntry appends without clobbering prior entries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qa-session-ledger-"));
  await appendSessionLedgerEntry({ ledger_dir: dir, entry: entry("testcase") });
  await appendSessionLedgerEntry({ ledger_dir: dir, entry: entry("qc", { run_id: "run-2" }) });

  const path = join(dir, "ledger.json");
  const raw = JSON.parse(await (await import("node:fs/promises")).readFile(path, "utf8")) as { entries: unknown[] };
  assert.equal(raw.entries.length, 2);
});

test("lookupSessionLedger returns found:false for a missing ledger, not an error", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qa-session-ledger-"));
  const lookup = await lookupSessionLedger({ ledger_dir: dir, requirement_ref: "REQ-absent" });
  assert.deepEqual(lookup, { ok: true, found: false });
});

test("has_upstream_testcase is false when the ledger has entries but none are skill:testcase", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qa-session-ledger-"));
  await appendSessionLedgerEntry({ ledger_dir: dir, entry: entry("qc") });

  const lookup = await lookupSessionLedger({ ledger_dir: dir, requirement_ref: "REQ-1" });
  assert.deepEqual(lookup, { ok: true, found: true, has_upstream_testcase: false });
});
