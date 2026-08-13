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
| **G2** Discover | Live MCP discover **before** finalizing AC field names |
| **G3** Bind AC | Each AC = **action + input + oracle** bound to discovered `accessible_name` — never invent AC; business-logic-only AC = push back / rewrite |
| **G3.5** Data readiness | Dataset/source assumptions + seed/cleanup + deterministic oracle mapping recorded before execute |
| **G4** Execute | A/B/C via MCP; E2 mandates below; flaky must follow policy |
| **G5** Gate | `release_recommendation` **first line** of result |
| **G6** Gaps | MCP `coverage_gaps` + domain risks not exercised |
| **G7** Artifacts | report, **suite_id**, defects, traces, drift/flake evidence |
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
| ≥2 roles matter | Prefer `run_expert_qa` with `role_b` (auto role compare in `expert_extensions`) **or** `discover_and_compare_role_ui_surfaces` — authz gaps in G6 |
| OpenAPI / HTTP API in scope | Prefer `run_expert_qa` with `openapi`/`openapi_path` + `include_authz_negatives: true` — capped subset **executes in same Expert pass** (`execute_extension_cases` default true; optional `api_base_url`) |
| Multi-page journey | Prefer `run_expert_qa` with `include_workflow_journeys: true` — capped journey subset executes same pass |
| AC has submit→API | Prefer `expected_network` on AC / assertion |
| UI layout regression concern | `compare_ui_baseline` and/or `compare_ui_surface_to_baseline` |
| Security-sensitive surface | Consider `run_depth_smokes`; never claim pen-test |
| Code change in product_root | Read `git_blast_radius` in output — aim retest; filenames ≠ oracles |
| Vague / oracle-less AC | Read `ac_quality_review` + `expert_judgment.oracle_strength` — push back; none-oracle blocks pass |
| End of session | Honor `expert_judgment.stopping` + paste `next_exploratory_charter` when present |
| Residual risk accept | Only via `risk_waives[{risk_id,reason_code,rationale}]` — clears matching blockers |
| Stateful data | `stateful_lifecycle_documented=true` or waive `risk-stateful-data` |
| Depth a11y/perf/security | Auto on money/API smells or git hotspots; force with `include_depth_smokes` |
| OpenAPI authz | `include_authz_negatives:true` — unauth cases preferred in same-pass execute |

Skip only with explicit reason in G6.

---

## G2→G3 — AC-to-action binding (critical)

MCP uses a **real browser** (Playwright). Failures that look like “tool won’t click”
are almost always **AC binding**, not headless vs headed.

**Token:** when using Strategy A (`run_expert_qa`), **do not** call
`discover_ui_surface*` first — the pipeline rediscovers. Discover-first only when
AC has no field/action names yet and you must rewrite before execute.

Set `headed: true` (or MCP env `QA_INTELLIGENCE_HEADED=1`) to open a visible window.
Default is headless (CI-safe).

Two layers:

1. **Discovery** — live page → Semantic UI Map (`accessible_name` / role). Usually fine.
2. **Generation** — AC text → bind field/action + steps (type/click/select) + executable
   oracle. **Will not invent** “so type into keyword then click search” from pure
   business prose (SPEC-207 §6). Unbindable AC → finding / `not_executed`, not a fake pass.

### Mandatory host procedure

1. **If AC already names fields/actions + oracle** → skip extra discover; go to G4.
2. **Else discover first** — `discover_ui_surface` or `discover_ui_surface_after_login`
   (login_* from discovered login labels). Read real field/button names (often JP/EN).
3. **Rewrite each AC** so `statement` **mentions those exact `accessible_name`s** and
   carries at least one oracle:
   - `expected_text` / `expected_url_includes` / `expected_title_includes` /
     `expected_network` / `expected_result_count`
4. **Shape:** action + input + oracle — not “search X or Y returns correct logic”.
5. **Oracle claimability:** if AC lacks executable oracle, mark **not_claimable** and rewrite before pass claim.

Bad:

```text
Search keyword X or Y returns results containing X or Y
```

Good (names from discovery):

```json
{
  "id": "AC-or-1",
  "statement": "Fill field 'キーワード' with 'python or ruby', click '検索'",
  "expected_result_count": { "accessible_role": "listitem", "relation": "gte", "value": 1 }
}
```

### Comparative logic (AND vs OR counts)

No single-run “B ≥ A across two searches” oracle yet. Pattern:

1. Seed/know fixture data (do not rely on random dev DB counts).
2. Two ACs / cases with absolute `expected_result_count` (or note counts from two runs).
3. Host compares (OR count ≥ AND count; not OR ≫ AND via `%or%` false positives).

Standard evidence is automatic: PNG for every executed testcase, trace/WebM for non-pass. Use `video_policy=all` only for complete audit video; override `screenshot_policy` or `video_policy` only with an explicit storage/privacy reason.
`lite_mode=true` only for ad-hoc smoke — never Expert pass claim.

### Claimable vs not-claimable AC examples

Not-claimable:

```text
Search must work correctly for OR and AND logic.
```

Claimable:

```json
{
  "id": "AC-search-logic-1",
  "statement": "Fill 'キーワード' with 'java or sqlite', click '検索'",
  "expected_result_count": { "accessible_role": "listitem", "relation": "gte", "value": 1 }
}
```

---

## Data readiness gate (G3.5)

Before G4, host must record all:

1. Dataset/source reference (fixture id, seeded records, or explicit production-like source disclaimer)
2. Seed strategy (what exists before run)
3. Cleanup/rollback strategy (what state restored after run)
4. Deterministic oracle mapping per AC (which observable signal proves pass/fail)

If any item missing: status = **blocked/incomplete** for pass claim; continue as exploratory/gap report only.

---

## Flake policy (wave 1)

Action taxonomy:

- `retry_once`: one bounded retry for likely transient timing/infra
- `quarantine_case`: repeated flaky case in same causal class
- `block_release`: flaky on critical journey/money/permission/security surfaces

Rules:

1. Flaky critical journey -> never claim pass.
2. Same causal class repeats >= 2 times in same session -> quarantine + remediation task owner.
3. G8 retest plan must name quarantined cases and remaining residual risk.

---

## Drift SOP (baseline/surface)

1. Capture baseline on first stable run for critical screens.
2. Compare baseline on retest runs when UI change suspected or before release cut.
3. Drift severity handling:
   - Critical control/journey changed unexpectedly -> block_release
   - Non-critical cosmetic drift -> gap + follow-up owner/date
4. Owner required in output for every drift decision (accept/fix/defer).

---

## Strategies

### A — Full pipeline

```
G0 + learning hints
→ run_expert_qa(product_root, url, AC, [role_b|openapi|journeys])
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
→ Strategy A (`run_expert_qa` → suite_id)
```

**Forbidden:** end at exploratory observations and claim “tested”. Expert closes loop into AC + suite.

---

## Retest matrix (G8)

| Intent | MCP |
|--------|-----|
| Cases | `run_regression_suite` + `case_ids` |
| Defects | `related_defect_ids: ["DEF-DRAFT:…"]` |
| One screen | suite for screen **or** `run_expert_qa` for that URL only |
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
- Case results: table from expert_session_report (id | variant | status | evidence)
- Rationale: …
- Critical / security / authz: …
- Coverage gaps: …                   # from MCP + domain not tested
- Retest plan: case_ids […] | defects […] | screen … | none (why)
- suite_id: … | missing (why)
- Artifacts: report_path (HTML on disk — do not dump report_html into chat)
- Drift/flake decisions: retry_once | quarantine_case | block_release (with owner)
- Human still required for: release sign-off | pen-test | novel domain
- NOT claimed: full WCAG / load / pen-test (unless run)
```

**Incomplete run** if `release_recommendation` or `coverage_gaps` or retest plan missing.

---

## Tool map

| Purpose | Tool |
|---------|------|
| Full run | `run_expert_qa` |
| Retest | `run_regression_suite` / `execute_generated_test_case` |
| Suite | `register_regression_suite` / `list_regression_suites` |
| Discover / roles | `discover_ui_surface*` / `discover_and_compare_role_ui_surfaces` |
| API | `generate_api_smoke_from_openapi` / `execute_api_smoke` |
| Learning | `list_failure_avoidance_hints` / `list_learning_candidates` |
| Explore | `generate_exploratory_charter` / `execute_exploratory_session` |
| Export | `export_defects_for_tracker` |
| Depth | `run_depth_smokes` |
