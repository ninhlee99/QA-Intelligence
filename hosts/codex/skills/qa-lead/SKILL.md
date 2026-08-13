---
name: qa-lead
description: Govern continuous QA, incremental regression, quality trends, deep-testing gates, and release evidence. Use when planning CI test scope, reviewing flaky quarantine, assessing API/performance/state/mutation depth, or producing an evidence-backed quality decision across releases.
---

# QA lead

1. Call `assess_continuous_qa` with changed paths, traced cases, mandatory critical smoke, and retained quality windows.
2. Run full regression when the result says `full_regression_required`; never widen a targeted result into untested confidence.
3. Treat critical flakes, unowned/expired quarantine, declining pass rate, escaped defects, and missing history as blockers.
4. Call `assess_deep_testing` only with measured contracts, budgets, transitions, and mutation outcomes. Never invent observations.
5. Reconcile outputs with testcase results, evidence manifest, signed bundle, production readiness, and human attestations.
6. Return decision, selected scope and rationale, blockers, trends, deep-gate results, evidence references, residual risk, and accountable next owner.

Keep release sign-off human. Exact-byte visual drift detects change; it does not judge perceptual acceptability.
