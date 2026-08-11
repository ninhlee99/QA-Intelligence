---
id: SPEC-107
title: Agent and Skill Evaluation Model
version: 1.1.0
status: accepted
owner:
  - Quality Engineering
  - AI Governance
depends_on:
  - SPEC-004
  - SPEC-101
  - SPEC-102
  - SPEC-104
  - SPEC-106
related_adrs:
  - ADR-001
  - ADR-002
  - ADR-005
  - ADR-008
  - ADR-010
  - ADR-018
last_updated: 2026-08-05
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/KNOWLEDGE_REVIEW.yaml
---

# SPEC-107: Agent and Skill Evaluation Model

## 1. Purpose

This specification defines the canonical artifacts and evidence model used to test QA Intelligence Agents and Skills reproducibly and safely.

## 2. Canonical Artifacts

- **Evaluation Suite**: versioned objective, population, coverage model, gates, and ordered set of cases.
- **Evaluation Case**: immutable inputs, setup, expected constraints, oracle strategy, allowed variation, and cleanup.
- **Evaluation Run**: one campaign against exact subject and environment versions.
- **Trial**: one isolated attempt for a case; repeated trials measure non-deterministic variance.
- **Evaluation Result**: measurements, findings, verdict, evidence, and uncertainty.
- **Oracle**: deterministic or authoritative expected result.
- **Judge**: rubric-based assessor used only where a deterministic oracle is insufficient.
- **Baseline**: accepted comparative result for regression detection, never a substitute for requirements.

## 3. Required Identity and Provenance

Every run and trial SHALL record exact versions of Agent, Skill, Prompt, model/provider, Tool contracts and adapters, rules, knowledge snapshot, dataset, environment, policy, evaluator, and schema. A seed SHALL be recorded where the provider supports one.

Evaluation data SHALL remain Workspace-scoped and distinguish synthetic, production-derived, confidential, and adversarial content.

## 4. Oracle Hierarchy

Verdicts SHALL use the strongest available authority in this order:

1. schema, deterministic rule, invariant, or executable assertion
2. accepted requirement or evidence-based rubric with objective anchors
3. calibrated independent Judge with retained rationale and uncertainty
4. human review by an authorized owner

An LLM Judge SHALL NOT be the sole authority for critical safety, security, destructive-action, legal, acceptance, or release decisions. A Judge SHALL not evaluate its own hidden rationale and SHALL not receive the candidate answer as an instruction source.

## 5. Coverage

This section is the single source of truth for AI/Agent testing coverage
dimensions. Downstream product specifications (including SPEC-206 §9 and
SPEC-213 §3) reference this list rather than independently enumerating it.

Suites SHALL cover applicable dimensions:

- task success and output correctness
- trigger precision and recall for Skills
- instruction and policy adherence
- knowledge grounding, citations, and unsupported claims
- Tool selection, argument correctness, permission use, and side effects
- efficiency, latency, step count, tokens or cost, and termination
- robustness, consistency across trials, recovery, cancellation, and escalation
- prompt injection, exfiltration, privilege escalation, tool misuse, denial-of-wallet, infinite loops, and cross-Workspace access
- sensitive-data handling and unsupported-claim detection
- representative and adverse evaluation sets, and provider drift or fallback behavior
- conflict resolution, missing information, ambiguous inputs, boundary values, and provider failure

This list carries the same depth and priority as Workspace-isolation
coverage required elsewhere in the corpus; adversarial-AI-input testing
SHALL NOT be treated as a lighter-weight or optional dimension relative to
isolation testing.

## 6. Dataset Governance

Evaluation cases SHALL be representative, versioned, reviewable, and traceable to requirements or risks. Development examples, tuning data, release benchmarks, and hidden holdouts SHALL be separated. Exposure of a hidden case to the subject or author is contamination and invalidates the affected comparison.

Production-derived data requires minimization, authorization, redaction, retention controls, and isolation. Failure cases may become Knowledge Candidates only through SPEC-102.

## 7. Verdict and Aggregation

Each case defines blocking assertions, weighted measurements, allowed variance, minimum trials, and pass thresholds before execution. Aggregate scores SHALL NOT hide a failed critical invariant. Statistical summaries SHALL include sample size, dispersion, and confidence or uncertainty appropriate to the metric.

Verdicts are `passed`, `failed`, `blocked`, or `indeterminate`. Infrastructure errors and evaluator failures are not subject failures.

## 8. Reproducibility and Comparison

A result is reproducible when an authorized reviewer can resolve all referenced versions, reconstruct the permitted environment, replay deterministic dependencies, and understand any unavoidable provider variance. Baseline comparison SHALL distinguish subject changes from evaluator, dataset, model, tool, policy, and environment changes.

## 9. Acceptance Criteria

This specification is ready when schemas validate all evaluation artifacts, deterministic and Judge-based examples exist, contamination and cross-Workspace tests pass, critical invariants cannot be averaged away, and evidence supports independent replay and audit.

## 10. Actors and Ownership

Quality Engineering owns suite purpose, case coverage, metrics, oracles, thresholds, and interpretation. Requirement and risk owners own expected business outcomes. AI Governance owns Judge eligibility and calibration policy. Security owns adversarial and non-overridable controls. Runtime Platform operates trials but cannot alter cases or verdict semantics.

The subject author SHALL NOT be the sole approver of a high-risk suite, baseline, exception, or release recommendation.

## 11. Inputs and Outputs

Evaluation planning accepts an immutable subject reference, suite and case versions, dataset and fixture versions, environment profile, policy, budgets, baseline, and requested comparison. It returns a validated campaign plan or structured blockers.

Evaluation produces per-trial observations, failure classification, oracle and Judge results, measurements with sample size and dispersion, critical-invariant outcomes, comparison attribution, uncertainty, evidence references, and a non-authoritative release recommendation.

## 12. Lifecycle, Failure, and Recovery

Suites and cases use the governed artifact lifecycle. Runs and trials use SPEC-607. Invalid test, evaluator error, infrastructure error, policy denial, subject failure, cancellation, timeout, cleanup failure, and indeterminate evidence SHALL be distinguishable.

Recovery preserves every attempt and resumes only when subject, suite, dataset, policy, evaluator, and environment identities remain compatible. Selective retry that discards unfavorable trials is prohibited.

## 13. Observability, Privacy, and Retention

Metrics include queue and execution time, case and assertion outcomes, variance, Judge disagreement and drift, evaluator errors, contamination, critical failures, usage, cost, and cleanup. Reports SHALL protect hidden holdouts, credentials, personal data, protected knowledge, and cross-Workspace content.

Retention distinguishes immutable gate evidence from sensitive raw fixtures and traces. Deletion SHALL preserve lawful audit references without retaining prohibited content.

## 14. Limits and Configuration

Every suite fixes maximum trials, concurrency, duration, steps, Tool use, provider usage, cost, retries, and evidence size before execution. Platform and Workspace policy may lower limits. Threshold or rubric changes create a new version and invalidate comparison unless explicitly normalized and reviewed.

## 15. Edge Cases

Required cases include flaky or bimodal outcomes, Judge disagreement, Judge injection, evaluator outage, baseline generated under different conditions, contaminated holdout, missing evidence, non-replayable provider variance, partial cleanup, critical failure with high aggregate score, cancelled campaign, and cross-Workspace fixture reference.

## 16. Quality Gates and Definition of Done

- suite, case, result, and selected domain output schemas compile strictly
- representative, negative, boundary, adversarial, failure, recovery, and isolation examples exist
- deterministic oracles precede Judges and critical outcomes cannot depend on one LLM Judge
- every comparison exposes changed conditions and statistical uncertainty
- production and deterministic/replay adapters pass the same Interface conformance tests
- hidden data separation, contamination response, Workspace isolation, evidence integrity, and human escalation pass
- GOV-008, GOV-009, and GOV-012 evidence is retained

There are no open semantic decisions in version 1.0. Specific statistical methods and providers are suite-level, versioned choices.
