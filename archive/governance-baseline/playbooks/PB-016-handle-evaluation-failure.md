# PB-016: Handle an Evaluation Failure

1. Preserve the original attempt, versions, environment, evidence, and cleanup status.
2. Classify the outcome as subject, evaluator, infrastructure, invalid test, policy denial, or indeterminate.
3. Stop immediately for critical security, authority, Workspace, destructive-action, or evidence-integrity failure.
4. Reproduce through deterministic or replay adapters where possible; do not delete unfavorable trials or retry selectively.
5. Trace the cause to requirement, Skill, Agent, Prompt, Tool, adapter, rule, knowledge, dataset, oracle/Judge, policy, or environment.
6. Fix the authoritative artifact first, then downstream implementations and tests according to change-impact governance.
7. Add or update a regression case without exposing hidden holdouts to the subject.
8. Re-run affected and mandatory critical suites. Record unresolved uncertainty and any time-limited override without changing failed evidence.

