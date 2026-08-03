# QA Intelligence Roadmap

## Documentation Baseline

```text
Foundation                  accepted
Governance                  GOV-001–012 accepted
Architecture Decisions      ADR-001–015 accepted
Knowledge Specifications    SPEC-101–107 accepted
Product Specifications      SPEC-201–213 accepted
Architecture Specifications SPEC-301–310 accepted
Interface Specifications    SPEC-501–511 accepted
Component Specifications    SPEC-401–411 accepted
Runtime Specifications      SPEC-601–607 accepted
Meta and indexes             accepted and validated
Ontology and schemas         accepted and validated
Rules and reference          accepted baseline
Playbooks and AI guidance    accepted baseline
```

## Current Phase — Requirement Review Tracer-Bullet Implementation

The documentation baseline has passed ownership, semantic alignment, dependency, traceability, schema, example, lifecycle, and governance review. Implementation may now begin with the selected advisory tracer bullet; source code remains subordinate to accepted contracts.

Specification acceptance is not implementation conformance or release approval. The Agent/Skill must produce and pass GOV-012 gate evidence at the required stage.

## Recommended First Tracer Bullet

Start with the advisory `Requirement Review Agent` and its `Assess Requirement Quality` Skill because it exercises Discovery, deterministic rules before LLM reasoning, governed knowledge retrieval, evidence, uncertainty, evaluation, and Workspace isolation without production write side effects.

The slice is ready to implement because specifications and contracts are accepted, examples validate, and the deterministic fake/replay adapter plan and fixtures exist. Implement deterministic adapters first, then production adapters through the same contracts. G1–G4 must pass before enablement beyond development.

## Implementation Sequence

Implement the vertical slice in this order:

1. create contract and state-machine tests from SPEC-508–511 and SPEC-606–607
2. implement deterministic fake/replay adapters and make failure, cancellation, budget, and isolation cases pass
3. implement the deep core modules for requirement assessment, Agent execution, and evaluation without provider SDK leakage
4. add PostgreSQL/outbox persistence and OIDC/internal authorization through accepted interfaces
5. add production provider, Tool, and repository adapters and run the same conformance suites
6. produce and approve GOV-012 G1–G4 evidence before enabling the Agent or Skill beyond development
7. run regression, canary, monitoring, rollback, and operational validation for G5–G6 before release

Required next actions:

- preserve the comprehensive QA/QC scope; the tracer bullet validates architecture, not the final breadth of the platform
- keep manual, exploratory, deterministic, automated, adversarial, and non-functional testing available according to risk
- retain exact versions, evidence, uncertainty, failure attribution, and Workspace context in every run
- reject shortcuts that place business rules in prompts, provider behavior in core modules, or observations directly in accepted knowledge

Source code SHALL remain subordinate to the accepted specifications.
