# Changelog

## Unreleased

### Added

- Network oracle in UI runs: Playwright captures xhr/fetch; `expected_network` on generated assertions couples submit→API in one plan
- Expert follow-up slices: skills aligned to catalog; journey generator; disk-backed regression suites; OpenAPI authz negatives
- Pro-tester capability slices: requirement ingest, multi-page workflow discovery, regression suites, OpenAPI→API smoke, defect tracker export, UI surface compare, URL/title oracles
- SPEC gap thin slices: Workspace environment allowlist (`register_workspace_environment` / `list_workspace_environments`), BA/Risk/Strategy generate stubs, TestDataset registry, AutomationAsset create stub, SPEC-213 dogfood MCP, SPEC-105 raise-mistake-recurrence MCP, Playwright `select`/`wait_for` steps
- MCP catalog completion for remaining assessors/discovery: `discover_product_context`, `assess_execution_record_quality`, `draft_defects_from_qa_run`
- `compactMcpInput` helper; credential registry authorize (`credential:register` / `credential:read`)
- Tool catalog smoke test (`tests/mcp/tool-catalog.smoke.test.ts`)
- `npm run release:check` (= full `validate`) for release-like gate
- MCP Senior QA catalog (dev): discover UI, generate/execute variants, `run_auto_qa` with a11y naming smoke + draft defects + release gate, exploratory charter, defect quality assess (`src/mcp/dev-fixture.ts`, hosts Skills `dev`/`test`)
- `npm run mcp:dev` / `npm run mcp:remote` entry scripts
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

### Changed

- `execute_generated_test_case` now shares `ExecuteBrowserTest` flake-detection + screenshot path with `run_auto_qa`
- Host plugin descriptions and `docs/GUIDE.md` updated for the multi-tool MCP catalog (no longer "one tool only")

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
