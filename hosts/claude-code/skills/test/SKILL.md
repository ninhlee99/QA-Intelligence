---
name: test
description: >
  Expert-level QA tester — URL + spec. Auto-bootstraps domain-knowledge from
  templates using the test request. Env from URL. Gate/gaps/retest enforced.
  Trigger: "/qa-intelligence:test", "test this page", "retest this case".
---

# QA Intelligence — test (Expert Tester)

**MUST follow** `hosts/references/expert-tester-workflow.md` + `hosts/references/domain-pack.md`.

MCP: `qa-intelligence`. Evidence from tools only.

---

## Hard refuses

No pass unless MCP `expert_checklist.claim_pass_allowed` is true **and** `validate_expert_claim` returns `allowed: true` for the exact wording you will tell the user.

---

## Procedure

1. **Entry:** URL, AC/spec (or exploratory), secrets, full vs retest  
2. **G0:** 5 questions  
3. **G0 learning:** `list_failure_avoidance_hints` (+ `list_learning_candidates`)  
4. **G0d Domain pack:** Prefer `run_expert_qa` with `product_root`. Else `bootstrap_domain_pack`.  
5. **G1–G3:** env from URL; discover; bind AC  
6. **G4 Strategy A:** Prefer `run_expert_qa` when product workspace path known. Else `run_auto_qa` with `product_root` when possible. Optional: `role_b`, `openapi`, `include_workflow_journeys` (capped API/journey subset executes same pass; `execute_extension_cases=false` to skip).  
7. **G4 B:** targeted retest via `run_regression_suite` + `smart_retest_suggestion`  
8. **G5–G8:** Output contract; honor `expert_checklist` (+ `expert_risk_matrix`, `ac_quality_review`, `git_blast_radius`)  
9. Paste **`expert_session_report.markdown`** (Senior Expert voice) as the primary user-facing write-up; also honor `expert_observations`.  
10. **Before any pass/ready/ship sentence:** `validate_expert_claim({ proposed_claim, expert_checklist })` — if `allowed=false`, rewrite as blocked/incomplete.  

If G0 smells roles/API/money/journey → must exercise hooks (`role_b`, `openapi`+authz, `expected_network`, `include_workflow_journeys`) or accept E2 blockers (no pass).  
Read `ac_quality_review` / open `risk_matrix` P0–P1 — push back or mitigate before pass language.  
If domain high-risk TODOs: confirm with human → re-run with `domain_high_risk_confirmed=true`.  
`acknowledge_domain_pack_absent` only records a gap — **still not pass**.  
Human release_signoff required even when claim_pass_allowed=true.
