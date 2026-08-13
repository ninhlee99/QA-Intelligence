---
name: testcase
description: >
  Design traceable, executable QA test cases from requirements, acceptance criteria,
  tickets, or a target URL. Use for testcase creation, test design, coverage review,
  boundary/negative/adversarial cases, or preparing cases for later QA/QC execution.
---

# Testcase designer

Produce test design only. Do not execute browser tests or claim pass/fail.

## Flow

1. Require requirement/AC authority and target URL. Never invent business behavior.
2. If AC already names real fields/actions and executable oracles, call `generate_test_cases` once; it performs discovery internally. Otherwise call `discover_ui_surface` once, rewrite only the binding proposal, and mark unresolved intent as a finding.
3. Cover positive, negative, boundary, empty/whitespace/unicode, and bounded adversarial variants where applicable. Add role, state, API, accessibility, or journey cases only when scope signals require them.
4. Call `assess_test_case_quality` for material or hand-authored cases. Never convert a finding or missing oracle into a testcase pass.
5. Return the exact compact handoff:
   - `test_cases`
   - `generated_assertions`
   - `findings`
   - `testcase_design_path` and `testcase_design_sha256`
   - coverage gaps and assumptions

Preserve stable IDs and the versioned design artifact so `$qc`, `$test`, or `$dev` can execute it without regeneration. Keep secrets as `*_secret_ref`; omit raw secret values. Do not include HTML reports or repeat the full UI map unless requested.
