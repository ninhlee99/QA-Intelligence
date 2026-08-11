# Expert Tester Workflow (canonical) — Expert level

Shared by `/qa-intelligence:test` and `/qa-intelligence:dev`.

**Two commands only.** Environment = **URL** user passes (loopback → local; else staging hygiene).

MCP `qa-intelligence` = evidence. Skills = Expert discipline.  
**Human remains accountable** for release sign-off, pen-test, and novel domain risk.

---

## Expert bar (refuse to “pass” without these)

Agent **MUST NOT** say ready / ship / all good / pass unless **all** true:

1. MCP `expert_checklist.claim_pass_allowed === true`
2. MCP `validate_expert_claim` returned `allowed: true` for the exact user-facing wording
3. `release_recommendation` quoted from MCP (not invented)
4. `coverage_gaps` stated — including scope NOT covered
5. Retest plan: follow `smart_retest_suggestion` / `expert_checklist.host_actions`
6. Domain pack present with high-risk stubs confirmed (or absence acknowledged as gap — still not pass)
7. E2 smells (roles/API/money/journey) exercised or listed as blockers — no silent skip
8. `expert_observations` reviewed like a human session close-out

If `claim_pass_allowed` is **false** → status = **blocked / incomplete** — list `expert_checklist.blockers`. Never green-wash.  
Even when true → **human release_signoff** still required.

---

## Commands

| Command | Who | AC source |
|---------|-----|-----------|
| `/qa-intelligence:test` | Tester | Spec / ticket / stated behavior |
| `/qa-intelligence:dev` | Dev | Prefer **source**; else ticket |

---

## Environment from URL

| URL | Treat as | G1 |
|-----|----------|-----|
| localhost / 127.0.0.1 | local | Env register optional |
| Other http(s) | staging/shared | `register_workspace_environment` + confirm before write-ish login |
| Missing | Ask | Do not guess |

---

## Non-negotiables

1. No fabricated pass  
2. No invented `confirmed_cause`  
3. Unbound / `not_executed` ≠ pass  
4. Secrets only via `*_secret_ref`  
5. No `execute_browser_test` on real targets  
6. Gate → critical → gaps → artifacts (never pass-count first)  
7. Targeted retest over full-suite re-run  
8. Domain pack risks (money / permission / migration) never waived silently  

`RULES.md` is binding.

---

## Gates G0→G8 (Expert)

| Gate | Pass when |
|------|-----------|
| **G0** Assess | 5 risk questions + **learning hints** + **domain pack** (if present) |
| **G0d** Domain | Pack read; money/permission/legacy risks listed or “pack absent” |
| **G1** Env | URL + env/secrets |
| **G2** Discover | Live MCP discover |
| **G3** Bind AC | Bound or unbound listed — never invent AC |
| **G4** Execute | A/B/C via MCP; E2 mandates below |
| **G5** Gate | `release_recommendation` **first line** of result |
| **G6** Gaps | MCP `coverage_gaps` + domain risks not exercised |
| **G7** Artifacts | report, **suite_id**, defects, traces |
| **G8** Next | Targeted retest plan or export or “no retest needed” |

---

## G0 — Assess (mandatory questions)

1. New feature or regression?  
2. API? OpenAPI path?  
3. Multiple roles?  
4. Session-gated?  
5. Desired output: gate / defects / retest / baseline?

### G0 learning (E4) — before G4

Call when MCP available:

- `list_failure_avoidance_hints`  
- `list_learning_candidates` (if tool present)  

State: prior avoid hints count + whether they apply to this URL/AC.  
Do **not** treat hints as confirmed cause.

### G0d — Domain pack (auto bootstrap)

See `hosts/references/domain-pack.md`.

1. Resolve product workspace root (app under test)
2. Call MCP `bootstrap_domain_pack` with absolute `product_root` + `request_context` (URL/AC/ticket). Prefer tool over manual file copy.
3. Read returned `pack_path`; high-risk tags (`money` | `permission` | `legacy` | `pii`) must appear in G6 as tested or not tested
4. Ambiguous money/permission TODOs → one short confirm; record as gap if unanswered

Output field: `Domain pack: created | loaded | updated (<path>); risks: …`

---

## E2 mandates at G4 (when applicable)

| Signal | MUST |
|--------|------|
| ≥2 roles matter | Prefer `run_auto_qa` with `role_b` (auto role compare in `expert_extensions`) **or** `discover_and_compare_role_ui_surfaces` — authz gaps in G6 |
| OpenAPI / HTTP API in scope | Prefer `run_auto_qa` with `openapi`/`openapi_path` + `include_authz_negatives: true` — capped subset **executes in same Expert pass** (`execute_extension_cases` default true; optional `api_base_url`) |
| Multi-page journey | Prefer `run_auto_qa` with `include_workflow_journeys: true` — capped journey subset executes same pass |
| AC has submit→API | Prefer `expected_network` on AC / assertion |
| UI layout regression concern | `compare_ui_baseline` and/or `compare_ui_surface_to_baseline` |
| Security-sensitive surface | Consider `run_depth_smokes`; never claim pen-test |
| Code change in product_root | Read `git_blast_radius` in output — aim retest; filenames ≠ oracles |
| Vague / oracle-less AC | Read `ac_quality_review` — push back; high findings block pass |

Skip only with explicit reason in G6.

---

## Strategies

### A — Full pipeline

```
G0 + learning hints
→ run_expert_qa(product_root, url, AC, [role_b|openapi|journeys])
   # OR: bootstrap_domain_pack → run_auto_qa
→ use auto_registered_suite.suite_id + flake_taxonomy + learning
→ [optional] capture baselines first time
```

### B — Targeted retest

```
list_failure_avoidance_hints (quick)
→ list_regression_suites
→ run_regression_suite with case_ids | related_defect_ids
→ optional baselines
→ G5–G8
```

Default after fix: use prior `smart_retest_suggestion` — **do not** full suite unless AC changed.

### C — Exploratory → close the loop (E4)

```
discover → generate_exploratory_charter → execute_exploratory_session
→ list AC candidates + manual_follow_up
→ STOP for human confirm on AC
→ Strategy A (run_auto_qa → suite_id)
```

**Forbidden:** end at exploratory observations and claim “tested”. Expert closes loop into AC + suite.

---

## Retest matrix (G8)

| Intent | MCP |
|--------|-----|
| Cases | `run_regression_suite` + `case_ids` |
| Defects | `related_defect_ids: ["DEF-DRAFT:…"]` |
| One screen | suite for screen **or** `run_auto_qa` that URL only |
| One case object | `execute_generated_test_case` |

Always report: retested set + **not** retested (residual).

---

## Output contract (mandatory shape)

```markdown
## Expert QA result
- Command: test | dev
- Environment: local | staging | <name>
- Target URL: …
- Strategy: A | B | C
- Domain pack: absent | loaded (<paths>); risks considered: …
- Prior learning hints: n (applied: … / none)
- release_recommendation: …          # FIRST verdict field
- Rationale: …
- Critical / security / authz: …
- Coverage gaps: …                   # from MCP + domain not tested
- Retest plan: case_ids […] | defects […] | screen … | none (why)
- suite_id: … | missing (why)
- Artifacts: report_path, traces
- Human still required for: release sign-off | pen-test | novel domain
- NOT claimed: full WCAG / load / pen-test (unless run)
```

**Incomplete run** if `release_recommendation` or `coverage_gaps` or retest plan missing.

---

## Tool map

| Purpose | Tool |
|---------|------|
| Full run | `run_auto_qa` |
| Retest | `run_regression_suite` / `execute_generated_test_case` |
| Suite | `register_regression_suite` / `list_regression_suites` |
| Discover / roles | `discover_ui_surface*` / `discover_and_compare_role_ui_surfaces` |
| API | `generate_api_smoke_from_openapi` / `execute_api_smoke` |
| Learning | `list_failure_avoidance_hints` / `list_learning_candidates` |
| Explore | `generate_exploratory_charter` / `execute_exploratory_session` |
| Export | `export_defects_for_tracker` |
| Depth | `run_depth_smokes` |
