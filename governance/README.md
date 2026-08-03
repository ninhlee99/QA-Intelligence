# Governance

This directory defines how QA Intelligence engineering artifacts are created, owned, related, reviewed, accepted, changed, and retired.

## Canonical Order

1. `ARCHITECTURE_PRINCIPLES.md`
2. `READING_ORDER.md`
3. `DECISION_TREE.md`
4. `DEPENDENCY_MATRIX.md`
5. `OWNERSHIP_MATRIX.md`
6. `TRACEABILITY_MATRIX.md`
7. `CHANGE_IMPACT_MATRIX.md`
8. `REVIEW_CHECKLIST.md`
9. `QUALITY_GATES.md`
10. `ENGINEERING_MATURITY_MODEL.md`
11. `DECISION_GRAPH.md`
12. `AGENT_SKILL_QUALITY_GATES.md` when creating, testing, or releasing an Agent or Skill

## Governing Rule

No downstream artifact is authoritative merely because it exists in the repository.

An artifact becomes authoritative only after:

- required metadata is valid
- accountable ownership is assigned
- dependencies and traceability are complete
- impact analysis is performed
- applicable reviews and quality gates pass
- approval evidence is retained
- lifecycle status is changed through the governed workflow

Draft specifications may guide discussion and implementation planning. They SHALL NOT be treated as approved behavior.

## Machine-Readable Navigation

The `meta/` directory contains derived indexes and the repository graph. When an index conflicts with an authoritative artifact, the authoritative artifact wins and the index SHALL be regenerated.
