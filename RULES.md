# Expert Tester — non-negotiable rules

These rules bind the MCP agent and every contributor. Short on purpose.
Contracts live in TypeScript (`src/**/public.ts`), not in archived SPECs.

## Honesty

1. **No fabricated pass.** Never claim green when `release_recommendation` is not a release-friendly gate.
2. **No invented root cause.** Pipeline may set `suspected_cause` only. Never set `confirmed_cause`.
3. **No silent coverage.** Unbound AC, `not_executed`, and scope limits must appear in `coverage_gaps` / findings — never counted as pass.
4. **Scope honesty.** Naming smoke ≠ WCAG. API smoke ≠ full authz matrix. Never claim load/pen-test coverage not run.

## Evidence

5. **Fail with evidence.** Failed UI runs leave screenshot and/or Playwright trace under `.qa-traces/`.
6. **Defects need evidence.** Export/file path must warn when a draft has empty evidence.
7. **Secrets off the wire.** After `register_workspace_secret`, use `*_secret_ref` — never paste passwords into tool input.

## Design

8. **Semantic UI, not CSS.** Interaction targets resolve by accessible name/role from discovery — not freehand selectors.
9. **Deterministic first.** Rules and observed outcomes beat LLM storytelling.
10. **Learning never auto-promotes.** `avoid:*` hints and learning candidates are advisory until a human acts.
11. **Expert output bar.** Do not claim pass/ship without quoting `release_recommendation`, stating `coverage_gaps`, and giving a retest plan (or explicit none).
12. **Domain pack.** Before execute: load or **auto-create** `domain-knowledge/` in the product workspace from templates, filled from the test request. Money/permission/legacy/pii risks must appear as tested or gap — never silent waive. Do not require the user to copy templates manually.
13. **Explore closes the loop.** Exploratory session alone is not a quality claim — promote to AC + `run_auto_qa` + regression suite after confirm.
14. **Data readiness gate.** Before execute/pass claim on non-trivial flows, record dataset/source assumptions, seed strategy, cleanup/rollback, and deterministic oracle mapping; missing gate means blocked pass.
15. **Oracle strength gate.** AC lacking executable oracle (`expected_*`) is not claimable for pass; must rewrite AC or mark explicit gap.
16. **Drift governance.** UI drift on critical controls/journeys blocks pass until triaged, waived with rationale, or fixed.
17. **Flake governance.** Flaky critical journeys cannot be claimed pass; repeated same causal flake class must be quarantined and tracked with remediation owner.

## Flake policy (wave 1 baseline)

1. `retry_once` only when signal suggests transient infra/timing.
2. `quarantine_case` when flaky repeats on same case/causal class within session.
3. `block_release` when flaky affects critical path, money flow, permission boundary, or security-sensitive journey.
4. Flake resolution must include: suspected cause, evidence path, retest scope, owner.

## Host Skills

Skills under `hosts/*/skills/` must teach **risk-first triage** (assess → choose strategy → run → read gate), not a tool shopping list.
