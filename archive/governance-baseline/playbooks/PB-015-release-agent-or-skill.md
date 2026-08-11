# PB-015: Release an Agent or Skill

1. Complete change-impact analysis for Agent, Skill, Prompt, model, Tool, adapter, rule, knowledge, dataset, evaluator, policy, and runtime versions.
2. Verify GOV-012 G1–G5 evidence, exact artifact integrity, critical-invariant pass, acceptable variance, and no unresolved blocking uncertainty.
3. Obtain accountable owner approval; high-consequence releases require independent Security and AI Governance approval.
4. Publish immutable version, compatibility and migration notes, rollback version, and evaluation report.
5. Deploy through a bounded canary with quotas, monitoring, alerts, kill switch, incident owner, and rollback triggers.
6. Promote only after operational evidence satisfies the declared gate. Roll back or disable on a critical invariant breach.
7. Route observations to PB-003 as Knowledge Candidates; never modify accepted behavior directly from production feedback.

