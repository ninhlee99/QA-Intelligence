# Expert Tester Workflow (canonical)

Shared by `/qa-intelligence:test` and `/qa-intelligence:dev`.

**Only two entry commands.** Local vs staging is **not** a separate skill — user passes the **endpoint (URL)**. Agent detects loopback vs shared env and applies the right G1 hygiene.

MCP: `qa-intelligence`. Evidence steps **call MCP tools** — never invent UI, pass/fail, or root cause.

---

## Commands

| Command | Who | Inputs |
|---------|-----|--------|
| `/qa-intelligence:test` | Tester | URL + spec/AC (no source required) |
| `/qa-intelligence:dev` | Developer | URL (often localhost) + AC from **source** or ticket |

Same gates **G0→G8**. Same honesty. Different AC provenance only.

---

## Environment from URL (not from command name)

| URL shape | Treat as | G1 |
|-----------|----------|-----|
| `localhost` / `127.0.0.1` / loopback | local | Env register optional |
| Other http(s) | staging/shared | `register_workspace_environment` **required**; confirm before write-ish login |
| Missing URL | Ask | Do not guess |

Always state in output: `Environment: local | staging | <name>` derived from URL.

---

## Non-negotiables

1. No fabricated pass when gate is not release-friendly.
2. Never invent `confirmed_cause`.
3. Unbound AC / `not_executed` ≠ pass — use `coverage_gaps`.
4. Secrets via `*_secret_ref` only.
5. No `execute_browser_test` on real targets (DEMO only).
6. Triage: gate → critical → gaps → artifacts — never pass-count cheerleading.

See repo `RULES.md`.

---

## Gates G0→G8

| Gate | Pass when |
|------|-----------|
| **G0** Assess | Feature vs regression; API; roles; auth; desired output |
| **G1** Env | URL confirmed; env registered if non-loopback; secrets ready |
| **G2** Discover | Live MCP discover — not assumed |
| **G3** Bind AC | Bound to accessible names **or** listed unbound — never invent AC |
| **G4** Execute | Strategy A/B/C via MCP |
| **G5** Gate | `release_recommendation` stated first |
| **G6** Gaps | `coverage_gaps` + NOT covered stated |
| **G7** Artifacts | report / suite_id / defects / traces |
| **G8** Next | Retest plan **or** export **or** “no retest needed” |

---

## Strategies (G4)

### A — Full pipeline
New feature / new AC / material UI change:

```
register_requirement (if AC pack)
→ discover_ui_surface | discover_ui_workflow | after_login
→ [roles] discover_and_compare_role_ui_surfaces
→ run_auto_qa (url + AC + output_path)
→ [API] openapi smoke + execute_api_smoke
→ register_regression_suite   # REQUIRED for serious runs — enables retest
```

### B — Retest / regression (preferred after fix)
Suite already exists:

```
list_regression_suites
→ run_regression_suite with TARGETED filter (see Retest below)
→ optional compare_ui_baseline / compare_ui_surface_to_baseline
→ read release_recommendation
```

### C — Exploratory
No/weak AC:

```
discover → generate_exploratory_charter → execute_exploratory_session
→ propose AC → human confirm → Strategy A
```

---

## Retest (must support — G8)

Expert Tester **never** re-runs the whole world when a subset is enough.
Always prefer targeted retest. Use MCP:

### 1) Retest one or more **cases**

```
run_regression_suite
  suite_id: <from list_regression_suites>
  case_ids: ["TC-…", "TC-…"]
```

Or after `run_auto_qa` fail: follow `smart_retest_suggestion.failed_case_ids` / `flaky_case_ids`.

### 2) Retest by **defect / failure**

```
run_regression_suite
  related_defect_ids: ["DEF-DRAFT:<test_case_id>", …]
```

### 3) Retest one **screen / URL**

- Prefer a suite registered for that screen (name/purpose includes route or screen id).
- If no suite: Strategy A `run_auto_qa` on **that URL only** (not whole product), then `register_regression_suite` for next time.
- Multi-page product: `discover_ui_workflow` → retest only pages in scope; do not claim full product.

### 4) Retest one **generated case** ad-hoc

```
execute_generated_test_case
  # pass the stored test_case + generated_assertion from prior JSON / suite entry
  field_values / field_secret_refs as needed
```

### 5) After retest — report

- Gate first (not pass-count).
- What was retested (`case_ids` / URL / defect ids).
- What was **not** retested (residual risk).
- New traces if still failing: `npx playwright show-trace .qa-traces/…`

**Rule:** Every serious Strategy A run **must** `register_regression_suite` so G8 retest is possible later.

---

## Output contract

```markdown
## Expert QA result
- Command: test | dev
- Environment: local | staging | <name>  (from URL)
- Target URL: …
- Strategy: A | B | C
- release_recommendation: …
- Coverage gaps: …
- Retest plan: case_ids […] | related_defect_ids […] | screen/URL … | none
- Artifacts: report_path, suite_id, traces
- NOT claimed: full WCAG / load / pen-test (unless explicitly run)
```

---

## Tool map

| Purpose | Tool |
|---------|------|
| Full run | `run_auto_qa` |
| Targeted retest | `run_regression_suite` (`case_ids` / `related_defect_ids`) |
| Single case | `execute_generated_test_case` |
| Persist pack | `register_regression_suite` / `list_regression_suites` |
| Discover | `discover_ui_surface` / `discover_ui_workflow` |
| Roles | `discover_and_compare_role_ui_surfaces` |
| API | `execute_api_smoke` |
| Export | `export_defects_for_tracker` |
