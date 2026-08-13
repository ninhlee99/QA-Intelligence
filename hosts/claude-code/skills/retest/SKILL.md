---
name: retest
description: >
  Select and execute the smallest safe regression or defect-retest scope from a
  retained suite. Use after fixes, code changes, flaky outcomes, or when targeted
  confidence is preferable to rerunning an entire suite.
---

# Regression and retest

1. Start from suite id, changed behavior, defects, risk matrix, and prior outcomes.
2. Prefer `run_regression_suite` with exact `case_ids` or `related_defect_ids`; run the full suite only when blast radius or shared-state risk justifies it.
3. Preserve the prior result and identify this run as retest/regression; never overwrite failed evidence.
4. Reconcile fixed, still failing, regressed, flaky, blocked, and not-executed separately.
5. Return selected scope and rationale, status delta, new evidence, residual risks, and next action.

Do not claim unaffected coverage outside the selected scope.
