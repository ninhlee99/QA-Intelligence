# Expert Tester Workflow (canonical)

Shared by `/qa-intelligence:local`, `:staging`, `:test`, `:dev`.
Role (dev vs tester) only changes **inputs**. Process and honesty rules are identical.

MCP server: `qa-intelligence` must be connected. Evidence steps **call MCP tools** — never invent UI structure, pass/fail, or root cause.

---

## Why this raises QA level

| Layer | What increases |
|-------|----------------|
| This Skill workflow | Consistency, triage discipline, forced coverage honesty, environment hygiene |
| MCP tools | Real discovery, flake-aware execute, traces, deterministic release gate |

Together: higher **process maturity** + higher **evidence quality**. Product coverage still scales with AC quality and chosen strategy — Skill forces you to *state* gaps instead of hiding them.

---

## Non-negotiables (every role, every env)

1. No fabricated pass when `release_recommendation` is not release-friendly.
2. Never set/imply `confirmed_cause` — only `suspected_cause` + evidence.
3. Unbound AC / `not_executed` never count as pass — surface in `coverage_gaps`.
4. Secrets only via `register_workspace_secret` → `*_secret_ref`.
5. Non-loopback URLs need `register_workspace_environment` first.
6. Do **not** use `execute_browser_test` on real targets (DEMO only).
7. Lead with gate → critical defects → coverage gaps → artifacts. Never cheerlead pass-count.

Full list: repo `RULES.md`.

---

## Gates (must complete in order — or state why skipped)

| Gate | Name | Pass criterion |
|------|------|----------------|
| **G0** | Assess | 5 risk questions answered (feature vs regression, API, roles, auth, desired output) |
| **G1** | Environment | Env registered if needed; secrets registered; target URL confirmed |
| **G2** | Discover | Live surface/workflow captured via MCP — not assumed from memory |
| **G3** | Bind AC | Each AC bound to real accessible name **or** listed unbound — never invent AC |
| **G4** | Execute | Chosen strategy run via MCP (`run_auto_qa` / `run_regression_suite` / exploratory) |
| **G5** | Gate read | `release_recommendation` + rationale stated **before** pass counts |
| **G6** | Coverage truth | `coverage_gaps` + what was NOT tested stated explicitly |
| **G7** | Evidence pack | Report path, suite id, defects, traces (if fail) available |
| **G8** | Next action | Smart retest suggestion **or** export defects **or** clear “no retest needed” |

Ship / “ready to merge” / “ready for release” requires **G5–G8** with honest gaps.

---

## G0 — Five questions (always)

1. New feature or regression?
2. API involved? OpenAPI available?
3. Multiple roles / permissions?
4. Session-gated (login)?
5. Desired output: release decision / defects / baseline / all?

Missing critical input → **ask**. Do not guess production password or business intent.

---

## Strategies (G4)

### A — Full pipeline
Use: new screen/AC, or material UI change.

```
register_requirement (if real AC)
→ discover_ui_surface | discover_ui_workflow | after_login
→ [roles] discover_and_compare_role_ui_surfaces
→ run_auto_qa (AC + output_path + requirement_ref)
→ [API] generate_api_smoke_from_openapi → execute_api_smoke
→ register_regression_suite
→ [first time] capture_ui_baseline + register_ui_surface_baseline
```

### B — Regression / retest
Use: fix landed, suite exists.

```
list_regression_suites → run_regression_suite
  (case_ids | related_defect_ids — NOT full suite if subset enough)
→ [UI layout] compare_ui_baseline / compare_ui_surface_to_baseline
→ read release_recommendation (not pass-count)
→ if fail: npx playwright show-trace <.qa-traces/…>
```

### C — Exploratory (weak/no AC)
Use: tester has URL only.

```
discover_ui_workflow → generate_exploratory_charter
→ execute_exploratory_session
→ propose AC candidates → human confirm → Strategy A
```

---

## Environment profiles

| Profile | Typical URL | Extra G1 steps |
|---------|-------------|----------------|
| **local** | `http://127.0.0.1` / `localhost` | Loopback OK without env register; AC may come from source |
| **staging** | non-loopback https | `register_workspace_environment` required; confirm before write-ish login |
| **tester** | any provided | Spec/AC from ticket/doc; no source authority unless given |

Same gates. Different AC provenance and env hygiene.

---

## Output contract (every run — paste this shape)

```markdown
## Expert QA result
- Environment: local | staging | <name>
- Strategy: A full | B regression | C exploratory
- release_recommendation: …
- Rationale: …
- Critical / security: … (or none)
- Coverage gaps: … (from tool + scope limits)
- Smart retest: … (case_ids / related_defect_ids or none)
- Artifacts: report_path, suite_id, traces
- NOT claimed: full WCAG / load / pen-test (unless run_depth_smokes said otherwise)
```

---

## MCP tool map (by purpose)

| Purpose | Tool |
|---------|------|
| Full pipeline | `run_auto_qa` |
| Retest subset | `run_regression_suite` |
| One page map | `discover_ui_surface` |
| Multi-page | `discover_ui_workflow` |
| Roles | `discover_and_compare_role_ui_surfaces` |
| API | `execute_api_smoke` |
| No AC | `generate_exploratory_charter` + `execute_exploratory_session` |
| Visual drift | `compare_ui_baseline` |
| Control drift | `compare_ui_surface_to_baseline` |
| Prior mistakes | `list_failure_avoidance_hints` / `list_learning_candidates` |
| Export bugs | `export_defects_for_tracker` (read `quality_warnings`) |
