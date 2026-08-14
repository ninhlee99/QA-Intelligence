import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

async function json(path) { try { return JSON.parse(await readFile(path, "utf8")); } catch { return undefined; } }
async function exists(path) { try { await access(path); return true; } catch { return false; } }
function digest(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
async function sha256File(path) { return createHash("sha256").update(await readFile(path)).digest("hex"); }

/**
 * Independently re-opens session output files after a session ends and
 * cross-checks structural claims against sibling artifacts — never imports
 * deriveExpertChecklist, since re-running the trusted function would just
 * re-run the same code, not verify it independently.
 */
async function checkTestcaseDesignIntegrity(sessionDir) {
  const design = await json(join(sessionDir, "testcase-design.json"));
  if (design === undefined) return { id: "testcase_design_integrity", passed: true, skipped: "no testcase-design.json" };
  const { integrity, ...body } = design;
  if (integrity?.algorithm !== "sha256" || typeof integrity.digest !== "string") {
    return { id: "testcase_design_integrity", passed: false, details: "missing or malformed integrity block" };
  }
  const recomputed = digest(body);
  return { id: "testcase_design_integrity", passed: recomputed === integrity.digest, details: recomputed === integrity.digest ? undefined : `recomputed ${recomputed} != declared ${integrity.digest}` };
}

async function checkEvidenceManifestFiles(sessionDir) {
  const manifest = await json(join(sessionDir, "manifest.json"));
  if (manifest === undefined) return { id: "evidence_manifest_files_exist", passed: true, skipped: "no manifest.json" };
  const mismatches = [];
  for (const entry of manifest.entries ?? []) {
    if (entry.integrity === "unavailable" || typeof entry.sha256 !== "string") continue;
    if (!(await exists(entry.ref))) { mismatches.push(`${entry.ref}: file missing`); continue; }
    const actual = await sha256File(entry.ref);
    if (actual !== entry.sha256) mismatches.push(`${entry.ref}: sha256 mismatch`);
  }
  return { id: "evidence_manifest_files_exist", passed: mismatches.length === 0, details: mismatches.length > 0 ? mismatches : undefined };
}

async function checkClaimPassAllowedPlausible(sessionDir) {
  const checklistFile = await json(join(sessionDir, "expert-checklist.json"));
  const results = await json(join(sessionDir, "testcase-results.json"));
  if (checklistFile === undefined || results === undefined) {
    return { id: "claim_pass_allowed_plausible", passed: true, skipped: "expert-checklist.json or testcase-results.json not present" };
  }
  const claimPassAllowed = checklistFile.checklist?.["claim_pass_allowed"] === true;
  if (!claimPassAllowed) return { id: "claim_pass_allowed_plausible", passed: true };

  const counted = { failed: 0, flaky: 0, not_executed: 0 };
  for (const testCase of results.test_cases ?? []) {
    if (testCase.status === "failed") counted.failed += 1;
    else if (testCase.status === "flaky") counted.flaky += 1;
    else if (testCase.status === "not_executed") counted.not_executed += 1;
  }
  const plausible = counted.failed === 0 && counted.flaky === 0 && counted.not_executed === 0;
  return {
    id: "claim_pass_allowed_plausible",
    passed: plausible,
    details: plausible ? undefined : `checklist claims claim_pass_allowed:true but testcase-results.json independently counts ${JSON.stringify(counted)}`,
  };
}

async function checkLedgerSequenceConsistent(sessionDir, ledgerDir, requirementRef, runId) {
  if (ledgerDir === undefined || requirementRef === undefined) {
    return { id: "ledger_sequence_consistent", passed: true, skipped: "no ledger_dir/requirement_ref supplied" };
  }
  const ledger = await json(join(ledgerDir, "ledger.json"));
  if (ledger === undefined) return { id: "ledger_sequence_consistent", passed: true, warning: true, details: "no ledger found — sequencing is opt-out-able, absence is not itself a failure" };

  const entries = ledger.entries ?? [];
  const thisRunIndex = entries.findIndex((entry) => entry.run_id === runId);
  const testcaseIndex = entries.findIndex((entry) => entry.skill === "testcase");
  if (thisRunIndex === -1) return { id: "ledger_sequence_consistent", passed: true, skipped: "this run_id has no ledger entry" };
  const consistent = testcaseIndex !== -1 && testcaseIndex < thisRunIndex;
  return {
    id: "ledger_sequence_consistent",
    passed: testcaseIndex === -1 ? true : consistent,
    warning: testcaseIndex !== -1 && !consistent,
    details: testcaseIndex !== -1 && !consistent ? "a testcase ledger entry exists but not chronologically before this run" : undefined,
  };
}

const sessionDir = process.argv[2];
if (!sessionDir || sessionDir.startsWith("--")) {
  process.stderr.write("Usage: verify-qa-artifacts.mjs <session-output-dir> [--report-only] [--ledger-dir <dir>] [--requirement-ref <ref>] [--run-id <id>]\n");
  process.exitCode = 1;
} else {
  const ledgerDirFlagIndex = process.argv.indexOf("--ledger-dir");
  const requirementRefFlagIndex = process.argv.indexOf("--requirement-ref");
  const runIdFlagIndex = process.argv.indexOf("--run-id");
  const ledgerDir = ledgerDirFlagIndex !== -1 ? process.argv[ledgerDirFlagIndex + 1] : undefined;
  const requirementRef = requirementRefFlagIndex !== -1 ? process.argv[requirementRefFlagIndex + 1] : undefined;
  const runId = runIdFlagIndex !== -1 ? process.argv[runIdFlagIndex + 1] : undefined;

  const checks = [
    await checkTestcaseDesignIntegrity(sessionDir),
    await checkEvidenceManifestFiles(sessionDir),
    await checkClaimPassAllowedPlausible(sessionDir),
    await checkLedgerSequenceConsistent(sessionDir, ledgerDir, requirementRef, runId),
  ];
  const verified = checks.every((check) => check.passed);
  const report = { session_dir: sessionDir, checks, verified, generated_at: new Date().toISOString() };

  const outputDir = join(process.cwd(), ".qa-benchmarks");
  await mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, "verify-qa-artifacts.json");
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  process.stdout.write(`Verified: ${verified}\n`);
  for (const check of checks) {
    const tag = check.skipped ? "skip" : check.passed ? "pass" : check.warning ? "warn" : "FAIL";
    process.stdout.write(`  [${tag}] ${check.id}${check.details ? `: ${JSON.stringify(check.details)}` : ""}\n`);
  }
  process.stdout.write(`Report: ${outputPath}\n`);
  if (!verified && !process.argv.includes("--report-only")) process.exitCode = 1;
}
