# QA Intelligence Roadmap

## Documentation Baseline

```text
Foundation                  accepted
Governance                  GOV-001–012 accepted
Architecture Decisions      ADR-001–016 accepted
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

The documentation baseline has passed ownership, semantic alignment, dependency, traceability, schema, example, lifecycle, and governance review. The selected advisory tracer bullet is now in development: its deterministic core, test adapters, schema validator, evaluation guardrails, in-memory runtime contract, and runtime-owned Requirement Review execution path exist. Source code remains subordinate to accepted contracts.

Specification acceptance is not implementation conformance or release approval. The Agent/Skill must produce and pass GOV-012 gate evidence at the required stage.

## Recommended First Tracer Bullet

Start with the advisory `Requirement Review Agent` and its `Assess Requirement Quality` Skill because it exercises Discovery, deterministic rules before LLM reasoning, governed knowledge retrieval, evidence, uncertainty, evaluation, and Workspace isolation without production write side effects.

The first deterministic development increment is implemented. The SPEC-508 development runtime now executes retained input through the Requirement Review Agent/Skill, validates output, evidence requirements, exact versions, Skill/Tool authority, budgets, and cleanup, and retains the immutable terminal result. The SPEC-511 provider-neutral Interface and scripted deterministic/replay Adapter enforce common envelopes, operation-and-resource-scoped Workspace authorization, canonical request digests, idempotency, strict UTC deadlines, late-result retention, capability declaration, observation-only execution results, and fail-closed cleanup. The Evaluation Campaign Runner now orchestrates one isolated deterministic trial through capability discovery, environment preparation, execution, evidence verification, cleanup, deterministic assertions, and the independent Evaluation Manager verdict. Multi-trial scheduling, retained campaign lifecycle, recovery, Judge orchestration, and production adapters remain pending. G1–G4 must pass before enablement beyond development.

## Implementation Sequence

Implement the vertical slice in this order:

1. **In progress:** create contract and state-machine tests from SPEC-508–511 and SPEC-606–607; SPEC-508 execute/result is complete for the in-memory development slice
2. **In progress:** implement deterministic fake/replay adapters; SPEC-511 common-envelope, authorization, idempotency, deadline, late-result retention, capability, execution-observation, and cleanup cases pass, while cancellation, partial-failure, evidence-integrity, replay-divergence, and full isolation campaigns remain
3. **Completed for the single-trial development slice:** implement deep core modules for requirement assessment, SPEC-511 trial orchestration, evidence verification, cleanup, and independent evaluation verdicts without provider SDK leakage
4. add PostgreSQL/outbox persistence and OIDC/internal authorization through accepted interfaces
5. add production provider, Tool, and repository adapters and run the same conformance suites
6. add the host-neutral MCP facade and thin Codex, Claude Code, and Cursor packages after the relevant core capability passes development conformance
7. produce and approve GOV-012 G1–G4 evidence before enabling the Agent or Skill beyond development
8. run regression, canary, monitoring, rollback, and operational validation for G5–G6 before release

Required next actions:

- preserve the comprehensive QA/QC scope; the tracer bullet validates architecture, not the final breadth of the platform
- keep manual, exploratory, deterministic, automated, adversarial, and non-functional testing available according to risk
- retain exact versions, evidence, uncertainty, failure attribution, and Workspace context in every run
- reject shortcuts that place business rules in prompts, provider behavior in core modules, or observations directly in accepted knowledge

Source code SHALL remain subordinate to the accepted specifications.
