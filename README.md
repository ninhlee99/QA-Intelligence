# QA Intelligence

QA Intelligence is a governed, AI-assisted quality engineering platform designed to act with Senior QA Engineer discipline through semantic knowledge, deterministic rules, bounded Agents and Skills, traceable evidence, Workspace isolation, and controlled learning.

## Start Here

Read in this order:

1. `specs/foundation/SPEC-001-vision.md`
2. `specs/foundation/SPEC-007-repository-governance.md`
3. `governance/ARCHITECTURE_PRINCIPLES.md`
4. `governance/READING_ORDER.md`
5. applicable ADRs and specifications

## Repository Status

Foundation, ADRs, GOV-001 through GOV-012, and all 66 specifications form the accepted documentation and implementation baseline. Family-specific review evidence is retained under `governance/reviews/full-spec-baseline/`.

The machine-readable ontology, schemas, rules, indexes, playbooks, examples, and AI engineering instructions are accepted support artifacts and validate automatically. They remain subordinate to their governing specifications and do not grant implementation or release authority by themselves.

The Agent/Skill creation and evaluation baseline is defined by `SPEC-106`, `SPEC-107`, `SPEC-213`, `SPEC-309`, `SPEC-310`, contracts `SPEC-508`–`SPEC-511`, and `governance/AGENT_SKILL_QUALITY_GATES.md`. These artifacts preserve the original product boundary: Agents execute governed QA capabilities; Skills are reusable procedures; Plugins remain technology adapters; accepted knowledge remains in the Knowledge Store.

The advisory Requirement Review Agent and Assess Requirement Quality Skill now have a deterministic development slice: public contracts, requirement assessment, Workspace authorization, Knowledge Search, reasoning replay, schema validation, evaluation, and an in-memory Agent Runtime. The direct end-to-end composition is explicitly a development harness; production execution must pass through the accepted Agent Runtime and Evaluation Adapter contracts.

This implementation is not enabled or release-ready. GOV-012 G1–G4 still require complete implementation and independent evidence before enablement beyond development; G5–G6 plus operational runtime evidence remain required before release.

See `ROADMAP.md` for the implementation sequence.
