# Changelog

## Unreleased

### Added

- Foundation specifications SPEC-001–007
- Governance documents GOV-001–012
- Architecture decisions ADR-001–015, including the approved technology and tracer-bullet baseline
- Knowledge specifications SPEC-101–107
- Product specifications SPEC-201–213
- Architecture specifications SPEC-301–310
- Component specifications SPEC-401–411
- Interface specifications SPEC-501–511
- Runtime specifications SPEC-601–607
- Machine-readable meta indexes and repository graph
- Draft ontology, schemas, deterministic rule sets, and validated examples
- Governance playbooks, templates, reference catalogs, and AI engineering instructions
- Agent and Skill knowledge, product, architecture, contract, component, and runtime specifications
- Agent/Skill evaluation schemas, examples, lifecycle ontology, specialized quality gates, and delivery playbooks
- Draft implementation ADRs for Node/TypeScript, PostgreSQL/outbox, modular deployment, OIDC authorization, and the Requirement Review tracer bullet
- Tracer-bullet review records, change-impact evidence, adapter conformance plan, deterministic fixtures, strict Ajv validation, and CI workflow

### Corrected

- Changed downstream specifications from `accepted` to `draft` pending formal review
- Reversed interface/component dependencies to contract-first direction
- Repaired invalid YAML front matter in six accepted artifacts
- Corrected Reading Order to Ontology before Schema and Interfaces before Components
- Replaced premature completion claims with explicit readiness states
- Closed the Agent/Skill implementation-readiness gap without changing Knowledge Store authority, deterministic-first reasoning, Workspace isolation, Plugin boundaries, or controlled learning
- Corrected schema structures exposed by strict Draft 2020-12 compilation
- Clarified and approved the comprehensive QA/QC and Senior Test Engineer product identity; the first tracer bullet cannot narrow the roadmap

### Accepted

- ADR-011 TypeScript and Node.js runtime baseline
- ADR-012 PostgreSQL persistence and transactional outbox baseline
- ADR-013 modular monolith and worker deployment baseline
- ADR-014 OIDC identity and internal authorization baseline
- ADR-015 Requirement Review Agent initial tracer bullet
