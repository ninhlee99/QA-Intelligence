# Senior Expert Tester — competency ceiling & roadmap

Honest map after judgment layer (charter, oracle strength, confidence, stopping, next exploratory, structured waives).

## Goal

AI auto-test + report **like** a senior Expert Tester for **scoped** UI/AC (+ optional E2 hooks).

**Not goal:** replace human release accountability, pen-test firm, or novel-domain PM judgment.

---

## Competency scorecard (human Expert skills)

| # | Skill | Status | Notes |
|---|--------|--------|-------|
| 1 | Gate-first verdict | **strong** | `release_recommendation` + checklist |
| 2 | Anti green-wash | **strong** | `claim_pass_allowed` + `validate_expert_claim` |
| 3 | Explicit gaps | **strong** | rich `coverage_gaps` + domain/E2/stateful/blast/oracle |
| 4 | Targeted retest | **strong** | smart_retest + suite_id |
| 5 | Domain hygiene | **partial** | pack gate/stubs — not full domain model |
| 6 | Role/authz | **partial** | role_b hook + e2 mandate |
| 7 | API authz negatives | **partial→better** | OpenAPI + same-pass capped execute |
| 8 | Journeys | **partial→better** | register + capped same-pass execute |
| 9 | Money/network oracles | **partial→better** | smell + oracle_strength scoring |
| 10 | Variant design | **strong** | pos/neg/boundary/adversarial |
| 11 | Defect drafting | **better** | repro + impact-if-shipped; no confirmed_cause |
| 12 | Flake + learning | **partial** | taxonomy + hints; host applies |
| 13 | Exploratory close-loop | **better** | `next_exploratory_charter` always suggested |
| 14 | Session close-out voice | **strong** | session report + judgment sections |
| 15 | A11y/depth/baselines | **partial** | naming smoke ≠ WCAG |
| 16 | Spec pushback | **better** | AC quality + oracle_strength |
| 17 | Risk strategy matrix | **partial→better** | matrix + confidence + stopping |
| 18 | Stateful data lifecycle | **partial** | explicit residual gap |
| 19 | Diff blast-radius | **partial** | git hints when product_root is git |
| 20 | True pen/abuse modeling | **missing** | residual only |
| 21 | Session charter | **strong** | mission / in-out scope / time-box mindset |
| 22 | Confidence calibration | **strong** | band + score capped ≤85 |
| 23 | Stopping / diminishing returns | **strong** | explicit stop rule |
| 24 | Structured waive | **partial** | `risk_waives` recorded; does not auto-clear blockers |

---

## Current estimated scores

| Lens | /10 |
|------|-----|
| Scoped Expert-discipline auto loop + human-like report | **9.0–9.3** |
| Replace senior Expert for release | **3–4** |

Honest ceiling: voice/discipline can feel senior; **accountability and novel truth cannot**.

---

## Still impossible without human

1. **Release sign-off / legal accountability**
2. **Novel domain truth** (pack stubs ≠ lived product knowledge)
3. **Unbounded exploration + real security/load certification**

---

## Shipped leverage (latest)

1. Same-pass API/journey capped execute
2. Risk matrix + AC pushback + git blast-radius + stateful gap
3. **`expert_judgment`**: charter, oracle strength, confidence, stopping, next exploratory, structured waives
4. Defect drafts include **impact if shipped**
