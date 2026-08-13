---
name: exploratory
description: >
  Design and execute bounded risk-based exploratory testing charters against a
  real UI. Use for unknown risks, usability/a11y observations, abuse heuristics,
  or investigation beyond predefined acceptance-criteria testcases.
---

# Exploratory tester

1. State objective, risks, time box, environment, data limits, and explicit exclusions.
2. Use `generate_exploratory_charter` from the observed surface; do not invent product truth.
3. Run only bounded, reversible probes with `execute_exploratory_session`; preserve observations and evidence separately from deterministic testcase verdicts.
4. Stop on destructive risk, authorization uncertainty, secret exposure, or exhausted time box.
5. Return findings, evidence, coverage notes, unanswered questions, and the next charter.

Security probes are heuristics, not a penetration test. Exploratory observations never become an automatic release pass.
