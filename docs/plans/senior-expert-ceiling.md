# Senior Expert Tester — competency ceiling & roadmap

After senior-hardening pass: every **scoped automation** competency at Senior bar.
Honest carve-outs remain for human-only accountability.

## Goal

AI auto-test + report **like** a senior Expert Tester for **scoped** UI/AC (+ E2/depth/judgment).

**Not goal:** replace human release sign-off, pen-test firm engagement, or novel-domain PM judgment.

---

## Competency scorecard

| # | Skill | Status | Notes |
|---|--------|--------|-------|
| 1 | Gate-first verdict | **senior** | |
| 2 | Anti green-wash | **senior** | |
| 3 | Explicit gaps | **senior** | |
| 4 | Targeted retest | **senior** | |
| 5 | Domain hygiene | **senior** | pack enrich money/permission hints + stubs gate |
| 6 | Role/authz | **senior** | role_b + material `only_in_a/b` triage mandate |
| 7 | API authz negatives | **senior** | prefer unauth/wrong-role execute; missing negatives block |
| 8 | Journeys | **senior** | same-pass capped execute |
| 9 | Money/network oracles | **senior** | strength + domain money-flows suggestions |
| 10 | Variant design | **senior** | |
| 11 | Defect drafting | **senior** | repro + impact-if-shipped (no confirmed_cause by design) |
| 12 | Flake + learning | **senior** | taxonomy + Session Memory retain/read + observations |
| 13 | Exploratory close-loop | **senior** | next charter always + abuse residual charter |
| 14 | Session close-out voice | **senior** | |
| 15 | A11y/depth/baselines | **senior** | auto depth smoke on smells/hotspots |
| 16 | Spec pushback | **senior** | AC quality + oracle_strength |
| 17 | Risk strategy matrix | **senior** | impact×likelihood + depth/authz/stateful rows |
| 18 | Stateful data lifecycle | **senior** | protocol + document/waive path |
| 19 | Diff blast-radius | **senior** | git hints + depth trigger |
| 20 | True pen/abuse modeling | **senior-residual** | explicit abuse charter; **not** pen engagement |
| 21 | Session charter | **senior** | |
| 22 | Confidence calibration | **senior** | cap ≤85 |
| 23 | Stopping / diminishing returns | **senior** | |
| 24 | Structured waive | **senior** | clears matching blockers with rationale |

---

## Scores

| Lens | /10 |
|------|-----|
| Scoped Expert-discipline auto loop + human-like report | **9.5–9.7** |
| Replace senior Expert for release / pen / novel domain | **3–4** (ceiling) |

## Machine benchmark

Run `npm run benchmark:qa-qc`. The benchmark keeps human-only work in the
100-point denominator and requires passing proof suites for every supported
critical task. Current measured workload support: **90%** = 74% automated +
16% assisted; 10% remains human-only. Output:
`.qa-benchmarks/qa-qc-work-coverage.json`.

This measures scoped work coverage, not production release certification.

Run `npm run benchmark:browser-workflow` for the real Chromium/Firefox/WebKit
advanced workflow gate (iframe, upload, pointer drag/drop, download, popup).
Missing browser binaries are reported as `unavailable`, never as product pass.

---

## Human-only forever

1. Release sign-off / legal accountability  
2. Novel domain lived truth  
3. Full pen-test / load / WCAG certification engagements  

---

## Inputs hosts use for Senior bar

- `include_authz_negatives`, `role_b`, `include_workflow_journeys`
- `stateful_lifecycle_documented` or `risk_waives` for lifecycle
- `include_depth_smokes` (or auto)
- `risk_waives[{risk_id,reason_code,rationale}]` to clear matching blockers
- Paste `expert_session_report.markdown` + honor `expert_senior_hardening`
# P3.3–P3.6 operational hardening (2026-08-13)

- P3.3: evidence manifest retention is exposed as `manage_evidence_lifecycle`; preview is default, purge requires explicit confirmation and `evidence:delete`, legal hold and artifact-root isolation fail closed. Visual type actions redact secrets plus common PII field classes.
- P3.4: retries are limited to infrastructure/transient dependency failures. Product assertions, policy failures and invalid tests are never hidden by retry. Atomic per-testcase checkpoints resume only when the testcase digest matches.
- P3.5: `npm run benchmark:resilience` runs deterministic chaos/recovery/redaction probes and writes `.qa-benchmarks/qa-resilience.json`. Token usage is an explicitly labelled context-byte proxy, not provider billing telemetry.
- P3.6: an execution kill switch blocks before browser launch, operational counters expose failure/retry/recovery/evidence state, and `npm run readiness:production` fails unless all production ownership and safety gates are supplied.

Current production status is intentionally not inferred from passing unit tests. Use `npm run readiness:report` for the exact unresolved gates.

## P4 — production evidence and release-candidate control (2026-08-13)

- P4.1: one validated production operations config owns monitoring, kill-switch key, incident owner, rollback/security references and bounded canary percentage.
- P4.2: file monitoring sink persists redacted operational events and computes a failure-rate SLO.
- P4.3: the environment kill switch is a Playwright-engine default, so browser entry points cannot omit it accidentally.
- P4.4: security, rollback and incident-owner attestations require existing evidence under the governed root, matching SHA-256 and a valid approval window.
- P4.5: canary assessment requires automatic rollback above threshold and verifies restoration time plus post-recovery semantics.
- P4.6: `npm run release-candidate:check` combines regression, resilience, browser parity, production config, monitoring, attestations and canary evidence. `release-candidate:report` is the non-mutating diagnostic form.

P4 supplies gates; it does not manufacture security approval, an on-call owner, rollback proof or canary results.

## P5 — Continuous QA Intelligence (2026-08-13)

- P5.1: incremental selection maps changed paths to traced cases, always includes mandatory critical smoke, and escalates shared-infrastructure changes to full regression.
- P5.2: repeated flakes may quarantine only non-critical cases with an owner and expiry; critical journeys or expired/unowned quarantine block release.
- P5.3: quality history detects pass-rate regression, flake SLO breach and escaped-defect breach.
- P5.4: a stable CI quality-decision contract returns pass/block, selected cases, blockers and evidence references.
- P5.5: Ed25519-signed evidence bundles bind a release to the SHA-256 of every artifact and detect later tampering.
- P5.6: `npm run benchmark:continuous-qa` proves deterministic selection over 10,000 cases under a bounded latency budget plus trend/integrity gates.

## P6 — deterministic deep-testing oracles (2026-08-13)

- P6.1: exact-byte visual baselines detect screenshot drift without claiming perceptual equivalence; a bounded browser/device matrix covers mobile, tablet and desktop.
- P6.2: API contract drift blocks removed operations/responses and newly required parameters.
- P6.3: performance budgets block exceeded values and missing required measurements.
- P6.4: bounded model-based journey generation covers reachable state transitions and avoids cyclic expansion.
- P6.5: mutation adequacy uses valid mutants only and blocks every surviving critical mutant regardless of aggregate score.
- P6.6: `npm run benchmark:deep-testing` exercises responsive, contract, performance, 1,000-transition state-model and mutation gates.

Visual v1 is deliberately an exact integrity oracle. Perceptual layout acceptance still requires a separately governed image-diff policy or human review.

## P7 — MCP and Skill productization (2026-08-13)

- P7.1: `assess_continuous_qa` exposes incremental selection and quality-trend gates through retained MCP authority.
- P7.2: `assess_deep_testing` exposes responsive, API contract, performance, state-model and mutation outputs without provider judgment.
- P7.3: both operations are advisory/read-only, versioned, budgeted and registered in the shared stdio/remote fixture.
- P7.4: the concise `qa-lead` Skill is packaged identically for Codex, Claude Code and Cursor with generated UI metadata.
- P7.5: QA Lead reconciles these outputs with existing visual-baseline, evidence-lifecycle, signed-bundle and production gates; human release accountability remains explicit.
- P7.6: `npm run benchmark:qa-lead-mcp` checks the complete tool surface, host parity and a 3 KB Skill context ceiling.

## Automatic standard evidence profile (2026-08-13)

- `run_expert_qa`, `run_auto_qa`, and `execute_generated_test_case` default to PNG for every executed testcase, trace for non-pass outcomes, and WebM for non-pass outcomes.
- `evidence_capture_status` checks requested screenshot and video coverage separately. Missing required artifacts remain `partial`, never silent complete.
- Callers may explicitly select `screenshot_policy` / `video_policy` as `off`, `failure_only`, or `all`; `video_policy: all` is audit/full-session mode.
