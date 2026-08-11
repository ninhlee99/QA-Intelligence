---
status: proposal — not governed, not a SPEC
last_updated: 2026-08-11
---

# QA Intelligence — Implementation Roadmap

Working plan across sessions. Not an accepted ADR or SPEC. Each phase produces real accepted artifacts when it lands — this file sequences the work.

---

## Goal

Install this MCP into any host (Claude Code, Cursor, Codex), point it at a real product + spec, and get:
- UI discovery (no hand-holding the AI through the page first)
- Risk-based test design (positive/negative/boundary/adversarial variants)
- Real execution with evidence (screenshots, traces)
- Structured defect drafts (no fabricated root cause)
- Release gate (explicit recommendation, not pass-count cheerleading)
- Coverage gaps (explicit — never silent)

---

## Current state (`0.1.0-dev`, as of 2026-08-11)

The full expert QA loop is implemented end-to-end:

| Capability | Status |
|-----------|--------|
| UI discovery (single page, multi-page, dual-role) | ✅ Done |
| Risk-based test generation (4 variant types) | ✅ Done |
| Playwright execution (flake-aware, screenshots, traces) | ✅ Done |
| API contract testing | ✅ Done |
| Defect drafting with evidence | ✅ Done |
| Release gate | ✅ Done |
| Coverage gap reporting | ✅ Done |
| Smart retest suggestions | ✅ Done |
| Durable learning (hints, candidates, occurrences) | ✅ Done |
| Visual/surface baselines | ✅ Done |
| Document quality assessors (7 types) | ✅ Done |
| Multi-host Skills (Claude Code, Cursor, Codex) | ✅ Done |
| Remote HTTP transport with real OIDC tokens | ✅ Done (dev-only) |
| Production OIDC IdP (ADR-014) | ❌ Not built |
| Vault/KMS credential store | ❌ Not built |
| Full WCAG audit, load test, pen-test | ❌ Out of scope |
| GOV-012 G2–G6 production gates | ❌ Pending |

---

## Phase history

### Phase 1 — UI Discovery ✅
`discover_ui_surface` — live Semantic UI Map from any URL. Named fields, actions, accessible names.
No raw selectors. Same semantic layer used by test generation.

### Phase 2 — Interaction ✅
`PlaywrightExecutionEngine` with semantic `type` / `click` / `select` / `wait_for`.
Multi-step plans. URL/title/network oracles. Login via credential registry (no passwords over MCP wire).

### Phase 3 — Test Design → Execution ✅
`generate_test_cases` — positive / negative / boundary / adversarial variants from AC + discovered UI.
Adversarial variants catch real XSS/SQLi bugs that positive-only testing misses.
`run_auto_qa` — single call closes the full requirement→evidence loop.

### Phase 4 — Defects + Release Gate ✅
`draft_defects_from_qa_run` — governed defect drafts from failures. Severity keyed by variant type.
`release_recommendation` — explicit gate; critical/security outcomes never hidden by green counts.
Residual risk notes. Variant coverage matrix.

### Phase 5 — Senior QA MCP Surface ✅
`assess_ui_accessibility_smoke` — naming smoke (unlabeled/duplicate names). Not WCAG.
`generate_exploratory_charter` — time-boxed charter from a surface.
`assess_defect_quality` — defect document quality review.
Session Memory: `avoid:*` hints retained after draft defects.

### Phase 6 — Credential & Environment Registry ✅
`register_workspace_secret` / `password_secret_ref` — secrets never appear in MCP wire after registration.
`register_workspace_environment` — non-loopback URL allowlist.
SSO/MFA wait path on `discover_ui_surface_after_login`.

### Phase 7 — Document Quality Assessors ✅
Seven `assess_*_quality` tools: BA, risk, strategy, test case, dataset, automation asset, report.
Heuristic generate stubs for BA/risk/strategy (not professional documents).
`register_test_dataset` + `resolve_test_dataset_fields`. `create_automation_asset`.

### Phase 8 — API Testing ✅
`generate_api_smoke_from_openapi` + `execute_api_smoke`.
OpenAPI → smoke cases with optional authz negatives (`include_authz_negatives: true`).
Infrastructure faults → `infrastructure_error`, never product `failed`.

### Phase 9 — Exploratory + Multi-browser ✅
`execute_exploratory_session` — bounded live probes, auto-check oracles, `manual_follow_up` signal.
`browser` param: `chromium` | `firefox` | `webkit`.

### Phase 10 — Depth Portfolio ✅
`run_depth_smokes` — WCAG-subset (lang/title/img alt), perf threshold, security heuristics.
`has_critical` flag never hidden by green counts.

### Phase 11 — Learning Read-side ✅
`list_failure_avoidance_hints` — `avoid:*` Session Memory read.
`prior_failure_avoidance_hints` injected into `run_auto_qa` output.
One shared `SessionMemory` across all MCP tools in a process.

### Expert QA Upgrade ✅ (2026-08-11)
See `CHANGELOG.md` for full details. Key additions:
- `coverage_gaps` + `smart_retest_suggestion` in `run_auto_qa` output
- Trace `.zip` links in HTML reports
- `network_hints` cross-run persistence
- `quality_warnings` pre-export gate on defects
- Cursor + Codex Skills
- Rewrote SKILL.md files to risk-first triage

### Visual & Durable Learning ✅ (2026-08-10)
Visual baselines (PNG hash+dims), surface baselines (named-control drift).
All learning state durable across MCP restart: avoidance hints, candidates, occurrences.
Playwright fail-only traces.

---

## What's next (production path)

1. **GOV-012 G2–G4** — security review, isolation evidence, authorization conformance
2. **ADR-014** — real OIDC IdP integration (replaces self-minted dev tokens)
3. **GOV-012 G5–G6** — operational runtime evidence, public release gate
4. **Vault/KMS** — production secret store (replaces in-process credential registry)

Each phase above has a dependency on the previous. None can be claimed without independent evidence and Repository Owner sign-off (SPEC-007 §15).

---

## Architecture constraints (always apply)

- Agents execute governed QA capabilities; Skills are reusable procedures; Plugins are technology adapters.
- Deterministic rules before LLM reasoning (ADR-002).
- No fabricated passes. No invented root cause. No silent AC drops.
- Every tool registration goes through `CompositeAgentRunExecutor` keyed by agent `id`.
- Production enablement blocked on GOV-012 regardless of dev-slice completeness (ADR-016 §8).
