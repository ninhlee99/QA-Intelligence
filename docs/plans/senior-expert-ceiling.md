# Senior Expert Tester — competency ceiling & roadmap

Honest map after Expert rails + competency gap fill (risk matrix, same-pass extension exec, AC pushback, git blast-radius, stateful gap).

## Goal

AI auto-test + report **like** a senior Expert Tester for **scoped** UI/AC (+ optional E2 hooks).

**Not goal:** replace human release accountability, pen-test firm, or novel-domain PM judgment.

---

## Competency scorecard (human Expert skills)

| # | Skill | Status | Notes |
|---|--------|--------|-------|
| 1 | Gate-first verdict | **strong** | `release_recommendation` + checklist |
| 2 | Anti green-wash | **strong** | `claim_pass_allowed` + `validate_expert_claim` |
| 3 | Explicit gaps | **strong** | rich `coverage_gaps` + domain/E2/stateful/blast |
| 4 | Targeted retest | **strong** | smart_retest + suite_id |
| 5 | Domain hygiene | **partial** | pack gate/stubs — not full domain model |
| 6 | Role/authz | **partial** | role_b hook + e2 mandate |
| 7 | API authz negatives | **partial→better** | OpenAPI hook + same-pass capped execute |
| 8 | Journeys | **partial→better** | register + capped same-pass execute |
| 9 | Money/network oracles | **partial** | smell → expected_network mandate |
| 10 | Variant design | **strong** | pos/neg/boundary/adversarial |
| 11 | Defect drafting | **partial→better** | human repro narrative; still no confirmed_cause |
| 12 | Flake + learning | **partial** | taxonomy + hints; host applies |
| 13 | Exploratory close-loop | **partial** | tools exist; Skill-driven |
| 14 | Session close-out voice | **strong** | `expert_session_report` + matrix/AC sections |
| 15 | A11y/depth/baselines | **partial** | naming smoke ≠ WCAG |
| 16 | Spec pushback | **partial→better** | `ac_quality_review` fused into session/checklist |
| 17 | Risk strategy matrix | **partial** | `expert_risk_matrix` impact×likelihood heuristic |
| 18 | Stateful data lifecycle | **partial** | explicit residual gap (no durable fixture oracle) |
| 19 | Diff blast-radius | **partial** | `git_blast_radius` when product_root is git |
| 20 | True pen/abuse modeling | **missing** | adversarial probes only — residual |

---

## Current estimated scores

| Lens | /10 |
|------|-----|
| Scoped Expert-discipline auto loop + human-like report | **8.5–9.0** |
| Replace senior Expert for release | **3–4** |

---

## Still impossible without human

1. **Release sign-off / legal accountability**
2. **Novel domain truth** (pack stubs ≠ lived product knowledge)
3. **Unbounded exploration + real security/load certification**

---

## Shipped leverage (this pass)

1. Execute journey/API capped subset in same Expert pass (`execute_extension_cases`, default true)
2. Fuse AC quality findings into session + pass blockers
3. Lightweight risk matrix (impact×likelihood) from smells + domain + extension evidence
4. Optional git blast-radius hints when `product_root` has `.git`
5. Explicit stateful lifecycle coverage gap
