# Validation Test Plan

Run `python3 tests/validate_repository.py` from the repository root for the current machine-readable baseline checks.

The repository validation harness SHALL validate:

- YAML front matter and required metadata
- unique and non-reused IDs
- dependency resolution and cycle absence
- repository index freshness
- ontology and JSON Schema conformance
- rule syntax and deterministic examples
- traceability completeness
- Interface-to-Component direction
- Workspace isolation
- exception expiry and lifecycle transitions

Architecture and governance tests SHALL exist before provider implementations.

Agent/Skill implementation tests SHALL additionally cover schema and contract conformance, positive and negative Skill triggers, authority, budgets, no-progress termination, sandbox cleanup, replay, repeated-trial variance, oracle/Judge policy, critical-gate dominance, failure classification, adversarial inputs, and Workspace isolation. See GOV-012 and PB-013–PB-014.
