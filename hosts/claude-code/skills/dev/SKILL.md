---
name: dev
description: >
  Expert QA for developers — same G0–G8 as tester. Pass endpoint URL
  (localhost or staging); AC from source when possible. Full run + targeted
  retest (case/screen/defect). Trigger: "/qa-intelligence:dev",
  "test locally", "QA before merge", "retest this screen", "kiểm tra trước push".
---

# QA Intelligence — dev (Expert Tester)

**Command:** `/qa-intelligence:dev`  
**Role:** Developer peer-QA — not a green-CI cheerleader.  
**Env:** From URL user passes (local or staging). Same Expert process as `:test`.

**MUST follow** `hosts/references/expert-tester-workflow.md` (G0→G8 + Retest).

---

## Entry

1. **URL** — localhost or staging endpoint (ask if missing)  
2. **AC** — prefer derive from **open source / screen file**; else ticket  
3. Conflicts code↔comment → surface, don’t silently pick  
4. Mode: full run or **retest**

Non-loopback URL → `register_workspace_environment` + secrets before run.  
Localhost pass ≠ production ready — state in G6.

---

## Full run

- Derive AC (`expected_text`, `expected_network` when API) → `register_requirement`  
- Discover → `run_auto_qa` with `output_path` e.g. `docs/qa-reports/dev/…`  
- **Register regression suite** every serious run (enables retest)  
- OpenAPI in repo → API smoke on same base URL  

## Retest (same as tester)

| Intent | Tool |
|--------|------|
| Cases | `run_regression_suite` + `case_ids` |
| Defects | `related_defect_ids` |
| One screen | suite for screen or `run_auto_qa` that URL only |
| One case JSON | `execute_generated_test_case` |

After fix: targeted retest only — follow `smart_retest_suggestion`. Gate first.

---

## Output

Output contract — `Command: dev`, Environment from URL.
