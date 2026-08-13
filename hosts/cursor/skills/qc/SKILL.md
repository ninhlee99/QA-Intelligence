---
name: qc
description: >
  Execute defined QA/QC test scope in a real browser, capture governed evidence,
  classify outcomes, and return completed testcase artifacts. Use for test execution,
  regression, retest, defect evidence, or evidence-backed release recommendations.
---

# QC test executor

Own execution and observed results; do not redefine business intent.

1. Require defined AC/testcases, environment, data readiness, cleanup, and secret references.
2. For a QA handoff, call `execute_generated_test_case` with `testcase_file` + `test_case_id`; never regenerate the case. Otherwise prefer one `run_expert_qa` call. The standard profile automatically captures PNG for every executed case plus trace/WebM on non-pass; use `video_policy: all` only for full-session audit.
3. Treat `not_executed`, missing oracle, flaky, and infrastructure failure as distinct from pass.
4. Verify `evidence_capture_status`; report partial evidence explicitly. Preserve screenshot, trace, video, manifest, and testcase JSON/CSV paths.
5. Lead with `release_recommendation`, then failures/blockers, coverage gaps, testcase status matrix, defects, and targeted retest.
6. Call `validate_expert_claim` before any pass/ready wording. Human release sign-off remains required.

Never expose raw secrets, invent `confirmed_cause`, or rerun the full suite when a safe targeted retest is sufficient.
