import { performance } from "node:perf_hooks";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { assessContinuousQaBenchmark } from "../dist/src/evaluation/continuous-qa-benchmark.js";
import { selectIncrementalTests } from "../dist/src/continuous-qa/incremental-test-selection.js";
import { assessQualityTrend } from "../dist/src/continuous-qa/quality-trend.js";
import { createSignedEvidenceBundle, verifySignedEvidenceBundle } from "../dist/src/continuous-qa/signed-evidence-bundle.js";

const cases = Array.from({ length: 10_000 }, (_, index) => ({ id: `TC-${index}`, traced_paths: [`src/feature-${index % 100}/**`], tags: [], critical: index < 10 }));
const input = { changed_paths: ["src/feature-42/change.ts"], cases, critical_smoke_ids: cases.slice(0, 10).map((item) => item.id) };
const started = performance.now(); const first = selectIncrementalTests(input); const duration = performance.now() - started; const second = selectIncrementalTests(input);
const outputDir = join(process.cwd(), ".qa-benchmarks"); await mkdir(outputDir, { recursive: true }); const path = join(outputDir, "continuous-qa.json");
const integrityArtifact = join(outputDir, "continuous-qa-integrity-probe.json"); await writeFile(integrityArtifact, JSON.stringify(first));
const { privateKey, publicKey } = generateKeyPairSync("ed25519"); const signed = await createSignedEvidenceBundle({ release: "benchmark", artifact_paths: [integrityArtifact], created_at: "2026-08-13T00:00:00.000Z", private_key: privateKey });
const integrityVerified = (await verifySignedEvidenceBundle({ ...signed, public_key: publicKey })).valid;
const report = assessContinuousQaBenchmark({ selection_cases: cases.length, selection_duration_ms: duration, max_selection_duration_ms: 500, deterministic: JSON.stringify(first) === JSON.stringify(second), integrity_verified: integrityVerified, trend_gate_verified: assessQualityTrend({ windows: [{ release: "a", pass_rate: .99, flake_rate: 0, escaped_defects: 0 }, { release: "b", pass_rate: .9, flake_rate: 0, escaped_defects: 0 }], max_pass_rate_drop: .03, max_flake_rate: .05, max_escaped_defects: 0 }).healthy === false });
await writeFile(path, `${JSON.stringify({ ...report, selection_cases: cases.length, selected_cases: first.selected.length, selection_duration_ms: duration, generated_at: new Date().toISOString() }, null, 2)}\n`);
process.stdout.write(`Continuous QA benchmark: ${report.passed}\nSelection: ${cases.length} cases in ${duration.toFixed(2)}ms\nReport: ${path}\n`); if (!report.passed) process.exitCode = 1;
