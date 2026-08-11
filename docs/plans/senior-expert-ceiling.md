# Senior Expert Tester — competency ceiling & roadmap

Honest map after Expert rails (P1–P5 + claim harden + E2 smells + session report).

## Goal

AI auto-test + report **like** a senior Expert Tester for **scoped** UI/AC (+ optional E2 hooks).

**Not goal:** replace human release accountability, pen-test firm, or novel-domain PM judgment.

---

## Competency scorecard (human Expert skills)

| # | Skill | Status | Notes |
|---|--------|--------|-------|
| 1 | Gate-first verdict | **strong** | `release_recommendation` + checklist |
| 2 | Anti green-wash | **strong** | `claim_pass_allowed` + `validate_expert_claim` |
| 3 | Explicit gaps | **strong** | rich `coverage_gaps` + domain/E2 |
| 4 | Targeted retest | **strong** | smart_retest + suite_id |
| 5 | Domain hygiene | **partial** | pack gate/stubs — not full domain model |
| 6 | Role/authz | **partial** | role_b hook + e2 mandate |
| 7 | API authz negatives | **partial** | OpenAPI hook; host must supply spec |
| 8 | Journeys | **partial** | register ≠ execute same pass |
| 9 | Money/network oracles | **partial** | smell → expected_network mandate |
| 10 | Variant design | **strong** | pos/neg/boundary/adversarial |
| 11 | Defect drafting | **partial→better** | human repro narrative; still no confirmed_cause |
| 12 | Flake + learning | **partial** | taxonomy + hints; host applies |
| 13 | Exploratory close-loop | **partial** | tools exist; Skill-driven |
| 14 | Session close-out voice | **stronger** | `expert_session_report` markdown |
| 15 | A11y/depth/baselines | **partial** | naming smoke ≠ WCAG |
| 16 | Spec pushback | **partial** | requirement tools not fused into Expert voice |
| 17 | Risk strategy matrix | **missing** | smells ≠ impact×likelihood model |
| 18 | Stateful data lifecycle | **missing** | |
| 19 | Diff blast-radius | **missing** | |
| 20 | True pen/abuse modeling | **missing** | adversarial probes only |

---

## Current estimated scores

| Lens | /10 |
|------|-----|
| Scoped Expert-discipline auto loop + human-like report | **8.0–8.5** |
| Replace senior Expert for release | **3–4** |

---

## Still impossible without human

1. **Release sign-off / legal accountability**
2. **Novel domain truth** (pack stubs ≠ lived product knowledge)
3. **Unbounded exploration + real security/load certification**

---

## Next leverage (if continuing)

1. Execute journey/API cases in same Expert pass (or hard-fail “done” until suite run evidence)
2. Fuse requirement-review findings into session report
3. Lightweight risk matrix (impact×likelihood) from domain tags + AC
4. Optional code-diff blast-radius hints when git context available
