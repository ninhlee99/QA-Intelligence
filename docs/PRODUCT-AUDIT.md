# QA Intelligence — Product and capability audit

Reviewed: 2026-08-13. Scope: public MCP catalog, host skills, command UX,
browser execution, evidence, reporting, recovery, benchmarks, and operator docs.

## Decision

`run_expert_qa` is the only public full-pipeline tool. `run_auto_qa` remains an
internal implementation seam and is intentionally absent from MCP discovery.
This removes a duplicate interface while retaining the tested pipeline.

Daily operating model:

1. Full feature or screen: `run_expert_qa`.
2. Defined suite/retest: `run_regression_suite`.
3. Exact QA handoff case: `execute_generated_test_case`.
4. Before pass/ready/ship wording: `validate_expert_claim`.
5. Use specialist tools only when the task explicitly stops at discovery,
   design, document review, API smoke, exploratory testing, or administration.

## Product maturity

| Area | Score | Assessment |
|---|---:|---|
| Browser interaction | 8.5/10 | Real Playwright, semantic targets, iframe, popup, upload/download, sessions, three browsers |
| Test design and oracles | 8/10 | Traceable variants and bounded oracles; still dependent on strong AC |
| Evidence and reporting | 8/10 | PNG, WebM, safe trace policy, manifest, JSON/CSV and HTML on full runs |
| QA/QC workflow | 8.5/10 | Clear prevention, execution, retest, triage, exploratory and lead roles |
| Defined-suite execution | 6/10 | Executes suites, but still needs standard evidence/export/checkpoint parity |
| Token efficiency | 7/10 | Default production profile exposes 14 daily tools; provider token telemetry is still missing |
| Product UX | 7.5/10 | One canonical full run, publishable command and validated four-host configs |
| Production operations | 6/10 | Local entrypoint fails closed; remote security, monitoring, rollback, owner and canary attestations remain absent |

## Commands and host UX

| Command or trigger | Rating | Decision | Notes |
|---|---:|---|---|
| `/qa-intelligence:test` / test skill | 8/10 | Keep | Best user-facing workflow for URL + AC. Invocation syntax is host-dependent. |
| `/qa-intelligence:dev` / dev skill | 7.5/10 | Keep | Useful before push; must derive observable AC from source and use the same Expert gate. |

The repository contains skill packages, not one portable command implementation
shared by every host. Documentation must describe these as host-dependent skill
shortcuts and always provide the natural-language fallback.

## Skill audit

| Skill | Rating | Decision | Professional scope |
|---|---:|---|---|
| `test` | 8.5/10 | Keep canonical | One `run_expert_qa`, headed browser, compact result, claim validation |
| `dev` | 8/10 | Keep | Source/diff to observable AC, same quality bar as tester |
| `testcase` | 8.5/10 | Keep | Stable IDs, traceable design artifact, no fabricated execution |
| `qa` | 8/10 | Keep | Requirement, risk, strategy and coverage prevention |
| `qc` | 8/10 | Improve suite parity | Defined-case execution, evidence completeness and verdict |
| `retest` | 8/10 | Keep | Smallest safe scope based on suite, defect and blast radius |
| `defect-triage` | 8/10 | Keep | Separates product, infrastructure and flake; no invented root cause |
| `exploratory` | 7.5/10 | Keep assisted | Bounded charters and observations; human judgment remains necessary |
| `qa-lead` | 7.5/10 | Keep assisted | Continuous QA and release evidence; needs real production telemetry |

The skill split is professional: each skill owns one job and explicitly states
what it must not claim. Codex, Cursor and Claude Code packages should continue to
share the same behavioural contract, with host files differing only in invocation details.

## MCP tool audit

Ratings describe production usefulness, not test coverage.

### Canonical execution and governance

| Tool | Rating | Decision | Assessment |
|---|---:|---|---|
| `run_expert_qa` | 8.5/10 | Canonical | Deep public module for domain context, discover, design, execute, evidence and report |
| `validate_expert_claim` | 9/10 | Keep mandatory | Strong anti-green-wash gate |
| `run_regression_suite` | 6/10 | P0 improve | Needs standard video/screenshot policy, manifest, JSON/CSV and checkpoint resume |
| `execute_generated_test_case` | 7/10 | Improve | Good exact-case handoff; single-case only and cleanup reporting needs parity |
| `manage_evidence_lifecycle` | 8/10 | Keep | Governed preview/purge, legal hold and root confinement |
| `assess_continuous_qa` | 7/10 | Keep specialist | Useful deterministic selection/trend gate; requires measured history |
| `assess_deep_testing` | 6.5/10 | Keep specialist | Honest analysis of supplied observations, not a measurement engine |

### Discovery

| Tool | Rating | Decision | Assessment |
|---|---:|---|---|
| `discover_ui_surface` | 8/10 | Keep specialist | Strong semantic one-page map |
| `discover_ui_surface_after_login` | 8/10 | Keep specialist | Useful authenticated discovery; secrets should remain refs |
| `discover_ui_workflow` | 7.5/10 | Keep specialist | Multi-page edges and network hints; bounded rather than exhaustive |
| `discover_and_compare_role_ui_surfaces` | 7.5/10 | Keep specialist | Good UI authorization observation, not server-side authorization proof |
| `compare_ui_surfaces` | 7/10 | Keep | Deterministic named-control diff |
| `discover_product_context` | 6.5/10 | Keep admin/specialist | Only as good as retained governed knowledge |

### Test design and browser execution

| Tool | Rating | Decision | Assessment |
|---|---:|---|---|
| `generate_test_cases` | 8/10 | Keep | Traceable variants and artifact digest; no invented AC |
| `generate_journey_test_cases` | 7/10 | Keep specialist | Useful observed-flow conversion, not business-intent authority |
| `generate_exploratory_charter` | 7.5/10 | Keep | Bounded risk charter |
| `execute_exploratory_session` | 7/10 | Keep assisted | Live bounded probes; findings require judgment |
| `run_depth_smokes` | 6.5/10 | Keep specialist | Smoke only; correctly avoids certification claims |
| `execute_browser_test` | 3/10 | Hide from default | Seeded demo tool, not a real-target product interface |

### API, defects and reporting

| Tool | Rating | Decision | Assessment |
|---|---:|---|---|
| `generate_api_smoke_from_openapi` | 7/10 | Keep specialist | Safe documented-status generation, intentionally shallow bodies |
| `execute_api_smoke` | 7.5/10 | Keep specialist | Clear product-vs-infrastructure outcomes and secret refs |
| `draft_defects_from_qa_run` | 8/10 | Keep | Evidence-backed draft, suspected cause only |
| `assess_defect_quality` | 8/10 | Keep | Good completeness/cause governance |
| `export_defects_for_tracker` | 7.5/10 | Keep | Paste-ready text and evidence packs |
| `file_defects_to_tracker` | 7/10 | Keep gated | Dry-run default and explicit live confirmation are appropriate |
| `assess_ui_accessibility_smoke` | 7/10 | Keep specialist | Naming smoke, correctly not WCAG certification |

### Quality assessors

| Tool | Rating | Decision |
|---|---:|---|
| `assess_requirement_quality` | 8/10 | Keep |
| `assess_business_analysis_quality` | 7/10 | Keep specialist |
| `assess_risk_quality` | 7.5/10 | Keep specialist |
| `assess_test_strategy_quality` | 7.5/10 | Keep specialist |
| `assess_test_case_quality` | 8/10 | Keep |
| `assess_test_dataset_quality` | 7.5/10 | Keep specialist |
| `assess_automation_asset_quality` | 7/10 | Keep specialist |
| `assess_report_quality` | 7.5/10 | Keep specialist |
| `assess_execution_record_quality` | 7.5/10 | Keep specialist |

These are professional contract reviewers, not substitutes for executing the
subject under review. Their names and docs should retain that distinction.

### Registries, credentials and data

| Tool | Rating | Decision |
|---|---:|---|
| `register_workspace_secret` / `list_workspace_secrets` | 8/10 | Keep admin |
| `register_workspace_environment` / `list_workspace_environments` | 8/10 | Keep admin |
| `register_requirement` / `list_requirements` | 7/10 | Keep admin |
| `register_test_dataset` / `list_test_datasets` / `resolve_test_dataset_fields` | 7.5/10 | Keep admin |
| `register_regression_suite` / `list_regression_suites` | 7.5/10 | Keep; auto-registration should remain the default |
| `register_knowledge_record` | 6.5/10 | Keep admin with provenance warning |
| `create_automation_asset` | 6/10 | Keep specialist; currently an asset stub |
| `bootstrap_domain_pack` | 7.5/10 | Keep specialist/admin; normally hidden behind `run_expert_qa` |
| `set_user_preference` / `get_user_preference` | 7/10 | Keep admin |

### Baseline and learning

| Tool | Rating | Decision |
|---|---:|---|
| `capture_ui_baseline` / `compare_ui_baseline` | 6/10 | Keep specialist; exact bytes are not perceptual approval |
| `register_ui_surface_baseline` / `compare_ui_surface_to_baseline` | 7/10 | Keep specialist |
| `list_failure_avoidance_hints` | 7.5/10 | Keep; canonical full run now feeds it |
| `raise_mistake_recurrence_candidate` / `list_learning_candidates` | 7/10 | Keep governed; never auto-promote |

### Stubs and evaluation utilities

| Tool | Rating | Decision |
|---|---:|---|
| `generate_business_analysis_stub` | 5/10 | Hide from default product profile |
| `generate_risk_stub` | 5/10 | Hide from default product profile |
| `generate_test_strategy_stub` | 5/10 | Hide from default product profile |
| `evaluate_test_case_quality_skill` | 4/10 | Internal/evaluation profile only |

## Documentation audit

| Document | Rating | Finding |
|---|---:|---|
| `README.md` | 7.5/10 | Clear value and honest dev status; quick start still assumes local source install |
| `docs/PRODUCT.md` | 8/10 | Good one-page positioning and explicit human accountability |
| `docs/GUIDE.md` | 7/10 | Thorough but long; needs a five-minute path before reference material |
| `hosts/README.md` | 7.5/10 | Strong catalog; too much for a first-time operator without profiles |
| `hosts/references/expert-tester-workflow.md` | 8.5/10 | Professional gates and refusal rules; should remain canonical workflow |
| skill `SKILL.md` files | 8/10 | Narrow role ownership and compact handoffs; host variants need automated parity checks |
| `RULES.md` | 8.5/10 | Strong product honesty and safety posture |
| `docs/plans/*` | 6/10 as user docs | Useful history, but should not be treated as current operating instructions |

## Adoption and operational feasibility

Strengths:

- Local-first, no SaaS dependency for the primary workflow.
- Real browser and file evidence make outcomes inspectable.
- Explicit human accountability is suitable for professional teams.
- Targeted retest and compact artifacts reduce repeated context.
- Three host packages improve reach.

Adoption blockers:

- The optional `full` profile remains large and should be enabled only for specialist work.
- Source installation still requires Node and browser binaries until the package is published.
- No container installer or configuration wizard.
- Defined-suite execution lacks full-run evidence/export/recovery parity.
- Production readiness and release candidate gates currently fail.
- The 90% score is an internal capability benchmark, not an external blind benchmark.

## Recommended product profiles

1. **Default Expert profile:** expose canonical execution, claim validation,
   regression, exact-case execution, secrets/environments, and evidence lifecycle.
2. **Specialist profile:** add discovery, design, exploratory, API, defects,
   assessors, baselines and QA lead tools.
3. **Development profile:** add stubs, seeded demo, evaluation and diagnostics.

This preserves capability while lowering tool-schema tokens and choice overload.

## Priority backlog

1. P0: bring `run_regression_suite` to standard evidence, manifest and JSON/CSV parity.
2. P0: integrate resumable checkpoints and failure-aware retry into defined suites.
3. P1: add MCP tool profiles and make Expert the installation default.
4. P1: capture provider token telemetry per operation/testcase.
5. P1: publish a package/container plus config doctor and five-minute smoke path.
6. P1: run blind multi-application benchmarks against a Senior-QA baseline.
7. P1: satisfy security, monitoring, rollback, incident-owner and canary gates.
