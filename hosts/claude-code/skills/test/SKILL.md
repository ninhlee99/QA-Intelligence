---
name: test
description: >
  Expert QA tester — URL + spec. Environment (local/staging) comes from the
  URL user passes, not a separate command. Supports full run and targeted
  retest (case / screen / defect). Trigger: "/qa-intelligence:test",
  "test this page", "QA this URL", "retest this case", "kiểm tra tính năng".
---

# QA Intelligence — test (Expert Tester)

**Command:** `/qa-intelligence:test`  
**Role:** Tester — spec + URL (no source required).  
**Env:** From URL (`localhost` → local hygiene; else register staging env).

**MUST follow** `hosts/references/expert-tester-workflow.md` (G0→G8 + Retest).

MCP: `qa-intelligence`. Never `execute_browser_test` on real targets.

---

## Entry

Collect:

1. **URL** (endpoint) — required  
2. **Spec / AC** — ticket, doc, or stated behavior (or exploratory if none)  
3. Login secret refs if session-gated  
4. Mode: **full run** or **retest** (case_ids / suite / screen / defect)

If user says “retest …” → Strategy **B** (see Retest below). Do not restart full product discovery unless AC/UI changed.

---

## Full run (Strategy A / C)

1. G0–G1 from URL + secrets  
2. Discover live UI  
3. Bind AC or Strategy C then confirm AC  
4. `run_auto_qa` → **always** `register_regression_suite` on serious runs  
5. G5–G8 Output contract  

## Retest (Strategy B) — required capability

| User intent | MCP call |
|-------------|----------|
| Retest these cases | `run_regression_suite` + `case_ids` |
| Retest after bug fix | `related_defect_ids: ["DEF-DRAFT:…"]` |
| Retest this screen | suite for that URL/screen, or `run_auto_qa` **only that URL** |
| Retest one case object | `execute_generated_test_case` with saved case + assertion |

Use `smart_retest_suggestion` from prior `run_auto_qa` when present.  
Report what was **not** retested.

---

## Output

Output contract in the reference — `Command: test`, Environment from URL.
